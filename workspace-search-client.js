/** Scoped literal searches share the workbench's bottom tool window and navigate without editing files. */
/** Create the localized, cancellable Find panel.
 * @param React - Host-owned React runtime.
 * @param api - Authenticated JSON request helper.
 * @returns A component whose matches open read-only source locations.
 */
export function createWorkspaceSearchUI(React, api) {
  const { createElement: h, useState, useRef, useEffect, useLayoutEffect } = React;
  return function WorkspaceSearch({ cwd, scope, request, active, onOpen, t }) {
    const [query, setQuery] = useState(''), [caseSensitive, setCaseSensitive] = useState(false);
    const [result, setResult] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
    const input = useRef(null), pending = useRef(null), results = useRef(null);
    const cancel = () => { pending.current?.abort(); pending.current = null; setBusy(false); };
    useEffect(() => {
      cancel(); setResult(null); setError(null);
      return () => pending.current?.abort();
    }, [cwd, scope]);
    useLayoutEffect(() => { if (active) { input.current?.focus(); input.current?.select(); } }, [scope, request, active]);
    const search = async event => {
      event.preventDefault();
      if (!query.trim() || busy) return;
      cancel(); const controller = new AbortController(); pending.current = controller;
      setBusy(true); setError(null); setResult(null);
      try {
        const params = new URLSearchParams({ cwd, scope, query, caseSensitive: caseSensitive ? '1' : '0' });
        const data = await api('api/git.search?' + params, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!data || !Array.isArray(data.matches) || !data.matches.every(row => typeof row.path === 'string'
          && Number.isSafeInteger(row.line) && row.line > 0 && Number.isSafeInteger(row.character) && row.character >= 0 && typeof row.text === 'string')
          || typeof data.limited !== 'boolean' || !Number.isSafeInteger(data.skipped) || data.skipped < 0) throw new Error(t('search.invalid'));
        setResult(data);
      } catch (error) { if (!controller.signal.aborted) setError(t('search.failed', { message: error.message })); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    };
    const edit = change => { cancel(); setResult(null); setError(null); change(); };
    return h('div', { className: 'jb-search-panel' },
      h('form', { className: 'jb-search-form', onSubmit: search },
        h('input', { ref: input, type: 'search', value: query, maxLength: 512, placeholder: t('search.query'), 'aria-label': t('search.query'),
          onChange: event => edit(() => setQuery(event.target.value)),
          onKeyDown: event => { if (event.key === 'ArrowDown' && result?.matches.length) { event.preventDefault(); results.current.querySelector('button')?.focus(); } } }),
        h('label', null, h('input', { type: 'checkbox', checked: caseSensitive, onChange: event => edit(() => setCaseSensitive(event.target.checked)) }), t('search.case')),
        h('button', { type: 'submit', className: 'jb-btn', disabled: !query.trim() || busy }, t('search.run'))),
      h('div', { className: 'jb-search-summary' },
        h('span', { title: scope || cwd }, t('search.scope', { path: scope || t('search.project') })),
        busy ? h('span', { role: 'status' }, t('loading')) : result ? h('span', { role: 'status' }, t('search.count', { n: String(result.matches.length) })) : null),
      error ? h('div', { className: 'jb-search-notice', role: 'alert' }, error) : null,
      result?.limited ? h('div', { className: 'jb-search-notice', role: 'status' }, t('search.limited')) : null,
      result?.skipped > 0 ? h('div', { className: 'jb-search-notice' }, t('search.skipped', { n: String(result.skipped) })) : null,
      h('div', { ref: results, className: 'jb-search-results', 'aria-busy': busy },
        result?.matches.map(row => h('button', { key: row.path + ':' + row.line, type: 'button', className: 'jb-search-result',
          title: row.path + ':' + row.line + ':' + (row.character + 1), 'aria-label': t('search.open', { path: row.path, line: String(row.line) }),
          onClick: () => onOpen({ path: row.path, line: row.line - 1, character: row.character, documentMode: 'source', focusSource: true }) },
          h('span', { className: 'jb-search-location' }, row.path + ':' + row.line), h('code', null, row.text))),
        result?.matches.length === 0 ? h('div', { className: 'jb-tree-hint' }, t('search.empty')) : null));
  };
}
