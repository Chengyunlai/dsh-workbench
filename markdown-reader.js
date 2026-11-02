/** Sanitized Markdown reading with workspace-owned local navigation and shared source colors. */
import { Marked } from 'marked';
import createDOMPurify from 'dompurify';
import GithubSlugger from 'github-slugger';
import { escapeSource, highlightDocumentCode } from './source-editor.js';

/** Build a document component using the host React instance.
 * @param React - Host React exports.
 * @returns A focusable, read-only Markdown preview; raw HTML and automatic image requests are omitted.
 */
export function createMarkdownReader(React) {
  const h = React.createElement;
  const { useMemo, useLayoutEffect, useState } = React;
  const purifier = createDOMPurify(window);
  return function MarkdownReader({ source, target, scrollRef, t, blocked, onOpen, onNavigate }) {
    const [error, setError] = useState(null);
    const html = useMemo(() => {
      const slugger = new GithubSlugger();
      const marked = new Marked({ gfm: true, renderer: {
        html: () => '',
        heading({ tokens, depth }) {
          const text = this.parser.parseInline(tokens);
          const label = this.parser.parseInline(tokens, this.parser.textRenderer);
          return `<h${depth} id="jb-doc-${escapeSource(slugger.slug(label))}">${text}</h${depth}>`;
        },
        code({ text, lang }) {
          return '<div class="jb-document-codeblock">' + (lang ? '<div class="jb-document-language">' + escapeSource(lang) + '</div>' : '') + '<pre><code>' + highlightDocumentCode(text, lang) + '</code></pre></div>';
        },
        image({ text }) { return '<span class="jb-document-image">' + escapeSource(t('document.image', { alt: text })) + '</span>'; },
        checkbox({ checked }) { return '<span class="jb-document-checkbox">' + (checked ? '☑' : '☐') + '</span> '; },
        link({ href, title, tokens }) {
          if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^https?:/i.test(href) || href.startsWith('//')) return this.parser.parseInline(tokens);
          return '<a href="' + escapeSource(href) + '"' + (title ? ' title="' + escapeSource(title) + '"' : '') + (/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + this.parser.parseInline(tokens) + '</a>';
        },
      } });
      return purifier.sanitize(marked.parse(source.text, { async: false }), {
        FORBID_TAGS: ['img', 'style', 'input', 'form', 'iframe', 'object', 'embed', 'svg', 'math'],
        ALLOWED_ATTR: ['href', 'title', 'id', 'class', 'align', 'target', 'rel'], ALLOW_DATA_ATTR: false,
      });
    }, [source.text, t]);
    useLayoutEffect(() => {
      setError(null);
      const parent = scrollRef.current;
      parent.scrollTop = target.documentScroll ?? 0;
      if (target.focusSource && !blocked) parent.focus({ preventScroll: true });
    }, [source.path]);
    const anchor = hash => {
      let fragment;
      try { fragment = decodeURIComponent(hash.replace(/^#/, '')); }
      catch (error) { setError(t('document.linkFailed')); return; }
      const id = 'jb-doc-' + fragment;
      const heading = [...scrollRef.current.querySelectorAll('[id]')].find(node => node.id === id);
      heading?.scrollIntoView({ block: 'start' });
    };
    useLayoutEffect(() => { if (!blocked && target.documentAnchor) anchor(target.documentAnchor); }, [source.path, target.documentAnchor, blocked]);
    const activate = event => {
      const link = event.target.closest('a[href]');
      if (!link || blocked || event.button === 2) return;
      const href = link.getAttribute('href');
      if (/^https?:/i.test(href)) return;
      event.preventDefault();
      try {
        setError(null);
        if (href.startsWith('#') && !/^#L\d+(?:-L?\d+)?$/.test(href)) { anchor(href); return; }
        const base = new URL(source.path.split('/').map(encodeURIComponent).join('/'), 'https://workspace.invalid/__workspace__/');
        const url = new URL(href.startsWith('/') ? '/__workspace__/' + href.slice(1) : href, base);
        if (url.origin !== base.origin || !url.pathname.startsWith('/__workspace__/')) throw new Error('outside workspace');
        const path = decodeURIComponent(url.pathname.slice('/__workspace__/'.length));
        if (path.startsWith('/') || path.includes('\0') || path.split(/[\\/]/).includes('..')) throw new Error('outside workspace');
        const line = /^#L(\d+)(?:-L?\d+)?$/.exec(url.hash), number = line ? Number(line[1]) : 1;
        if (!Number.isSafeInteger(number) || number < 1) throw new Error('invalid line');
        onOpen({ path, line: number - 1, character: 0,
          ...(line ? { documentMode: 'source' } : { documentAnchor: url.hash || undefined }), focusSource: true });
      } catch (error) { setError(t('document.linkFailed')); }
    };
    return h('div', { className: 'jb-document-wrap' },
      error ? h('div', { className: 'jb-document-error', role: 'alert' }, error) : null,
      h('article', { ref: scrollRef, tabIndex: 0, className: 'jb-document', 'aria-label': t('document.preview'), inert: blocked || undefined,
        onKeyDown: event => {
          if ((event.metaKey || event.ctrlKey) && ['[', ']'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onNavigate(event.key === '[' ? -1 : 1); }
        },
        onClick: activate, onAuxClick: activate, dangerouslySetInnerHTML: { __html: html } }));
  };
}
