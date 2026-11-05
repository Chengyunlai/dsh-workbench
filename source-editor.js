/** Continuous, read-only source editor with JetBrains-style pointer and keyboard navigation. */
import { EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, gutter, GutterMarker, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, hoverTooltip, tooltips, closeHoverTooltips, hasHoverTooltips, activateHover } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { LanguageSupport, StreamLanguage, syntaxTree, syntaxHighlighting, bracketMatching, foldGutter, foldKeymap, foldEffect, unfoldEffect, foldedRanges } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { python } from '@codemirror/lang-python';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { makefile } from 'codemirror-lang-makefile';
import { tags, styleTags, tagHighlighter, highlightTree } from '@lezer/highlight';

const fenceExtensions = { js: 'js', javascript: 'js', node: 'js', jsx: 'jsx', ts: 'ts', typescript: 'ts', tsx: 'tsx', py: 'py', python: 'py', go: 'go', golang: 'go', java: 'java', json: 'json', jsonc: 'jsonc', yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', ini: 'ini', make: 'mk', makefile: 'mk' };
const fencePath = info => { const extension = fenceExtensions[info.trim().split(/\s/)[0].toLowerCase()]; return extension ? 'fence.' + extension : null; };

function sourceLanguage(path) {
  let support, rules;
  if (/\.(?:md|markdown|mdown)$/i.test(path)) {
    return markdown({ base: markdownLanguage, addKeymap: false, completeHTMLTags: false, pasteURLAsLink: false,
      codeLanguages: info => {
        const path = fencePath(info);
        return path ? sourceLanguage(path).language : null;
      } });
  }
  if (/\.json$/i.test(path)) return json();
  if (/\.ya?ml$/i.test(path)) return yaml();
  if (/\.toml$/i.test(path)) return new LanguageSupport(StreamLanguage.define(toml));
  if (/\.(?:mk|mak)$/i.test(path) || /(?:^|\/)(?:GNUmakefile|Makefile)(?:\.[^/]*)?$/i.test(path)) return makefile();
  if (/\.(?:ini|cfg|conf|properties|env)$/i.test(path) || /(?:^|\/)\.env(?:\.[^/]*)?$/i.test(path)) return new LanguageSupport(StreamLanguage.define({ ...properties,
    token(stream, state) { const token = properties.token(stream, state); return token === 'def' ? 'property' : token === 'quote' ? 'string' : token; },
  }));
  if (/\.(?:sh|bash|zsh)$/i.test(path) || /(?:^|\/)\.(?:bashrc|zshrc|profile)$/i.test(path)) return new LanguageSupport(StreamLanguage.define(shell));
  if (/\.(?:[cm]?[jt]s|[jt]sx|jsonc)$/i.test(path)) {
    support = javascript({ typescript: /\.(?:[cm]?ts|tsx)$/i.test(path), jsx: /\.[jt]sx$/i.test(path) });
    rules = { 'Decorator/...': tags.annotation };
  } else if (/\.go$/i.test(path)) {
    support = go();
    rules = { 'MethodDecl/FieldName': tags.function(tags.definition(tags.propertyName)) };
  } else if (/\.java$/i.test(path)) {
    support = java();
    rules = {
      'ClassDeclaration/Definition InterfaceDeclaration/Definition EnumDeclaration/Definition RecordDeclaration/Definition': tags.definition(tags.className),
      'MethodDeclaration/Definition ConstructorDeclaration/Definition': tags.function(tags.definition(tags.variableName)),
      'MarkerAnnotation/... Annotation/...': tags.annotation,
    };
  } else if (/\.pyi?$/i.test(path)) {
    support = python();
    rules = { 'Decorator/...': tags.annotation, 'TypeDef/...': tags.typeName };
  } else return [];
  return new LanguageSupport(support.language.configure({ props: [styleTags(rules)] }), support.support);
}

const sourceHighlighting = tagHighlighter([
  { tag: [tags.keyword, tags.modifier, tags.bool, tags.null, tags.self], class: 'jb-syntax-keyword' },
  { tag: [tags.string, tags.character, tags.regexp], class: 'jb-syntax-string' },
  { tag: tags.number, class: 'jb-syntax-number' },
  { tag: tags.comment, class: 'jb-syntax-comment' },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'jb-syntax-type' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'jb-syntax-function' },
  { tag: [tags.propertyName, tags.attributeName], class: 'jb-syntax-property' },
  { tag: [tags.meta, tags.annotation], class: 'jb-syntax-annotation' },
  { tag: tags.escape, class: 'jb-syntax-escape' },
  { tag: [tags.operator, tags.punctuation], class: 'jb-syntax-punctuation' },
  { tag: [tags.atom, tags.literal], class: 'jb-syntax-number' },
  { tag: tags.heading, class: 'jb-markdown-heading' },
  { tag: tags.strong, class: 'jb-markdown-strong' },
  { tag: tags.emphasis, class: 'jb-markdown-emphasis' },
  { tag: tags.strikethrough, class: 'jb-markdown-strike' },
  { tag: tags.link, class: 'jb-markdown-link' },
  { tag: tags.url, class: 'jb-markdown-url' },
  { tag: tags.monospace, class: 'jb-markdown-code' },
  { tag: tags.quote, class: 'jb-markdown-quote' },
  { tag: [tags.processingInstruction, tags.contentSeparator], class: 'jb-markdown-mark' },
  { tag: tags.labelName, class: 'jb-syntax-type' },
]);

/** Escape source text for highlighted HTML without interpreting document markup.
 * @param text - Literal source text.
 * @returns HTML text with markup delimiters and quotes escaped.
 */
export function escapeSource(text) {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

/** Highlight a Markdown code fence with the same parser and classes as the source reader.
 * @param text - Literal fenced code.
 * @param info - Fence language and optional metadata; unknown languages remain literal text.
 * @returns Escaped HTML containing only owned syntax spans.
 */
export function highlightDocumentCode(text, info = '') {
  const path = fencePath(info), support = path ? sourceLanguage(path) : null;
  if (!support) return escapeSource(text);
  let result = '', position = 0;
  highlightTree(support.language.parser.parse(text), sourceHighlighting, (from, to, classes) => {
    result += escapeSource(text.slice(position, from)) + '<span class="' + classes + '">' + escapeSource(text.slice(from, to)) + '</span>';
    position = to;
  });
  return result + escapeSource(text.slice(position));
}

const debugEffect = StateEffect.define();
const debugField = StateField.define({
  create: () => ({ breakpoints: [], currentLine: null, selectedLine: null }),
  update(value, transaction) { for (const effect of transaction.effects) if (effect.is(debugEffect)) return effect.value; return value; },
});
class BreakpointMarker extends GutterMarker {
  constructor(enabled, verified, current, label) { super(); this.enabled = enabled; this.verified = verified; this.current = current; this.label = label; }
  eq(other) { return this.enabled === other.enabled && this.verified === other.verified && this.current === other.current; }
  toDOM() { const span = document.createElement('span'); span.className = 'jb-breakpoint' + (this.enabled ? ' jb-breakpoint-enabled' : '') + (this.verified ? ' jb-breakpoint-verified' : '') + (this.current ? ' jb-debug-current' : ''); span.title = this.label; span.setAttribute('aria-label', this.label); span.textContent = this.current ? '▶' : this.enabled ? this.verified ? '●' : '○' : ''; return span; }
}
const debugLines = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(debugEffect)) {
      const { breakpoints, currentLine, selectedLine } = effect.value;
      return Decoration.set([
        ...breakpoints.map(point => [point.line, 'jb-breakpoint-line']),
        [currentLine, 'jb-debug-line'], [selectedLine, 'jb-debug-frame-line'],
      ].flatMap(([line, className]) => {
        return line && line <= transaction.state.doc.lines ? [Decoration.line({ class: className }).range(transaction.state.doc.line(line).from)] : [];
      }), true);
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

const inlineEffect = StateEffect.define();
class InlineValue extends WidgetType {
  constructor(items, actions) { super(); this.items = items; this.actions = actions; }
  toDOM(view) {
    const span = document.createElement('span');
    span.className = 'jb-debug-inline';
    this.items.forEach(({ variable, target }, index) => {
      const button = (text, label, action, className) => {
        const element = document.createElement('button');
        element.type = 'button'; element.textContent = text; element.title = label; element.className = className;
        element.addEventListener('click', event => { event.stopPropagation(); action(element); });
        return element;
      };
      const inspect = text => button(text, this.actions.inspectLabel + ' · ' + variable.name,
        anchor => this.actions.inspect(view, target, variable, anchor), '');
      span.append(index ? '  ·  ' : '  ', inspect(variable.name));
      if (variable.type) span.append(': ', button(variable.type, this.actions.typeLabel + ' · ' + variable.type,
        () => this.actions.type(view, target), 'jb-debug-inline-type'));
      span.append(' = ', inspect(variable.value.replace(/\s*\n\s*/g, ' ')));
    });
    return span;
  }
}
const inlineValues = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(inlineEffect)) return Decoration.set(effect.value.map(item =>
      Decoration.widget({ widget: new InlineValue(item.values, item.actions), side: 1 }).range(transaction.state.doc.line(item.line).to)), true);
    return transaction.docChanged ? Decoration.none : value;
  },
  provide: field => EditorView.decorations.from(field),
});

/** Match adapter locals to parsed identifiers through the selected frame's paused line.
 * @param state - Parsed source document.
 * @param lineNumber - One-based paused line.
 * @param variables - Adapter variables in scope order; nearest bindings win.
 * @returns Line-end annotations with values and available types.
 */
export function debugInlineValues(state, lineNumber, variables) {
  if (!lineNumber || lineNumber > state.doc.lines) return [];
  const line = state.doc.line(lineNumber), tree = syntaxTree(state);
  const isFunction = node => /^(?:FunctionDeclaration|FunctionExpression|ArrowFunction|FunctionDefinition|MethodDeclaration|MethodDecl|FunctionDecl|ConstructorDeclaration)$/.test(node.name);
  let owner = tree.resolveInner(line.from + line.text.search(/\S|$/), 1);
  while (owner.parent && !isFunction(owner)) owner = owner.parent;
  const bindings = new Map(), lines = new Map();
  for (const variable of variables) if (!bindings.has(variable.name)) bindings.set(variable.name, variable);
  tree.iterate({ from: owner.from, to: line.to, enter(node) {
    if (isFunction(node) && node.from !== owner.from) return false;
    if (!/^(?:VariableName|VariableDefinition|DefName|Identifier|self|this)$/.test(node.name)) return;
    const target = debugHoverAt(state, node.from + 1, -1);
    const variable = target && !target.expression.includes('.') ? bindings.get(target.expression) : null;
    if (!variable) return;
    const number = state.doc.lineAt(node.from).number;
    if (!lines.has(number)) lines.set(number, new Map());
    lines.get(number).set(variable.name, { variable, target });
  } });
  return [...lines].map(([line, values]) => ({ line, values: [...values.values()] }));
}

const linkEffect = StateEffect.define();
const linkField = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(linkEffect)) {
      return effect.value ? Decoration.set([Decoration.mark({ class: 'jb-definition-link' }).range(effect.value.from, effect.value.to)]) : Decoration.none;
    }
    return transaction.docChanged ? Decoration.none : value;
  },
  provide: field => EditorView.decorations.from(field),
});

function wordAt(state, position) {
  const line = state.doc.lineAt(position);
  const column = position - line.from;
  for (const match of line.text.matchAll(/[$\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*/gu)) {
    if (column >= match.index && column <= match.index + match[0].length) return { from: line.from + match.index, to: line.from + match.index + match[0].length };
  }
  return null;
}

/** Resolve the variable/member path ending at the hovered identifier, excluding literals, comments and computed receivers.
 * @param state - Parsed source document.
 * @param position - UTF-16 source position.
 * @param side - Pointer side at a token edge.
 * @returns The source range and literal dotted lookup path, or null outside supported identifiers.
 */
export function debugHoverAt(state, position, side = 1) {
  const word = wordAt(state, position);
  if (!word || (position === word.from && side < 0) || (position === word.to && side > 0)) return null;
  const node = syntaxTree(state).resolveInner(word.from + Math.min(1, word.to - word.from), -1);
  if (!/^(?:VariableName|VariableDefinition|DefName|Definition|Identifier|PropertyName|FieldName|TypeName|self|this)$/.test(node.name)) return null;
  const line = state.doc.lineAt(word.from), prefix = state.sliceDoc(line.from, word.to);
  const name = '[$\\p{ID_Start}][$\\u200c\\u200d\\p{ID_Continue}]*';
  const match = new RegExp(name + '(?:\\s*(?:\\?\\.|\\.)\\s*' + name + ')*$', 'u').exec(prefix);
  if (!match || /[.\p{ID_Continue}\])?]$/u.test(prefix.slice(0, match.index))) return null;
  const expression = match[0].split(/\s*(?:\?\.|\.)\s*/u).join('.');
  if (expression.length > 512 || expression.split('.').length > 16 || (/^(PropertyName|FieldName)$/.test(node.name) && !expression.includes('.'))) return null;
  return { from: line.from + match.index, to: word.to, expression };
}

/**
 * Choose how a navigation target enters the viewport: keep an already comfortable target
 * untouched, center one that would sit flush against a vertical edge, and pull back only
 * horizontally for a target that left the side.
 * @param box - Scroll viewport bounds of the editor in client coordinates.
 * @param coords - Rendered bounds of the target, or null when it is not rendered.
 * @returns Scroll options for the target, or null when the current scroll already shows it.
 */
export function navigationScrollOptions(box, coords) {
  if (!coords || box.height <= 0) return { y: 'center' };
  const margin = Math.min(80, box.height / 4);
  if (coords.top < box.top + margin || coords.bottom > box.bottom - margin) return { y: 'center' };
  if (coords.left < box.left || coords.right > box.right) return { y: 'nearest', x: 'nearest' };
  return null;
}

/**
 * Mount a source reader; callers own its returned disposer.
 * @param parent - Empty editor container.
 * @param options - Source, initial position, localized name, and callbacks scoped to this reader.
 * @returns Focus, caret/viewport/fold snapshots, reveal, host-source replacement and disposal actions; user edits remain disabled.
 */
export function createSourceEditor(parent, options) {
  let sourceVersion = options.version, inspectionKey = null, hoverTimer = null, hoverTarget = null, clickedValue = null;
  const inspection = hoverTooltip((view, position, side) => {
    if (!inspectionKey || (!clickedValue && (view.state.field(linkField).size || view.state.field(inspection.active).some(item => item.clicked)))) return null;
    const clicked = clickedValue;
    const target = clicked?.target ?? debugHoverAt(view.state, position, side);
    if (!target) return null;
    const key = inspectionKey;
    return { pos: target.from, end: target.to, above: false, clicked: Boolean(clicked),
      create() {
        const dom = document.createElement('div'); dom.className = 'jb-debug-hover';
        return { dom, offset: { x: 0, y: 6 },
          ...(clicked ? { getCoords: () => clicked.anchor.getBoundingClientRect() } : {}),
          mount: () => options.onHoverMount({ dom, key, expression: target.expression,
            at: positionAt(view, target.to - 1), variable: clicked?.variable }),
          destroy: () => options.onHoverUnmount(dom) };
      } };
  }, { hideOnChange: true });
  const positionAt = (view, offset = view.state.selection.main.head) => {
    const line = view.state.doc.lineAt(offset);
    return { line: line.number - 1, character: offset - line.from };
  };
  const inlineActions = {
    inspectLabel: options.inspectLabel, typeLabel: options.typeLabel,
    inspect(view, target, variable, anchor) {
      if (!inspectionKey) return;
      clearTimeout(hoverTimer); hoverTarget = null;
      clickedValue = { target, variable, anchor };
      try { activateHover(view, target.from, 1, { tooltip: inspection }); }
      finally { clickedValue = null; }
    },
    type(view, target) {
      if (!inspectionKey) return;
      options.onTypeDefinition(positionAt(view, target.to - 1));
    },
  };
  const offsetAt = (state, position) => {
    const line = state.doc.line(Math.min(Math.max(1, position.line + 1), state.doc.lines));
    return line.from + Math.min(Math.max(0, position.character ?? 0), line.length);
  };
  const define = view => {
    const head = view.state.selection.main.head, word = wordAt(view.state, head);
    if (word) options.onDefinition(positionAt(view, Math.min(head, word.to - 1)));
    return true;
  };
  const contextMenu = view => {
    const box = view.coordsAtPos(view.state.selection.main.head);
    options.onContextMenu({ x: box?.left ?? 8, y: box?.bottom ?? 8 }, positionAt(view)); return true;
  };
  const createState = (text, path) => EditorState.create({ doc: text, extensions: [
    EditorState.readOnly.of(true), EditorState.tabSize.of(2), EditorView.editable.of(false),
    EditorState.phrases.of(options.foldPhrases),
    EditorState.phrases.of(options.searchPhrases ?? {}),
    EditorView.contentAttributes.of({ tabindex: '0', 'aria-label': options.label, 'aria-readonly': 'true' }),
    debugField, debugLines, inlineValues, inspection, tooltips({ parent: document.body, position: 'fixed' }),
    gutter({ class: 'jb-breakpoints', lineMarker: (view, line) => { const number = view.state.doc.lineAt(line.from).number, value = view.state.field(debugField); const point = value.breakpoints.find(item => item.line === number); return new BreakpointMarker(Boolean(point), point?.verified === true, value.currentLine === number, options.breakpointLabel); }, lineMarkerChange: update => update.transactions.some(transaction => transaction.effects.some(effect => effect.is(debugEffect))), domEventHandlers: { mousedown: (view, line, event) => { event.preventDefault(); options.onToggleBreakpoint(view.state.doc.lineAt(line.from).number); return true; } } }),
    lineNumbers(), foldGutter(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), bracketMatching(),
    highlightSelectionMatches({ highlightWordAroundCursor: true, wholeWords: true }),
    search({ top: true }),
    keymap.of(searchKeymap.filter(binding => ['Mod-f', 'Mod-g', 'Mod-Shift-g', 'F3', 'Shift-F3', 'Escape'].includes(binding.key))),
    syntaxHighlighting(sourceHighlighting), sourceLanguage(path),
    linkField,
    Prec.highest(keymap.of([
      { key: 'Escape', run: view => { if (!hasHoverTooltips(view.state)) return false; view.dispatch({ effects: closeHoverTooltips }); return true; }, stopPropagation: true },
      { key: 'Mod-b', run: define, stopPropagation: true },
      { key: 'F9', run: view => { options.onToggleBreakpoint(positionAt(view).line + 1); return true; }, stopPropagation: true },
      ...[['F5', 'run'], ['Shift-F5', 'stop'], ['F8', 'next'], ['F7', 'stepIn'], ['Shift-F8', 'stepOut'], ['Alt-F5', 'pause'], ['Alt-F8', 'evaluate']].map(([key, action]) => ({ key, run: () => { options.onDebug(action); return true; }, stopPropagation: true })),
      { key: 'F12', run: define, stopPropagation: true },
      { key: 'Shift-F10', run: contextMenu, stopPropagation: true },
      { key: 'Ctrl-g', mac: 'Meta-l', run: () => { options.onGoLine(); return true; }, stopPropagation: true },
      { key: 'Mod-[', run: view => { options.onBack(positionAt(view)); return true; }, stopPropagation: true },
      { key: 'Mod-]', run: view => { options.onForward(positionAt(view)); return true; }, stopPropagation: true },
      { key: 'Ctrl-Alt-ArrowLeft', mac: 'Meta-Alt-ArrowLeft', run: view => { options.onBack(positionAt(view)); return true; }, stopPropagation: true },
      { key: 'Ctrl-Alt-ArrowRight', mac: 'Meta-Alt-ArrowRight', run: view => { options.onForward(positionAt(view)); return true; }, stopPropagation: true },
    ])),
    keymap.of(foldKeymap.map(binding => ({ ...binding, stopPropagation: true }))),
    keymap.of(defaultKeymap),
    EditorView.updateListener.of(update => { if (update.selectionSet) options.onPosition(positionAt(update.view)); }),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button === 3 || event.button === 4) {
          event.preventDefault(); event.stopPropagation();
          (event.button === 3 ? options.onBack : options.onForward)(positionAt(view)); return true;
        }
        if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false;
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position === null) return false;
        event.preventDefault(); view.focus();
        view.dispatch({ selection: { anchor: position } }); define(view); return true;
      },
      contextmenu(event, view) {
        event.preventDefault();
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const selected = view.state.selection.main;
        if (position !== null && (selected.empty || position < selected.from || position > selected.to)) view.dispatch({ selection: { anchor: position } });
        options.onContextMenu({ x: event.clientX, y: event.clientY }, positionAt(view)); return true;
      },
      mousemove(event, view) {
        if (event.target.closest?.('.jb-debug-inline')) {
          clearTimeout(hoverTimer); hoverTarget = null;
          return;
        }
        if (!event.sourceCapabilities?.firesTouchEvents && inspectionKey && !event.metaKey && !event.ctrlKey) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          const target = pos === null ? null : debugHoverAt(view.state, pos, -1);
          if (target?.from !== hoverTarget) {
            clearTimeout(hoverTimer); hoverTarget = target?.from;
            if (target) hoverTimer = setTimeout(() => activateHover(view, pos, -1, { tooltip: inspection,
              until: transaction => transaction.selection !== undefined }), 200);
          }
        }
        const position = event.metaKey || event.ctrlKey ? view.posAtCoords({ x: event.clientX, y: event.clientY }) : null;
        const range = position === null ? null : wordAt(view.state, position);
        const current = view.state.field(linkField);
        if (range || current.size) view.dispatch({ effects: linkEffect.of(range) });
      },
      keyup(event, view) { if (!event.metaKey && !event.ctrlKey && view.state.field(linkField).size) view.dispatch({ effects: linkEffect.of(null) }); },
      mouseleave(event, view) { clearTimeout(hoverTimer); hoverTarget = null; if (view.state.field(linkField).size) view.dispatch({ effects: linkEffect.of(null) }); },
      blur(event, view) { if (view.state.field(linkField).size) view.dispatch({ effects: linkEffect.of(null) }); },
    }),
    EditorView.theme({
      '&': { backgroundColor: options.colors.bg, color: options.colors.code, fontSize: '12.5px' },
      '&.cm-editor': { height: '100%' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', lineHeight: '22px' },
      '.cm-content': { caretColor: options.colors.text, padding: '6px 0' },
      '.cm-panels': { backgroundColor: options.colors.panel, color: options.colors.text, borderColor: options.colors.border },
      '.cm-search': { padding: '6px 8px', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', fontSize: '12px' },
      '.cm-search .cm-textfield, .cm-search .cm-button': { background: options.colors.bg, color: options.colors.text, border: '1px solid ' + options.colors.border, borderRadius: '3px', font: 'inherit' },
      '.cm-search input[type=checkbox]': { accentColor: options.colors.accent },
      '.cm-searchMatch': { backgroundColor: options.colors.textSelection, outline: '1px solid ' + options.colors.border },
      '.cm-searchMatch-selected': { backgroundColor: options.colors.textSelection, outline: '1px solid ' + options.colors.accent },
      '.cm-gutters': { backgroundColor: options.colors.gutter, color: options.colors.textDim, borderRight: '1px solid ' + options.colors.border },
      '.cm-foldGutter .cm-gutterElement': { padding: '0 2px', minWidth: '14px', textAlign: 'center' },
      '.cm-foldGutter span': { color: options.colors.textDim, fontSize: '16px', lineHeight: '22px' },
      '.cm-foldGutter span:hover': { color: options.colors.accent },
      '.cm-foldPlaceholder': { backgroundColor: options.colors.panel, color: options.colors.text, borderWidth: '1px', borderStyle: 'solid', borderColor: options.colors.border, borderRadius: '3px', padding: '0 4px' },
      '.cm-foldPlaceholder:hover': { backgroundColor: options.colors.hover, borderColor: options.colors.accent },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: options.colors.hover },
      // Match the focused base-theme selector so its light palette cannot override host colors.
      '.cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: options.colors.textSelection },
      '.cm-content::selection, .cm-content ::selection': { backgroundColor: options.colors.textSelection, color: options.colors.code },
      '.cm-selectionMatch': { backgroundColor: options.colors.textSelection, borderRadius: '2px' },
      '.cm-selectionMatch-main': { outline: '1px solid ' + options.colors.accent, outlineOffset: '-1px' },
      '.jb-breakpoint': { display: 'inline-block', width: '16px', height: '22px', cursor: 'pointer', color: options.colors.textDim, textAlign: 'center' },
      '.jb-breakpoint-enabled': { color: options.colors.deleted, opacity: '.5' },
      '.jb-breakpoint-verified': { opacity: '1' },
      '.jb-breakpoint-line': {
        '--jb-breakpoint-tint': 'color-mix(in srgb, ' + options.colors.deleted + ' 18%, transparent)',
        backgroundImage: 'linear-gradient(var(--jb-breakpoint-tint), var(--jb-breakpoint-tint))',
      },
      '.jb-debug-current': { color: options.colors.accent, opacity: '1' },
      '.jb-debug-inline': { color: options.colors.textDim, fontStyle: 'italic', whiteSpace: 'pre', userSelect: 'none' },
      '.jb-debug-inline button': { background: 'none', border: '0', padding: '0', color: 'inherit', font: 'inherit', cursor: 'pointer' },
      '.jb-debug-inline button:hover, .jb-debug-inline button:focus-visible': { textDecoration: 'underline' },
      '.jb-debug-inline .jb-debug-inline-type': { color: options.colors.accent },
      '.jb-debug-line': { backgroundColor: options.colors.selection },
      '.jb-debug-frame-line': { backgroundColor: options.colors.hover, boxShadow: 'inset 2px 0 ' + options.colors.accent },
      '.cm-cursor': { borderLeftColor: options.colors.text },
      '.cm-matchingBracket': { backgroundColor: options.colors.selection, outline: '1px solid ' + options.colors.accent },
      '.cm-nonmatchingBracket': { color: options.colors.deleted },
      ...Object.fromEntries(Object.entries(options.colors.syntax).map(([role, color]) => ['.jb-syntax-' + role, { color }])),
      '.jb-markdown-heading': { color: options.colors.accent, fontWeight: '500' },
      '.jb-markdown-strong': { color: options.colors.text, fontWeight: '500' },
      '.jb-markdown-emphasis': { fontStyle: 'italic' },
      '.jb-markdown-strike': { textDecoration: 'line-through' },
      '.jb-markdown-link': { color: options.colors.accent },
      '.jb-markdown-url': { color: options.colors.accent, textDecoration: 'underline' },
      '.jb-markdown-code': { color: options.colors.syntax.string, backgroundColor: options.colors.panel, borderRadius: '3px' },
      '.jb-markdown-quote': { color: options.colors.textDim, fontStyle: 'italic' },
      '.jb-markdown-mark': { color: options.colors.textDim },
      '.jb-definition-link': { color: options.colors.accent, textDecoration: 'underline', cursor: 'pointer' },
    }),
  ] });
  const view = new EditorView({ parent, state: createState(options.text, options.path) });
  // Navigation keeps a target that is already comfortably visible where it is; anything
  // else is centered (or pulled back horizontally) so the code around the destination is
  // readable without another scroll.
  const reveal = (position, center = false) => {
    const anchor = offsetAt(view.state, position);
    let scroll = null;
    if (position.viewport && position.viewport.version === sourceVersion) scroll = position.viewport.effect;
    else {
      const options = center ? { y: 'center' } : navigationScrollOptions(view.scrollDOM.getBoundingClientRect(), view.coordsAtPos(anchor));
      if (options) scroll = EditorView.scrollIntoView(anchor, options);
    }
    view.dispatch(scroll ? { selection: { anchor }, effects: scroll } : { selection: { anchor } });
  };
  const restoreFolds = position => {
    if (position.folding?.version === sourceVersion) view.dispatch({ effects: position.folding.ranges.map(range => foldEffect.of(range)) });
  };
  restoreFolds(options.position);
  reveal(options.position, true);
  if (options.takeFocus) view.focus();
  const dismiss = event => { clearTimeout(hoverTimer); if (!view.dom.contains(event.target) && !event.target.closest?.('.jb-debug-hover')) view.dispatch({ effects: closeHoverTooltips }); };
  document.addEventListener('pointerdown', dismiss, true);
  return {
    setInlineValues: (line, variables) => view.dispatch({ effects: inlineEffect.of(debugInlineValues(view.state, line, variables).map(item => ({ ...item, actions: inlineActions }))) }),
    setInspection: key => { if (key !== inspectionKey) { inspectionKey = key; clearTimeout(hoverTimer); hoverTarget = null; view.dispatch({ effects: [closeHoverTooltips, inlineEffect.of([])] }); } },
    inspect: () => { const head = view.state.selection.main.head; if (inspectionKey) activateHover(view, head, wordAt(view.state, head)?.to === head ? -1 : 1, { tooltip: inspection, until: transaction => transaction.selection !== undefined }); },
    closeInspection: () => { clearTimeout(hoverTimer); hoverTarget = null; view.dispatch({ effects: closeHoverTooltips }); },
    setDebug: value => {
      const previous = view.state.field(debugField), effects = [debugEffect.of(value)];
      for (const key of ['currentLine', 'selectedLine']) {
        const line = value[key];
        if (!line || line === previous[key] || line > view.state.doc.lines) continue;
        const position = view.state.doc.line(line).from;
        foldedRanges(view.state).between(position, position, (from, to) => { if (from < position && position < to) effects.push(unfoldEffect.of({ from, to })); });
      }
      view.dispatch({ effects });
    },
    setSource: (source, position) => { clearTimeout(hoverTimer); hoverTarget = null; sourceVersion = source.version; view.setState(createState(source.text, source.path)); restoreFolds(position); reveal(position, true); },
    snapshot: () => {
      const ranges = [];
      foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => ranges.push({ from, to }));
      return { ...positionAt(view), viewport: { version: sourceVersion, effect: view.scrollSnapshot() }, folding: { version: sourceVersion, ranges } };
    },
    selectedText: () => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
    find: () => openSearchPanel(view),
    focus: () => view.focus(), position: () => positionAt(view), reveal,
    measure: () => view.requestMeasure(),
    anchor: () => { const box = view.coordsAtPos(view.state.selection.main.head); return { x: box?.left ?? parent.getBoundingClientRect().left, y: box?.bottom ?? parent.getBoundingClientRect().top }; },
    lineLength: number => number < 1 || number > view.state.doc.lines ? null : view.state.doc.line(number).length,
    destroy: () => { clearTimeout(hoverTimer); document.removeEventListener('pointerdown', dismiss, true); view.destroy(); },
  };
}
