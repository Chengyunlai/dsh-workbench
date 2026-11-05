/** Python declaration relationships from a bundled grammar parser; never imports or executes project code. */
import { parser } from '@lezer/python';
import { readWorkspaceSource } from './navigation.js';
const children = node => { const result = []; for (let n = node?.firstChild; n; n = n.nextSibling) result.push(n); return result; };
const fail = (message, code, status = 400) => Object.assign(new Error(message), { code, status });
const moduleName = path => path.replace(/\.pyi?$/, '').replace(/(?:^|\/)__init__$/, '').split('/').filter(Boolean).join('.');

/** Parse class declarations, methods, imports and annotated factory returns from one Python syntax tree.
 * @param path - Workspace-relative Python filename.
 * @param text - UTF-8 source decoded by the workspace reader.
 * @param version - Content version used to guard later source jumps.
 * @returns Declarations and import bindings; syntax errors reject the complete file.
 */
export function parsePythonClasses(path, text, version) {
  const tree = parser.parse(text), bindings = new Map(), classes = [], factories = [];
  const cursor = tree.cursor();
  do {
    if (!cursor.type.isError) continue;
    // Lezer 1.1.19 requires an expression after yield; Python also permits the bare statement.
    const parts = children(cursor.node.parent);
    const bareYield = cursor.node.parent?.name === 'YieldStatement' && cursor.from === cursor.to
      && parts.length === 2 && parts[0].name === 'yield' && parts[0].to === cursor.from;
    if (!bareYield) throw fail('Python syntax is incomplete or unsupported', 'CLASS_GRAPH_SYNTAX');
  } while (cursor.next());
  const slice = n => text.slice(n.from, n.to);
  const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const location = n => { let lo = 0, hi = starts.length; while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= n.from) lo = mid; else hi = mid; } return { line: lo, character: n.from - starts[lo] }; };
  const dotted = node => {
    if (!node) return null;
    if (['VariableName', 'PropertyName'].includes(node.name)) return slice(node);
    if (node.name !== 'MemberExpression') return null;
    const list = children(node);
    if (list[1]?.name === '[') return dotted(list[0]);
    if (list[1]?.name === '.') { const a = dotted(list[0]), b = dotted(list[2]); return a && b ? a + '.' + b : null; }
    return null;
  };
  const bind = (name, value, target = bindings) => target.set(name, target.has(name) ? null : value);
  const groupImports = list => {
    const groups = [[]];
    for (const n of list) { if (n.name === ',') groups.push([]); else if (!['(', ')'].includes(n.name)) groups.at(-1).push(n); }
    return groups.filter(group => group.length);
  };
  const importBinding = (node, target = bindings) => {
    const ns = children(node), at = ns.findIndex(n => n.name === 'import');
    const from = ns[0].name === 'from' ? ns.slice(1, at).map(slice).join('') : null;
    for (const group of groupImports(ns.slice(at + 1))) {
      const as = group.findIndex(n => n.name === 'as'), names = as < 0 ? group : group.slice(0, as);
      const name = names.map(slice).join('');
      if (name === '*') { target.set('*', null); continue; }
      const alias = as < 0 ? (from === null ? name.split('.')[0] : name) : slice(group[as + 1]);
      bind(alias, { from, name: from === null && as < 0 ? name.split('.')[0] : name }, target);
    }
  };
  const factoryDeclaration = fn => {
    const list = children(fn), annotation = list.find(n => n.name === 'TypeDef');
    const returns = dotted(annotation?.firstChild);
    if (!returns || list.some(n => n.name === 'async')) return;
    const locals = new Map(), calls = []; let unsupported = false;
    const shadow = node => {
      if (node.name === 'VariableName') bind(slice(node), null, locals);
      else if (['TupleExpression', 'ArrayExpression', 'StarredExpression'].includes(node.name)) children(node).forEach(shadow);
    };
    const params = list.find(n => n.name === 'ParamList');
    for (const group of groupImports(children(params))) {
      const name = group.find(n => n.name === 'VariableName'); if (name) shadow(name);
    }
    const visit = node => {
      const ns = children(node);
      if (['FunctionDefinition', 'ClassDefinition', 'LambdaExpression'].includes(node.name)) {
        const name = ns.find(n => n.name === 'VariableName'); if (name && node.name !== 'LambdaExpression') shadow(name);
        return;
      }
      if (node.name === 'ImportStatement') { importBinding(node, locals); return; }
      if (['YieldStatement', 'YieldExpression', 'ScopeStatement'].includes(node.name)) unsupported = true;
      if (['AssignStatement', 'UpdateStatement', 'NamedExpression'].includes(node.name)) {
        const last = ns.findLastIndex(n => n.name === 'AssignOp' || n.name === 'UpdateOp');
        ns.slice(0, Math.max(0, last)).forEach(shadow);
        if (node.name === 'AssignStatement' && ns[1]?.name === 'TypeDef') shadow(ns[0]);
      }
      if (node.name === 'CapturePattern') ns.forEach(shadow);
      if (node.name === 'ForStatement') for (const target of ns.slice(1, ns.findIndex(n => n.name === 'in'))) shadow(target);
      if (node.name === 'DeleteStatement') ns.slice(1).forEach(shadow);
      for (let i = 0; i < ns.length; i++) if (ns[i].name === 'as') shadow(ns[i + 1]);
      if (node.name === 'ReturnStatement' && ns.length === 2 && ns[1].name === 'CallExpression') {
        const callee = ns[1].firstChild, name = dotted(callee);
        if (name) calls.push({ name, ...location(callee) });
      }
      ns.forEach(visit);
    };
    visit(list.find(n => n.name === 'Body'));
    if (!unsupported && calls.length) factories.push({ name: slice(list.find(n => n.name === 'VariableName')), returns, bindings: locals, calls });
  };
  const walk = (body, parents = [], moduleLevel = true) => {
    for (const original of children(body)) {
      const ns = children(original), decorated = original.name === 'DecoratedStatement';
      const node = decorated ? ns.find(n => n.name === 'ClassDefinition' || n.name === 'FunctionDefinition') : original;
      if (!node) continue;
      if (moduleLevel && node.name === 'ImportStatement') { importBinding(node); continue; }
      if (moduleLevel && ['AssignStatement', 'UpdateStatement'].includes(node.name)) {
        const first = node.firstChild; if (first?.name === 'VariableName') bind(slice(first), null);
      }
      if (moduleLevel && node.name === 'FunctionDefinition') {
        const name = children(node).find(n => n.name === 'VariableName'); if (name) bind(slice(name), null);
        if (!decorated) factoryDeclaration(node);
      }
      if (node.name === 'ClassDefinition') {
        const list = children(node), nameNode = list.find(n => n.name === 'VariableName'), name = slice(nameNode), qualified = [...parents, name].join('.');
        if (moduleLevel && bindings.has(name)) bindings.set(name, null);
        const bases = [], args = list.find(n => n.name === 'ArgList');
        for (const group of groupImports(children(args).filter(n => n.name !== '(' && n.name !== ')'))) {
          if (group.some(n => n.name === 'AssignOp')) continue;
          bases.push({ name: group.length === 1 ? dotted(group[0]) : null, text: text.slice(group[0].from, group.at(-1).to) });
        }
        const body = list.find(n => n.name === 'Body'), methods = [];
        for (const entry of children(body)) {
          const decorated = entry.name === 'DecoratedStatement', parts = children(entry);
          const fn = decorated ? parts.find(n => n.name === 'FunctionDefinition') : entry;
          if (fn?.name !== 'FunctionDefinition') continue;
          const fs = children(fn), token = fs.find(n => n.name === 'VariableName');
          const params = fs.find(n => n.name === 'ParamList');
          const groups = groupImports(children(params).filter(n => !['(', ')'].includes(n.name)));
          if (groups[0]?.[0]?.name === 'VariableName' && ['self', 'cls'].includes(slice(groups[0][0]))) groups.shift();
          const parameters = groups.map(group => text.slice(group[0].from, group.at(-1).to).replace(/\s+/g, ' ')).join(', ').slice(0, 240);
          const returns = fs.find(n => n.name === 'TypeDef');
          methods.push({ name: slice(token), parameters, returns: returns ? slice(returns).replace(/^->\s*/, '').replace(/\s+/g, ' ').slice(0, 120) : '', ...location(token), decorators: decorated ? parts.filter(n => n.name === 'Decorator').map(n => dotted(children(n)[1])).filter(Boolean) : [] });
        }
        classes.push({ id: path + ':' + nameNode.from, path, version, name, qualified, ...location(nameNode), endLine: location({ from: node.to - 1 }).line, bases, methods, decorated });
        walk(body, [...parents, name], false);
      } else if (node.name !== 'FunctionDefinition') {
        // Classes nested in control flow are recorded as declarations, without treating conditional imports as unconditional bindings.
        for (const body of children(node).filter(n => n.name === 'Body')) walk(body, parents, false);
      }
    }
  };
  walk(tree.topNode);
  return { path, version, module: moduleName(path), package: path.endsWith('/__init__.py') ? moduleName(path) : moduleName(path).split('.').slice(0, -1).join('.'), bindings, classes, factories };
}

/** Resolve explicit base declarations and inherited abstract methods without guessing implicit Protocol implementations.
 * @param modules - Parsed workspace files.
 * @returns Class nodes, inheritance edges and separately labeled annotated factory returns; no structural type check is implied.
 */
export function linkPythonClasses(modules) {
  const symbols = new Map(), moduleMap = new Map(), owner = new Map();
  const add = (map, key, value) => { const rows = map.get(key) ?? []; rows.push(value); map.set(key, rows); };
  for (const mod of modules) {
    const names = [mod.module]; if (mod.module.startsWith('src.')) names.push(mod.module.slice(4));
    for (const name of names) {
      add(moduleMap, name, mod);
      for (const cls of mod.classes) add(symbols, [name, cls.qualified].filter(Boolean).join('.'), cls);
    }
    for (const cls of mod.classes) owner.set(cls.id, mod);
  }
  const absolute = (mod, binding) => {
    if (binding.from === null) return binding.name;
    let from = binding.from;
    if (from.startsWith('.')) {
      const dots = from.length - from.replace(/^\.+/, '').length, parts = mod.package.split('.').filter(Boolean);
      if (dots > parts.length) return null;
      from = [...parts.slice(0, parts.length - dots + 1), from.slice(dots)].filter(Boolean).join('.');
    }
    return [from, binding.name].filter(Boolean).join('.');
  };
  const resolveSymbol = (name, seen = new Set()) => {
    if (!name || seen.has(name) || seen.size >= 32) return null;
    seen.add(name);
    const direct = symbols.get(name);
    if (direct) {
      if (direct.length !== 1 || owner.get(direct[0].id).bindings.has(direct[0].qualified.split('.')[0])) return null;
      return direct[0];
    }
    const parts = name.split('.');
    for (let split = parts.length - 1; split > 0; split--) {
      const ms = moduleMap.get(parts.slice(0, split).join('.'));
      if (ms?.length !== 1) continue;
      const binding = ms[0].bindings.get(parts[split]);
      if (binding) return resolveSymbol([absolute(ms[0], binding), ...parts.slice(split + 1)].filter(Boolean).join('.'), seen);
    }
    return null;
  };
  const canonical = (mod, name) => {
    const [first, ...rest] = name.split('.');
    if (mod.bindings.has(first)) {
      const binding = mod.bindings.get(first);
      return binding ? [absolute(mod, binding), ...rest].filter(Boolean).join('.') : null;
    }
    return name;
  };
  const nodes = modules.flatMap(mod => mod.classes.map(cls => ({ ...cls, kind: 'class', unresolved: [], abstractMethods: [], overrides: [] }))), byId = new Map(nodes.map(n => [n.id, n])), edges = [];
  for (const node of nodes) {
    const mod = owner.get(node.id);
    for (const base of node.bases) {
      const canon = base.name && canonical(mod, base.name);
      if (['typing.Protocol', 'typing_extensions.Protocol'].includes(canon)) { node.kind = 'protocol'; continue; }
      if (canon === 'abc.ABC') { if (node.kind !== 'protocol') node.kind = 'abc'; continue; }
      let target = null;
      if (base.name && !mod.bindings.has(base.name.split('.')[0])) {
        const nesting = node.qualified.split('.').slice(0, -1);
        for (let n = nesting.length; n >= 0 && !target; n--) target = resolveSymbol([mod.module, ...nesting.slice(0, n), base.name].filter(Boolean).join('.'));
      } else if (canon) target = resolveSymbol(canon);
      if (target) edges.push({ from: node.id, to: target.id });
      else if (base.name !== 'object' || mod.bindings.has('object')) node.unresolved.push(base.text);
    }
  }
  const orders = new Map();
  const order = (node, seen = new Set()) => {
    if (orders.has(node.id)) return orders.get(node.id);
    if (seen.has(node.id)) return null;
    seen.add(node.id);
    const parents = edges.filter(e => e.from === node.id).map(e => byId.get(e.to));
    const inherited = parents.map(p => order(p, new Set(seen)));
    if (inherited.some(list => list === null)) { orders.set(node.id, null); return null; }
    const sequences = [...inherited.map(list => [...list]), [...parents]], result = [node];
    while (sequences.some(list => list.length)) {
      const candidate = sequences.filter(list => list.length).map(list => list[0]).find(head => sequences.every(list => !list.slice(1).includes(head)));
      if (!candidate) { orders.set(node.id, null); return null; }
      result.push(candidate); for (const list of sequences) if (list[0] === candidate) list.shift();
    }
    orders.set(node.id, result); return result;
  };
  for (const node of nodes) {
    const linear = order(node);
    if (!linear) { node.unresolved.push('MRO'); continue; }
    const effective = new Map();
    for (const ancestor of linear) for (const method of [...ancestor.methods].reverse()) if (!effective.has(method.name)) effective.set(method.name, { method, ancestor });
    node.abstractMethods = [...effective].filter(([, { method, ancestor }]) => method.decorators.some(name => ['abc.abstractmethod', 'abc.abstractproperty', 'abc.abstractclassmethod', 'abc.abstractstaticmethod'].includes(canonical(owner.get(ancestor.id), name)))).map(([name]) => name);
    node.overrides = node.methods.filter(method => linear.slice(1).some(parent => parent.methods.some(inherited => inherited.name === method.name))).map(method => method.name);
    if (node.kind !== 'protocol' && node.abstractMethods.length) node.kind = 'abstract';
  }
  for (const mod of modules) for (const factory of mod.factories ?? []) {
    if (mod.bindings.has('*')) continue;
    const result = resolveSymbol(canonical(mod, factory.returns)) ?? resolveSymbol(mod.module + '.' + factory.returns);
    if (!result || byId.get(result.id).kind !== 'protocol') continue;
    for (const call of factory.calls) {
      const [first, ...rest] = call.name.split('.');
      const binding = factory.bindings.get(first);
      const name = factory.bindings.has(first) ? binding && [absolute(mod, binding), ...rest].filter(Boolean).join('.') : canonical(mod, call.name);
      const target = name && (resolveSymbol(name) ?? (!mod.bindings.has(first) && !factory.bindings.has(first) ? resolveSymbol(mod.module + '.' + name) : null));
      if (!target || target.id === result.id || byId.get(target.id).kind === 'protocol') continue;
      const existing = edges.find(edge => edge.from === target.id && edge.to === result.id);
      if (existing && existing.kind !== 'factory') continue;
      const edge = existing ?? { from: target.id, to: result.id, kind: 'factory', evidence: [] };
      edge.evidence.push({ path: mod.path, version: mod.version, function: factory.name, line: call.line, character: call.character });
      if (!existing) edges.push(edge);
    }
  }
  return { nodes, edges };
}

/** Enumerate Git-visible Python files and read them through the workspace filesystem's containment checks.
 * @param dependencies - Authenticated workspace/path validators, Git runner, response helper and scan limits.
 * @returns Cancellable read-only project class graph route; skipped and truncated scans are reported explicitly.
 */
export function createPythonClassGraph({ runGit, requireWorkspacePath, requireRelativePath, json, config }) {
  return async (ctx, request, signal) => {
    const cwd = new URL(request.url).searchParams.get('cwd'); await requireWorkspacePath(ctx, cwd, signal);
    const listed = await runGit(ctx, cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '--full-name', '-z'], { signal });
    const prefix = (await runGit(ctx, cwd, ['rev-parse', '--show-prefix'], { signal })).stdout.replace(/\r?\n$/, '');
    const paths = [...new Set(listed.stdout.split('\0').filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length)))].filter(p => /\.pyi?$/i.test(p) && !p.split('/').some(part => part === '.git' || config.classGraphExcludedDirectories.includes(part))).sort();
    const modules = [], skipped = []; let bytes = 0, count = 0, scanned = 0, limited = false;
    for (const path of paths) {
      signal.throwIfAborted();
      if (scanned >= config.classGraphMaxFiles || count >= config.classGraphMaxClasses) { limited = true; break; }
      scanned++;
      try {
        requireRelativePath(path);
        const source = await readWorkspaceSource(ctx, cwd, path, signal);
        bytes += Buffer.byteLength(source.text);
        if (bytes > config.classGraphMaxBytes) { limited = true; break; }
        const parsed = parsePythonClasses(path, source.text, source.version);
        if (count + parsed.classes.length > config.classGraphMaxClasses) { limited = true; break; }
        modules.push(parsed); count += parsed.classes.length;
      } catch (error) {
        signal.throwIfAborted();
        if (error.code === 'CLASS_GRAPH_SYNTAX' || error.code?.startsWith('SOURCE_')) skipped.push({ path, code: error.code });
        else throw error;
      }
    }
    return json({ ...linkPythonClasses(modules), scanned, total: paths.length, limited, skipped });
  };
}
