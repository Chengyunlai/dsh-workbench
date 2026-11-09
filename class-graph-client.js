import { Graph, layout as arrange } from '@dagrejs/dagre';
import { createClassHierarchyUI } from './class-hierarchy-client.js';

/** Docked Python class relationships and source navigation; all content comes from the static grammar index. */

/** Identify the active file's language, or the project languages when no file is selected.
 * @param path - Current workspace-relative file path, if selected.
 * @param files - Git-visible project files, or null while the tree is loading.
 * @param external - Whether the active document is an external library preview.
 * @returns A language id, selection source and explicit Python Beta availability.
 */
export function classRelationshipContext(path, files, external = false) {
  const language = name => {
    const ext = name?.split('/').at(-1)?.split('.').at(-1)?.toLowerCase();
    if (['py', 'pyi'].includes(ext)) return 'python';
    if (['js', 'mjs', 'cjs', 'jsx'].includes(ext)) return 'javascript';
    if (['ts', 'mts', 'cts', 'tsx'].includes(ext)) return 'typescript';
    return ({ go: 'go', java: 'java', rs: 'rust', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', md: 'markdown', markdown: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml' })[ext] ?? null;
  };
  if (path) {
    const type = language(path);
    return { language: type, source: external ? 'external' : 'file', supported: !external && type === 'python' };
  }
  if (files === null) return { language: null, source: 'loading', supported: false };
  const code = new Set((files ?? []).map(language).filter(type => type && !['markdown', 'json', 'yaml'].includes(type)));
  const type = code.size === 1 ? [...code][0] : code.size === 2 && code.has('javascript') && code.has('typescript') ? 'javascript-typescript' : null;
  return { language: type, source: code.size > 1 && !type ? 'mixed' : 'project', supported: type === 'python' };
}

/** Choose the containing class, a public declaration, or a factory's annotated protocol.
 * @param graph - Indexed classes and source-backed relationships.
 * @param seed - Open source path and optional caret line.
 * @returns Initial class identifier, or null when the graph is empty.
 */
export function initialClassFocus(graph, seed) {
  const local = graph.nodes.filter(node => node.path === seed?.path);
  const containing = local.filter(node => Number.isSafeInteger(seed?.line) && node.line <= seed.line && node.endLine >= seed.line).sort((a, b) => b.line - a.line);
  if (containing.length) return containing[0].id;
  const publicClasses = local.filter(node => !node.name.startsWith('_'));
  const related = publicClasses.find(node => graph.edges.some(edge => edge.from === node.id || edge.to === node.id));
  const factory = graph.edges.find(edge => edge.kind === 'factory' && edge.evidence.some(row => row.path === seed?.path));
  return related?.id ?? publicClasses[0]?.id ?? local[0]?.id ?? factory?.to ?? graph.nodes[0]?.id ?? null;
}

/** Select a bounded connected component for both diagram and hierarchy presentations.
 * @param graph - Class nodes and child-to-base edges.
 * @param focus - Selected class identifier, or null for all declarations.
 * @returns Visible nodes, edges and truncation state.
 */
export function classGraphSelection(graph, focus) {
  const included = new Set(focus ? [focus] : graph.nodes.map(n => n.id));
  if (focus) {
    const queue = [focus];
    for (let i = 0; i < queue.length; i++) for (const edge of graph.edges) {
      const other = edge.from === queue[i] ? edge.to : edge.to === queue[i] ? edge.from : null;
      if (other && !included.has(other)) { included.add(other); queue.push(other); }
    }
  }
  const visible = new Set([...included].slice(0, 100));
  const nodes = graph.nodes.filter(node => visible.has(node.id)), ids = new Set(nodes.map(n => n.id));
  const edges = graph.edges.filter(e => ids.has(e.from) && ids.has(e.to));
  return { nodes, edges, limited: included.size > nodes.length };
}

/** Position visible classes with bases above children.
 * @param graph - Indexed class nodes and relationships.
 * @param focus - Selected class identifier, or null for all declarations.
 * @returns Routed nodes, edges and bounded canvas dimensions.
 */
export function classGraphLayout(graph, focus) {
  const selection = classGraphSelection(graph, focus), { nodes, edges } = selection;
  const diagram = new Graph({ multigraph: true }).setGraph({ rankdir: 'TB', ranksep: 76, nodesep: 48, edgesep: 20, marginx: 32, marginy: 32 }).setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    const signatures = [...(node.fields ?? []).map(field => field.name + ': ' + field.annotation), ...(node.methods ?? []).map(m => m.name + '(' + (m.parameters ?? '') + ')' + (m.returns ? '  ' + m.returns : ''))];
    const length = Math.max(node.qualified?.length ?? 0, ...signatures.map(s => s.length));
    diagram.setNode(node.id, { width: Math.max(244, Math.min(370, length * 6.6 + 62)), height: 67 + Math.max(1, signatures.length) * 25 + (node.unresolved?.length || node.decorated ? 22 : 0) });
  }
  for (const [index, edge] of edges.entries()) diagram.setEdge(edge.to, edge.from, {}, String(index));
  if (nodes.length) arrange(diagram);
  const placed = nodes.map(node => { const box = diagram.node(node.id); return { ...node, x: box.x - box.width / 2, y: box.y - box.height / 2, width: box.width, height: box.height }; });
  const routed = edges.map((edge, index) => ({ ...edge, points: diagram.edge(edge.to, edge.from, String(index)).points }));
  return { nodes: placed, edges: routed, limited: selection.limited, width: Math.max(400, diagram.graph().width ?? 0), height: Math.max(240, diagram.graph().height ?? 0) };
}

/** Create a theme-token-driven graph window using the host React instance.
 * @param React - Host React exports.
 * @param api - Authenticated JSON request helper.
 * @returns A docked pane component that owns request cancellation and viewport state.
 */
export function createClassGraphUI(React, api) {
  const h = React.createElement, { useState, useEffect, useLayoutEffect, useRef, useMemo } = React;
  const ClassHierarchy = createClassHierarchyUI(React);
  return function ClassGraphWindow({ cwd, seed, currentPath, files, external, dock, onDock, onOpen, onClose, t }) {
    const [graph, setGraph] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
    const [focus, setFocus] = useState(null), [query, setQuery] = useState(''), [zoom, setZoom] = useState(.8), [autoFit, setAutoFit] = useState(false);
    const [mode, setMode] = useState(() => { try { return window.localStorage.getItem('dsh.workbench.classView') === 'tree' ? 'tree' : 'graph'; } catch (error) { return 'graph'; } });
    const [expansion, setExpansion] = useState(() => new Map());
    const [treeReveal, setTreeReveal] = useState(0);
    const context = classRelationshipContext(currentPath === undefined ? seed?.path : currentPath, files, external);
    const language = t('classes.language.' + (context.language ?? 'other'));
    const title = context.language ? t('classes.languageTitle', { language }) : t('classes.title');
    const modeId = React.useId();
    const root = useRef(null), scroll = useRef(null), opening = useRef(null);
    const changeMode = value => { setMode(value); try { window.localStorage.setItem('dsh.workbench.classView', value); } catch (error) { setError(t('classes.viewUnsaved')); } };
    useEffect(() => { root.current?.focus(); return () => opening.current?.abort(); }, []);
    useEffect(() => {
      opening.current?.abort(); const controller = new AbortController(); setBusy(true); setError(null);
      if (!context.supported) { setGraph(null); setBusy(false); return () => controller.abort(); }
      api('/api/git.classes?' + new URLSearchParams({ cwd }), { signal: controller.signal })
        .then(data => {
          if (controller.signal.aborted) return;
          if (!Array.isArray(data.nodes) || !data.nodes.every(n => n && typeof n.id === 'string' && typeof n.path === 'string' && typeof n.qualified === 'string' && typeof n.version === 'string' && Number.isSafeInteger(n.line) && n.line >= 0 && (n.endLine === undefined || Number.isSafeInteger(n.endLine) && n.endLine >= n.line) && Number.isSafeInteger(n.character) && n.character >= 0 && ['class','abc','abstract','protocol'].includes(n.kind) && Array.isArray(n.methods) && n.methods.every(m => m && typeof m.name === 'string' && Number.isSafeInteger(m.line) && m.line >= 0 && Number.isSafeInteger(m.character) && m.character >= 0 && (m.parameters === undefined || typeof m.parameters === 'string') && (m.returns === undefined || typeof m.returns === 'string')) && (n.fields === undefined || Array.isArray(n.fields) && n.fields.every(field => field && typeof field.name === 'string' && typeof field.annotation === 'string' && Number.isSafeInteger(field.line) && field.line >= 0 && Number.isSafeInteger(field.character) && field.character >= 0)) && ['abstractMethods','overrides','unresolved'].every(key => Array.isArray(n[key]) && n[key].every(value => typeof value === 'string'))) || !Array.isArray(data.edges) || !data.edges.every(e => e && data.nodes.some(n => n.id === e.from) && data.nodes.some(n => n.id === e.to) && (e.kind === undefined || e.kind === 'field' && Array.isArray(e.fields) && e.fields.every(name => typeof name === 'string') || e.kind === 'factory' && Array.isArray(e.evidence) && e.evidence.length > 0 && e.evidence.every(row => row && typeof row.path === 'string' && typeof row.version === 'string' && typeof row.function === 'string' && Number.isSafeInteger(row.line) && row.line >= 0 && Number.isSafeInteger(row.character) && row.character >= 0))) || !Array.isArray(data.skipped)) throw new Error(t('classes.invalid'));
          setGraph(data);
          setFocus(initialClassFocus(data, currentPath && currentPath !== seed?.path ? { path: currentPath } : seed));
        })
        .catch(error => { if (!controller.signal.aborted) setError(t('classes.failed', { message: error.message })); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
      return () => controller.abort();
    }, [cwd, seed, revision, context.supported]);
    const selection = useMemo(() => graph ? classGraphSelection(graph, focus) : null, [graph, focus]);
    const layout = useMemo(() => graph && mode === 'graph' ? classGraphLayout(graph, focus) : null, [graph, focus, mode]);
    const selected = useRef(null); selected.current = focus;
    const componentKey = layout?.nodes.map(node => node.id).join('\0');
    const center = id => {
      const node = layout?.nodes.find(n => n.id === id), element = scroll.current;
      if (node && element) {
        element.scrollLeft = Math.max(0, (node.x + node.width / 2) * zoom - element.clientWidth / 2);
        element.scrollTop = Math.max(0, (node.y + node.height / 2) * zoom - element.clientHeight / 2);
      }
    };
    useLayoutEffect(() => {
      const element = scroll.current;
      if (!layout || !element) return;
      const fit = () => {
        if (!element.clientWidth || !element.clientHeight) return;
        if (autoFit) {
          const value = Math.max(.1, Math.min(1, (element.clientWidth - 16) / layout.width, (element.clientHeight - 16) / layout.height));
          setZoom(Math.floor(value * 100) / 100);
          element.scrollLeft = 0; element.scrollTop = 0;
        } else {
          center(selected.current);
        }
      };
      fit();
      const observer = new window.ResizeObserver(fit); observer.observe(element);
      return () => observer.disconnect();
    // Selecting a visible card must not move it between the two clicks of a double-click.
    }, [graph, componentKey, autoFit, dock, zoom, mode]);
    const show = (id, reveal = true) => {
      setFocus(id);
      if (reveal) {
        if (mode === 'tree' && graph) {
          const parents = new Set([id]);
          for (const child of parents) for (const edge of graph.edges) if (edge.from === child) parents.add(edge.to);
          setExpansion(old => { const next = new Map(old); for (const parent of parents) if (parent !== id) next.set(parent, true); return next; });
          setTreeReveal(value => value + 1);
        }
        center(id);
        if (id === null && scroll.current) { scroll.current.scrollLeft = 0; scroll.current.scrollTop = 0; }
      }
    };
    const jump = async (node, member = node) => {
      opening.current?.abort(); const controller = new AbortController(); opening.current = controller;
      try {
        const source = await api('/api/git.source?' + new URLSearchParams({ cwd, path: node.path }), { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (source.version !== node.version) { setError(t('classes.changed')); return; }
        onOpen({ path: node.path, line: member.line, character: member.character, focusSource: true });
      } catch (error) { if (!controller.signal.aborted) setError(t('classes.failed', { message: error.message })); }
    };
    const pan = event => {
      if (event.button !== 0 || event.target.closest('.jb-class-card,button')) return;
      const element = scroll.current, start = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
      element.setPointerCapture(event.pointerId);
      const move = e => { element.scrollLeft = start.left - e.clientX + start.x; element.scrollTop = start.top - e.clientY + start.y; };
      const end = () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); element.removeEventListener('lostpointercapture', end); };
      element.addEventListener('pointermove', move); element.addEventListener('pointerup', end); element.addEventListener('lostpointercapture', end);
    };
    const positioned = new Map(selection?.nodes.map(n => [n.id, n]) ?? []);
    return h('section', { ref: root, tabIndex: -1, role: 'region', 'aria-label': t('classes.title'), className: 'jb-class-window', 'data-dock': dock, 'data-view': mode,
      onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } } },
      h('header', null, h('strong', null, title), context.supported ? h('span', { className: 'jb-class-beta', title: t('classes.betaHint') }, t('classes.beta')) : null,
        context.supported ? h('div', { role: 'tablist', 'aria-label': t('classes.view'), className: 'jb-class-mode', onKeyDown: event => {
          if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const value = event.key === 'Home' ? 'tree' : event.key === 'End' ? 'graph' : mode === 'tree' ? 'graph' : 'tree';
          changeMode(value); root.current?.querySelector('[data-class-view="' + value + '"]')?.focus({ preventScroll: true });
        } }, ...['tree', 'graph'].map(value => h('button', { key: value, id: modeId + '-' + value, type: 'button', role: 'tab', tabIndex: mode === value ? 0 : -1, 'data-class-view': value, 'aria-selected': mode === value, 'aria-controls': modeId + '-panel', onClick: () => changeMode(value) }, t('classes.' + value)))) : null, h('span', { className: 'jb-spacer' }),
        h('label', null, t('classes.dock'), ' ', h('select', { value: dock, onChange: e => onDock(e.target.value) }, ...['right', 'bottom'].map(value => h('option', { key: value, value }, t('classes.' + value))))),
        h('button', { type: 'button', onClick: () => { opening.current?.abort(); onClose(); }, 'aria-label': t('classes.close') }, '×')),
      context.supported ? h('div', { className: 'jb-class-controls' },
        h('input', { type: 'search', value: query, 'aria-label': t('classes.search'), placeholder: t('classes.search'), onChange: e => setQuery(e.target.value) }),
        h('button', { type: 'button', disabled: busy, onClick: () => setRevision(n => n + 1) }, t('classes.refresh')),
        h('button', { type: 'button', onClick: () => show(null) }, t('classes.all')),
        mode === 'graph' ? h(React.Fragment, null, h('button', { type: 'button', 'aria-label': t('classes.zoomOut'), disabled: zoom <= .1, onClick: () => { setAutoFit(false); setZoom(z => Math.max(.1, z - .2)); } }, '−'),
        h('button', { type: 'button', 'aria-label': t('classes.zoomReset'), onClick: () => { setAutoFit(false); setZoom(1); } }, Math.round(zoom * 100) + '%'),
        h('button', { type: 'button', 'aria-label': t('classes.zoomIn'), disabled: zoom >= 2, onClick: () => { setAutoFit(false); setZoom(z => Math.min(2, z + .2)); } }, '+'),
        h('button', { type: 'button', 'aria-label': t('classes.fit'), title: t('classes.fit'), 'aria-pressed': autoFit, onClick: () => setAutoFit(true) }, h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true }, h('path', { d: 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6' })))) : null) : null,
      query && graph ? h('div', { className: 'jb-class-results', role: 'list', 'aria-label': t('classes.search') }, ...graph.nodes.filter(n => (n.qualified + ' ' + n.path).toLowerCase().includes(query.toLowerCase())).slice(0, 50).map(n => h('button', { type: 'button', key: n.id, onClick: () => { show(n.id); setQuery(''); } }, n.qualified + ' · ' + n.path))) : null,
      context.supported ? h('div', { className: 'jb-class-info' },
      h('div', { className: 'jb-class-hint' }, t(mode === 'tree' ? 'classes.treeHint' : 'classes.hint')),
      mode === 'graph' ? h('div', { className: 'jb-class-legend' }, h('span', { className: 'jb-class-legend-inherit' }, t('classes.inherits')), h('span', { className: 'jb-class-legend-protocol' }, t('classes.protocolBase')), h('span', { className: 'jb-class-legend-factory' }, t('classes.factory')), h('span', { className: 'jb-class-legend-field' }, t('classes.fieldAssociation')), h('span', null, t('classes.abstractHint'))) : null,
      selection?.edges.some(edge => edge.kind === 'factory') ? h('details', { className: 'jb-class-evidence' },
        h('summary', { title: t('classes.factoryHint') }, t('classes.evidence')),
        h('div', null, h('div', { className: 'jb-class-hint' }, t('classes.factoryHint')), ...selection.edges.filter(edge => edge.kind === 'factory').flatMap(edge => edge.evidence.map((row, index) => h('button', { type: 'button', key: edge.from + ':' + edge.to + ':' + index, title: row.path + ':' + (row.line + 1) + ' · ' + t('classes.open'), onClick: () => jump(row, row) },
          positioned.get(edge.from).qualified + ' → ' + positioned.get(edge.to).qualified + ' · ' + row.function + ' · ' + row.path + ':' + (row.line + 1)))))) : null,
      busy ? h('div', { role: 'status' }, t('loading')) : null,
      error ? h('div', { role: 'alert', className: 'jb-class-hint' }, error) : null,
      graph?.limited || selection?.limited ? h('div', { role: 'status', className: 'jb-class-hint' }, t('classes.limited')) : null,
      graph?.skipped.length ? h('details', { className: 'jb-class-hint' }, h('summary', null, t('classes.skipped', { n: String(graph.skipped.length) })), ...graph.skipped.map(row => h('div', { key: row.path }, row.path + ' · ' + row.code))) : null,
      graph && !graph.nodes.length && !busy ? h('div', { className: 'jb-class-hint' }, t('classes.empty')) : null) : null,
      !context.supported ? h('div', { className: 'jb-class-unavailable', role: 'status' }, t(context.source === 'loading' ? 'classes.detecting' : context.source === 'external' ? 'classes.externalUnsupported' : context.source === 'mixed' ? 'classes.mixedUnsupported' : context.language ? context.source === 'file' ? 'classes.unsupportedFile' : 'classes.unsupportedProject' : 'classes.choosePython', { language })) :
      mode === 'tree' && selection ? h(ClassHierarchy, { panelId: modeId + '-panel', labelId: modeId + '-tree', selection, expansion, onExpansion: setExpansion, focus, revealKey: treeReveal, onSelect: id => show(id, false), onOpen: jump, t }) :
      h('div', { className: 'jb-class-viewport', id: modeId + '-panel', role: 'tabpanel', 'aria-labelledby': modeId + '-graph', ref: scroll, onPointerDown: pan }, layout ? h('div', { className: 'jb-class-stage', style: { width: layout.width * zoom, height: layout.height * zoom } },
        h('div', { className: 'jb-class-canvas', style: { width: layout.width, height: layout.height, transform: `scale(${zoom})` } },
          h('svg', { width: layout.width, height: layout.height, 'aria-hidden': true, className: 'jb-class-links' }, ...layout.edges.map(edge => {
            const parent = positioned.get(edge.to), points = [...edge.points].reverse();
            const end = points.at(-1), before = points.at(-2) ?? end;
            const direction = end.y < before.y ? 1 : -1;
            const lineEnd = { x: end.x, y: end.y + direction * 9 };
            let d = `M${points[0].x},${points[0].y}`;
            if (points.length <= 3) d += ` V${(points[0].y + lineEnd.y) / 2} H${lineEnd.x} V${lineEnd.y}`;
            else for (let i = 1; i < points.length; i++) {
              const a = points[i - 1], b = i === points.length - 1 ? lineEnd : points[i];
              if (Math.abs(a.x - b.x) > 1 && Math.abs(a.y - b.y) > 1) d += ` V${(a.y + b.y) / 2} H${b.x} V${b.y}`;
              else d += ` L${b.x},${b.y}`;
            }
            return h('g', { key: edge.from + ':' + edge.to + ':' + (edge.kind ?? 'inherit'), 'data-protocol': parent.kind === 'protocol', 'data-factory': edge.kind === 'factory', 'data-field': edge.kind === 'field' }, h('title', null, t(edge.kind === 'field' ? 'classes.fieldAssociation' : edge.kind === 'factory' ? 'classes.factoryHint' : parent.kind === 'protocol' ? 'classes.protocolBase' : 'classes.inherits')), h('path', { className: 'jb-class-edge', d, fill: 'none' }), h('path', { className: 'jb-class-arrow', d: ['factory', 'field'].includes(edge.kind) ? `M${end.x - 5},${end.y + direction * 9} L${end.x},${end.y} l5,${direction * 9}` : `M${end.x},${end.y} l-5,${direction * 9} h10 z` }));
          })),
          ...layout.nodes.map(node => h('article', { key: node.id, className: 'jb-class-card', 'data-selected': focus === node.id, 'data-kind': node.kind, style: { left: node.x, top: node.y, width: node.width, height: node.height }, 'aria-label': node.qualified },
            h('div', { className: 'jb-class-heading' },
              h('span', { className: 'jb-class-symbol', title: t('classes.' + node.kind), 'aria-label': t('classes.' + node.kind) }, node.kind === 'protocol' ? 'P' : node.kind === 'abstract' || node.kind === 'abc' ? 'A' : 'C'),
              h('button', { type: 'button', className: 'jb-class-name', title: node.qualified + ' · ' + t('classes.open') + ' · ' + node.path, onClick: () => show(node.id, false), onDoubleClick: () => jump(node), onKeyDown: e => { if (e.key === 'F4' || e.key === 'Enter') { e.preventDefault(); jump(node); } } }, node.qualified)),
            h('div', { className: 'jb-class-path', title: node.path }, node.path + ':' + (node.line + 1)),
            h('div', { className: 'jb-class-members' },
              ...(node.fields ?? []).map(field => h('button', { key: 'field:' + field.name, type: 'button', onClick: () => jump(node, field), title: field.name + ': ' + field.annotation },
                h('span', { className: 'jb-class-method-symbol', 'aria-hidden': true }, 'f'),
                h('span', { className: 'jb-class-method-name' }, field.name),
                h('span', { className: 'jb-class-return' }, field.annotation))),
              ...node.methods.map(method => h('button', { key: method.name + ':' + method.line, type: 'button', onClick: () => jump(node, method), title: `${method.name}(${method.parameters ?? ''})${method.returns ? ' → ' + method.returns : ''}`, 'data-abstract': node.abstractMethods.includes(method.name) },
              h('span', { className: 'jb-class-method-symbol', 'aria-hidden': true }, node.overrides.includes(method.name) ? '↥' : 'm'),
              h('span', { className: 'jb-class-method-name' }, method.name, h('span', { className: 'jb-class-parameters' }, '(' + (method.parameters ?? '') + ')')),
              method.returns ? h('span', { className: 'jb-class-return' }, method.returns) : null))),
            node.unresolved.length ? h('div', { className: 'jb-class-unresolved', title: node.unresolved.join(', ') }, t('classes.unresolved') + ': ' + node.unresolved.join(', ')) : null,
            node.decorated ? h('div', { className: 'jb-class-unresolved' }, t('classes.decorated')) : null)))) : null));
  };
}
