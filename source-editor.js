/** Continuous, read-only source editor with JetBrains-style pointer and keyboard navigation. */
import { EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, gutter, GutterMarker, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { highlightSelectionMatches } from '@codemirror/search';
import { LanguageSupport, StreamLanguage, syntaxHighlighting, bracketMatching } from '@codemirror/language';
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
const executionLine = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(debugEffect)) {
      return Decoration.set([['currentLine', 'jb-debug-line'], ['selectedLine', 'jb-debug-frame-line']].flatMap(([key, className]) => {
        const line = effect.value[key];
        return line && line <= transaction.state.doc.lines ? [Decoration.line({ class: className }).range(transaction.state.doc.line(line).from)] : [];
      }), true);
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

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

/**
 * Mount a source reader; callers own its returned disposer.
 * @param parent - Empty editor container.
 * @param options - Source, initial position, localized name, and callbacks scoped to this reader.
 * @returns Focus, caret/viewport snapshots, reveal, host-source replacement and disposal actions; user edits remain disabled.
 */
export function createSourceEditor(parent, options) {
  let sourceVersion = options.version;
  const positionAt = (view, offset = view.state.selection.main.head) => {
    const line = view.state.doc.lineAt(offset);
    return { line: line.number - 1, character: offset - line.from };
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
    EditorView.contentAttributes.of({ tabindex: '0', 'aria-label': options.label, 'aria-readonly': 'true' }),
    debugField, executionLine,
    gutter({ class: 'jb-breakpoints', lineMarker: (view, line) => { const number = view.state.doc.lineAt(line.from).number, value = view.state.field(debugField); const point = value.breakpoints.find(item => item.line === number); return new BreakpointMarker(Boolean(point), point?.verified === true, value.currentLine === number, options.breakpointLabel); }, lineMarkerChange: update => update.transactions.some(transaction => transaction.effects.some(effect => effect.is(debugEffect))), domEventHandlers: { mousedown: (view, line, event) => { event.preventDefault(); options.onToggleBreakpoint(view.state.doc.lineAt(line.from).number); return true; } } }),
    lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), bracketMatching(),
    highlightSelectionMatches({ highlightWordAroundCursor: true, wholeWords: true }),
    syntaxHighlighting(sourceHighlighting), sourceLanguage(path),
    linkField,
    Prec.highest(keymap.of([
      { key: 'Mod-b', run: define, stopPropagation: true },
      { key: 'F9', run: view => { options.onToggleBreakpoint(positionAt(view).line + 1); return true; }, stopPropagation: true },
      ...[['F5', 'run'], ['Shift-F5', 'stop'], ['F8', 'next'], ['F7', 'stepIn'], ['Shift-F8', 'stepOut'], ['Alt-F5', 'pause']].map(([key, action]) => ({ key, run: () => { options.onDebug(action); return true; }, stopPropagation: true })),
      { key: 'F12', run: define, stopPropagation: true },
      { key: 'Shift-F10', run: contextMenu, stopPropagation: true },
      { key: 'Ctrl-g', mac: 'Meta-l', run: () => { options.onGoLine(); return true; }, stopPropagation: true },
      { key: 'Mod-[', run: view => { options.onBack(positionAt(view)); return true; }, stopPropagation: true },
      { key: 'Mod-]', run: view => { options.onForward(positionAt(view)); return true; }, stopPropagation: true },
      { key: 'Ctrl-Alt-ArrowLeft', mac: 'Meta-Alt-ArrowLeft', run: view => { options.onBack(positionAt(view)); return true; }, stopPropagation: true },
      { key: 'Ctrl-Alt-ArrowRight', mac: 'Meta-Alt-ArrowRight', run: view => { options.onForward(positionAt(view)); return true; }, stopPropagation: true },
    ])),
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
        if (position !== null) view.dispatch({ selection: { anchor: position } });
        options.onContextMenu({ x: event.clientX, y: event.clientY }, positionAt(view)); return true;
      },
      mousemove(event, view) {
        const position = event.metaKey || event.ctrlKey ? view.posAtCoords({ x: event.clientX, y: event.clientY }) : null;
        const range = position === null ? null : wordAt(view.state, position);
        const current = view.state.field(linkField);
        if (range || current.size) view.dispatch({ effects: linkEffect.of(range) });
      },
      keyup(event, view) { if (!event.metaKey && !event.ctrlKey && view.state.field(linkField).size) view.dispatch({ effects: linkEffect.of(null) }); },
      mouseleave(event, view) { if (view.state.field(linkField).size) view.dispatch({ effects: linkEffect.of(null) }); },
      blur(event, view) { if (view.state.field(linkField).size) view.dispatch({ effects: linkEffect.of(null) }); },
    }),
    EditorView.theme({
      '&': { height: '100%', backgroundColor: options.colors.bg, color: options.colors.code, fontSize: '12.5px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', lineHeight: '22px' },
      '.cm-content': { caretColor: options.colors.text, padding: '6px 0' },
      '.cm-gutters': { backgroundColor: options.colors.gutter, color: options.colors.textDim, borderRight: '1px solid ' + options.colors.border },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: options.colors.hover },
      // Match the focused base-theme selector so its light palette cannot override host colors.
      '.cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: options.colors.textSelection },
      '.cm-content::selection, .cm-content ::selection': { backgroundColor: options.colors.textSelection, color: options.colors.code },
      '.cm-selectionMatch': { backgroundColor: options.colors.textSelection, borderRadius: '2px' },
      '.cm-selectionMatch-main': { outline: '1px solid ' + options.colors.accent, outlineOffset: '-1px' },
      '.jb-breakpoint': { display: 'inline-block', width: '16px', height: '22px', cursor: 'pointer', color: options.colors.textDim, textAlign: 'center' },
      '.jb-breakpoint-enabled': { color: options.colors.deleted, opacity: '.5' },
      '.jb-breakpoint-verified': { opacity: '1' },
      '.jb-debug-current': { color: options.colors.accent, opacity: '1' },
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
  const reveal = (position, center = false) => {
    const anchor = offsetAt(view.state, position);
    const scroll = position.viewport && position.viewport.version === sourceVersion ? position.viewport.effect : EditorView.scrollIntoView(anchor, { y: center ? 'center' : 'nearest' });
    view.dispatch({ selection: { anchor }, effects: scroll });
  };
  reveal(options.position, true);
  if (options.takeFocus) view.focus();
  return {
    setDebug: value => view.dispatch({ effects: debugEffect.of(value) }),
    setSource: (source, position) => { sourceVersion = source.version; view.setState(createState(source.text, source.path)); reveal(position, true); },
    snapshot: () => ({ ...positionAt(view), viewport: { version: sourceVersion, effect: view.scrollSnapshot() } }),
    focus: () => view.focus(), position: () => positionAt(view), reveal,
    measure: () => view.requestMeasure(),
    anchor: () => { const box = view.coordsAtPos(view.state.selection.main.head); return { x: box?.left ?? parent.getBoundingClientRect().left, y: box?.bottom ?? parent.getBoundingClientRect().top }; },
    lineLength: number => number < 1 || number > view.state.doc.lines ? null : view.state.doc.line(number).length,
    destroy: () => view.destroy(),
  };
}
