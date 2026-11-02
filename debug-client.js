/** React debug state and tree views, kept separate from file navigation and Git selection. */
/**
 * Create stable client components sharing the host's React instance and authenticated API helper.
 * @param React - Host React exports.
 * @param api - JSON request helper accepting plain object bodies and abort signals.
 * @param options - Host portal rendering and popup dismissal lifecycle.
 * @returns Workspace debugger state, client-local dock preferences, execution actions and a stack/variable/output view.
 */
export function createDebugUI(React, api, { createPortal, usePopupDismiss }) {
  const h = React.createElement;
  const { useState, useEffect, useRef, useId } = React;
  const active = session => Boolean(session?.id && session.state !== 'ended');
  const isDebugVisible = debug => Boolean(debug.session || debug.error || /\.(?:py|go|[cm]?[jt]s|[jt]sx)$/i.test(debug.path ?? ''));
  const enabled = (session, name) => name === 'stop' ? active(session) : name === 'pause' ? session?.state === 'running' : session?.state === 'paused';
  function useDebugDock(t) {
    const [dock, setDock] = useState(() => {
      try { return window.localStorage.getItem('dsh.git-control.debugDock') === 'bottom' ? 'bottom' : 'right'; }
      catch (error) { return 'right'; } // Browser storage can be unavailable; the panel remains usable.
    });
    const [error, setError] = useState(null);
    const change = value => {
      if (!['right', 'bottom'].includes(value)) return;
      setDock(value);
      try { window.localStorage.setItem('dsh.git-control.debugDock', value); setError(null); }
      catch (error) { setError(t('debug.dockUnsaved')); }
    };
    return { dock, change, error };
  }
  function useDebugger(cwd, t, onLocation, readExpression) {
    const [session, setSession] = useState(null), [breakpoints, setBreakpoints] = useState({});
    const [error, setError] = useState(null), [choices, setChoices] = useState(null), [busy, setBusy] = useState(false), [attach, setAttach] = useState(null);
    const [selectedFrameId, setSelectedFrameId] = useState(null);
    const [evaluation, setEvaluation] = useState(null), [variablesVersion, setVariablesVersion] = useState(0);
    const refs = useRef({}); Object.assign(refs.current, { cwd, session, breakpoints, t, onLocation, selectedFrameId, readExpression });
    const selectFrame = (id, focusSource = false) => {
      const current = refs.current.session;
      const frame = current?.state === 'paused' && current.frames.find(frame => frame.id === id);
      if (!frame) return;
      setSelectedFrameId(id); refs.current.selectedFrameId = id;
      if (frame.path) refs.current.onLocation({ path: frame.path, line: frame.line - 1, character: Math.max(0, frame.column - 1), focusSource });
    };
    const update = data => {
      const previous = refs.current.session;
      if (previous?.id === data.id && previous.revision > data.revision) return;
      const newPause = previous?.id !== data.id || previous?.state !== 'paused' || previous?.pauseId !== data.pauseId;
      refs.current.session = data; setSession(data);
      if (data.state !== 'paused') { setSelectedFrameId(null); refs.current.selectedFrameId = null; }
      else if (newPause || !data.frames?.some(frame => frame.id === refs.current.selectedFrameId)) {
        setSelectedFrameId(null); refs.current.selectedFrameId = null;
        if (data.frames?.[0]) selectFrame(data.frames[0].id);
      }
    };
    const action = async (name, extra = {}) => {
      const current = refs.current.session;
      if (refs.current.pendingAction === cwd || (name !== 'start' && (!active(current) || (['continue', 'next', 'stepIn', 'stepOut', 'pause', 'stop'].includes(name) && !enabled(current, name))))) return;
      refs.current.pendingAction = cwd;
      setError(null); setBusy(true);
      try {
        const data = await api('/api/git.debug.action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: { cwd, id: current?.id, action: name, ...extra } });
        if (refs.current.cwd === cwd) update(data);
        return data;
      } catch (error) {
        if (refs.current.cwd !== cwd) return;
        if (error.code === 'DEBUG_SESSION_ENDED' && current?.id) {
          try {
            const data = await api(`/api/git.debug.status?${new URLSearchParams({ cwd, id: current.id })}`);
            if (refs.current.cwd !== cwd) return;
            if (data.state === 'ended') { update(data); return data; }
          } catch (statusError) { if (refs.current.cwd === cwd) setError(t('debug.failed', { message: statusError.message })); return; }
        }
        setError(t(error.code === 'DEBUG_BREAKPOINTS_FAILED' ? 'debug.breakpointsFailed' : 'debug.failed', { message: error.message }));
      }
      finally { if (refs.current.pendingAction === cwd) delete refs.current.pendingAction; if (refs.current.cwd === cwd) setBusy(false); }
    };
    useEffect(() => {
      let cancelled = false, timer, controller;
      const poll = async () => {
        controller = new AbortController();
        try {
          const data = await api(`/api/git.debug.status?${new URLSearchParams({ cwd, ...(session?.id ? { id: session.id } : {}) })}`, { signal: controller.signal });
          if (!cancelled && data.id && data.revision !== refs.current.session?.revision) update(data);
        } catch (error) { if (!cancelled) setError(t('debug.failed', { message: error.message })); }
        if (!cancelled) timer = setTimeout(poll, 600);
      };
      if (session?.id && session.state !== 'ended') poll();
      else if (!session) {
        controller = new AbortController();
        api(`/api/git.debug.status?${new URLSearchParams({ cwd })}`, { signal: controller.signal })
          .then(data => { if (!cancelled && data.id) update(data); })
          .catch(error => { if (!cancelled) setError(t('debug.failed', { message: error.message })); });
      }
      return () => { cancelled = true; clearTimeout(timer); controller?.abort(); };
    }, [cwd, session?.id, session?.state]);
    useEffect(() => { setSession(null); setSelectedFrameId(null); setBreakpoints({}); setEvaluation(null); setChoices(null); setAttach(null); setError(null); }, [cwd]);
    useEffect(() => { if (session?.state !== 'paused') setEvaluation(null); }, [session?.state]);
    const start = async request => {
      if (refs.current.pendingStart === cwd || active(refs.current.session)) return;
      refs.current.pendingStart = cwd;
      setError(null); setBusy(true);
      try {
        const path = refs.current.path;
        const data = await api(`/api/git.debug.configurations?${new URLSearchParams({ cwd, ...(path ? { path } : {}) })}`);
        if (refs.current.cwd !== cwd) return;
        const configs = data.configurations.filter(row => !request || row.request === request);
        if (!configs.length && request === 'attach') {
          const extension = path?.split('.').at(-1)?.toLowerCase();
          setAttach({ language: extension === 'py' ? 'python' : extension === 'go' ? 'go' : 'javascript' }); return;
        }
        if (!configs.length) throw new Error(t(data.launchError === 'DEBUG_TS_BUILD' ? 'debug.tsBuild' : 'debug.openFile'));
        if (configs.length === 1) await action('start', { name: configs[0].name, ...(configs[0].currentFile ? { currentFile: configs[0].currentFile } : {}), breakpoints: refs.current.breakpoints });
        else setChoices(configs);
      } catch (error) { if (refs.current.cwd === cwd) setError(t('debug.failed', { message: error.message })); }
      finally { if (refs.current.pendingStart === cwd) delete refs.current.pendingStart; if (refs.current.cwd === cwd) setBusy(false); }
    };
    const changeBreakpoints = async next => {
      if (refs.current.pendingAction === cwd) return;
      if (active(refs.current.session)) {
        const result = await action('breakpoints', { breakpoints: next });
        if (!result || refs.current.cwd !== cwd) return;
      }
      setBreakpoints(next); refs.current.breakpoints = next;
    };
    const toggle = line => {
      const path = refs.current.path;
      const old = refs.current.breakpoints[path] ?? [];
      return changeBreakpoints({ ...refs.current.breakpoints, [path]: old.includes(line) ? old.filter(n => n !== line) : [...old, line].sort((a, b) => a - b) });
    };
    return { session, selectedFrameId, selectFrame, breakpoints, error, choices, busy, attach, evaluation, variablesVersion, refreshVariables: () => setVariablesVersion(value => value + 1),
      openEvaluation: (expression = refs.current.readExpression?.() ?? '') => { if (refs.current.pendingAction !== cwd && refs.current.session?.state === 'paused' && refs.current.selectedFrameId != null) setEvaluation({ expression }); }, closeEvaluation: () => setEvaluation(null),
      clearBreakpoints: () => changeBreakpoints({}), closeAttach: () => setAttach(null),
      submitAttach: input => { setAttach(null); return action('start', { attach: input, breakpoints: refs.current.breakpoints }); },
      setPath: path => { refs.current.path = path; }, toggle,
      choose: name => { setChoices(null); return action('start', { name, breakpoints }); }, closeChoices: () => setChoices(null),
      start, action, run: () => active(refs.current.session) ? action('continue') : start('launch') };
  }
  function controlItems(debug, t) {
    return [...[['continue', 'F5'], ['next', 'F8'], ['stepIn', 'F7'], ['stepOut', 'Shift F8'], ['pause', 'Alt F5'], ['stop', 'Shift F5']].map(([name, shortcut]) => ({
      id: 'debug-' + name, label: t('debug.' + name), shortcut, disabled: debug.busy || !enabled(debug.session, name), run: () => debug.action(name),
    })),
      { id: 'debug-evaluate', label: t('debug.evaluate'), shortcut: 'Alt F8', disabled: debug.busy || debug.session?.state !== 'paused' || debug.selectedFrameId == null, run: () => debug.openEvaluation() },
      { id: 'debug-clearBreakpoints', label: t('debug.clearBreakpoints'), disabled: debug.busy || !(Object.values(debug.breakpoints).some(lines => lines.length) || (active(debug.session) && debug.session.breakpoints?.length)), run: debug.clearBreakpoints },
    ];
  }
  // General controls use Lucide (ISC); stepping arrows follow the supplied IDE reference.
  const icons = {
    run: [['path', { d: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z' }]],
    resume: [['path', { d: 'M4 4v16', strokeWidth: 3 }], ['path', { d: 'm9 4 12 8-12 8Z', fill: 'currentColor', stroke: 'none' }]],
    pause: [['rect', { x: 14, y: 3, width: 5, height: 18, rx: 1 }], ['rect', { x: 5, y: 3, width: 5, height: 18, rx: 1 }]],
    stop: [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, fill: 'currentColor', stroke: 'none' }]],
    next: [['path', { d: 'm4 13 7-7 8 8M12 14h7V7' }], ['path', { d: 'M4 20h16' }]],
    stepIn: [['path', { d: 'M12 17V3' }], ['path', { d: 'm6 11 6 6 6-6' }], ['path', { d: 'M19 21H5' }]],
    stepOut: [['path', { d: 'm18 9-6-6-6 6' }], ['path', { d: 'M12 3v14' }], ['path', { d: 'M5 21h14' }]],
    evaluate: [['rect', { x: 4, y: 3, width: 16, height: 18, rx: 2 }], ['path', { d: 'M8 7h8M8 12h2m4 0h2M8 16h2m4 0h2' }]],
    clearBreakpoints: [['path', { d: 'M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6M10 10v7M14 10v7' }]],
    attach: [['path', { d: 'M12 22v-5' }], ['path', { d: 'M15 8V2' }], ['path', { d: 'M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z' }], ['path', { d: 'M9 8V2' }]],
  };
  function DebugToolbar({ debug, t }) {
    const ref = useRef(null);
    const controls = controlItems(debug, t);
    const groups = [
      { name: 'execution', items: [
        { id: 'debug-run', label: t(active(debug.session) ? 'debug.continue' : 'debug.launch'), shortcut: 'F5', disabled: debug.busy || (active(debug.session) ? debug.session.state !== 'paused' : debug.sourcePending), run: debug.run },
        ...['debug-stop', 'debug-pause'].map(id => controls.find(item => item.id === id)),
      ] },
      { name: 'stepping', items: ['debug-next', 'debug-stepIn', 'debug-stepOut'].map(id => controls.find(item => item.id === id)) },
      { name: 'inspection', items: ['debug-evaluate', 'debug-clearBreakpoints'].map(id => controls.find(item => item.id === id)) },
      { name: 'connection', items: [{ id: 'debug-attach', label: t('debug.attach'), disabled: debug.busy || debug.sourcePending || active(debug.session), run: () => debug.start('attach') }] },
    ];
    return h('div', { ref, className: 'jb-debug-toolbar', role: 'toolbar', 'aria-label': t('debug.title'), 'aria-busy': debug.busy,
      onKeyDown: event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      } }, ...groups.map(group => h('div', { key: group.name, role: 'group', 'aria-label': t('debug.' + group.name), className: 'jb-debug-action-group', 'data-group': group.name }, ...group.items.map(item => {
        const name = item.id.slice(6);
        const icon = name === 'run' && active(debug.session) ? 'resume' : name;
        return h('button', { key: item.id, type: 'button', className: 'jb-debug-action', 'data-action': name, disabled: item.disabled, 'aria-label': item.label,
          title: item.label + (item.shortcut ? ' · ' + item.shortcut : '') + (group.name === 'stepping' ? '\n' + t('debug.' + name + 'Hint') : ''), onClick: item.run },
          h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
            ...icons[icon].map(([tag, attrs], index) => h(tag, { ...attrs, key: index }))),
          name === 'run' ? h('span', null, item.label) : null);
      }))));
  }
  function VariableTree({ debug, reference, title, t, defaultOpen = false }) {
    const [open, setOpen] = useState(defaultOpen);
    return h('details', { className: 'jb-variable-branch', open, onToggle: event => setOpen(event.currentTarget.open) }, h('summary', null, title), open ? h(Variables, { debug, reference, t }) : null);
  }
  function VariableValue({ item }) {
    const kind = /^(str|string)$/i.test(item.type ?? '') ? 'string' : /^(int|float|double|number|long|short|byte|complex)/i.test(item.type ?? '') ? 'number'
      : /^(None|True|False|null|undefined|true|false)$/.test(item.value) ? 'constant' : 'plain';
    return h('span', { className: 'jb-variable-row' },
      h('span', { className: 'jb-variable-label' }, h('span', { className: 'jb-variable-name' }, item.name),
        item.type ? h('span', { className: 'jb-variable-type' }, item.type) : null),
      h('span', { className: 'jb-variable-separator', 'aria-hidden': true }, ': '),
      h('span', { className: 'jb-variable-value', 'data-kind': kind }, item.value));
  }
  function Variables({ debug, reference, t }) {
    const [items, setItems] = useState(null), [error, setError] = useState(null);
    useEffect(() => {
      let alive = true; const controller = new AbortController();
      setItems(null); setError(null);
      api('/api/git.debug.action', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: { cwd: debug.cwd, id: debug.session.id, action: 'variables', reference, pauseId: debug.session.pauseId } })
        .then(data => { if (alive) setItems(data.variables ?? []); })
        .catch(error => { if (alive) setError(t('debug.failed', { message: error.message })); });
      return () => { alive = false; controller.abort(); };
    }, [debug.cwd, debug.session.id, debug.session.pauseId, reference, debug.variablesVersion]);
    if (error) return h('div', { role: 'alert' }, error);
    if (items === null) return h('div', { className: 'jb-debug-placeholder', role: 'status' }, t('loading'));
    if (!items.length) return h('div', { className: 'jb-debug-placeholder' }, t('debug.noVariables'));
    return h('ul', { className: 'jb-variable-list' }, ...(items ?? []).map(item => h('li', { key: item.name + ':' + item.variablesReference }, item.variablesReference > 0
      ? h(VariableTree, { debug, reference: item.variablesReference, title: h(VariableValue, { item }), t })
      : h('div', { className: 'jb-variable-leaf' }, h(VariableValue, { item })))));
  }
  function EvaluationDialog({ debug, t, onClose }) {
    const ref = useRef(null), input = useRef(null), pending = useRef(false), sequence = useRef(0);
    const [expression, setExpression] = useState(debug.evaluation.expression), [result, setResult] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
    const alive = useRef(true);
    usePopupDismiss(ref, onClose);
    useEffect(() => { alive.current = true; input.current?.focus(); input.current?.select(); return () => { alive.current = false; }; }, []);
    const session = debug.session, frame = session.frames.find(frame => frame.id === debug.selectedFrameId);
    const submit = async () => {
      if (pending.current || !expression.trim()) return;
      pending.current = true; setBusy(true); setResult(null); setError(null);
      try {
        const data = await api('/api/git.debug.action', { method: 'POST', body: { cwd: debug.cwd, id: session.id, action: 'evaluate', expression, frameId: frame.id, pauseId: session.pauseId } });
        if (alive.current) setResult({ ...data, expression, sequence: ++sequence.current });
      } catch (error) { if (alive.current) setError(t(error.code === 'DEBUG_EXPRESSION_INVALID' ? 'debug.invalidExpression' : 'debug.evaluateFailed', { message: error.message })); }
      finally { pending.current = false; if (alive.current) { setBusy(false); debug.refreshVariables(); } }
    };
    return createPortal(h('section', { ref, role: 'dialog', 'aria-label': t('debug.evaluate'), className: 'jb-editor-popup jb-evaluate' },
      h('div', { className: 'jb-evaluate-heading' }, h('span', null, t('debug.evaluate')), h('button', { type: 'button', onClick: onClose, 'aria-label': t('debug.closeEvaluation') }, '×')),
      h('div', { className: 'jb-evaluate-frame', title: frame.path }, frame.name + ' · ' + (frame.path ?? t('debug.external')) + ':' + frame.line),
      h('label', null, t('debug.expression'), h('textarea', { ref: input, value: expression, rows: 3, maxLength: 8192, spellCheck: false, 'aria-label': t('debug.expression'), disabled: busy,
        onChange: event => setExpression(event.target.value), onKeyDownCapture: event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); submit(); } } })),
      h('div', { className: 'jb-evaluate-submit' }, h('small', null, t('debug.evaluateHint')), h('button', { type: 'button', disabled: busy || !expression.trim(), onClick: submit }, t(busy ? 'loading' : 'debug.evaluate'))),
      h('small', null, t('debug.evaluateEffects')),
      error ? h('div', { role: 'alert' }, error) : null,
      result ? h('div', { className: 'jb-evaluate-result', role: 'status', 'aria-label': t('debug.result') },
        h('div', null, t('debug.result')), result.variablesReference > 0
          ? h(VariableTree, { key: result.sequence, debug, reference: result.variablesReference, title: h(VariableValue, { item: { name: result.expression, value: result.result, type: result.type } }), t })
          : h(VariableValue, { item: { name: result.expression, value: result.result, type: result.type } })) : null), document.body);
  }
  function FrameList({ debug, t, onMenu }) {
    const id = useId(), ref = useRef(null), session = debug.session;
    const frames = session.frames ?? [];
    const selected = frames.find(frame => frame.id === debug.selectedFrameId);
    useEffect(() => { ref.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }, [debug.selectedFrameId, session.pauseId]);
    const menu = (event, frame) => {
      event.preventDefault(); event.stopPropagation();
      ref.current.focus({ preventScroll: true }); debug.selectFrame(frame.id);
      const rect = event.currentTarget.getBoundingClientRect();
      onMenu({ x: event.type === 'keydown' ? rect.left : event.clientX, y: event.type === 'keydown' ? rect.bottom : event.clientY }, frame);
    };
    return h(React.Fragment, null,
      h('div', { ref, role: 'listbox', tabIndex: 0, 'aria-label': t('debug.stack'), className: 'jb-stack-list',
        'aria-activedescendant': selected ? `${id}-${selected.id}` : undefined,
        onKeyDown: event => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            const index = frames.findIndex(frame => frame.id === debug.selectedFrameId);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? frames.length - 1 : Math.max(0, Math.min(frames.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
            if (frames[next]) debug.selectFrame(frames[next].id);
          } else if (selected && ['Enter', 'F4'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation(); debug.selectFrame(selected.id, true);
          } else if (selected && event.key === 'F10' && event.shiftKey) menu(event, selected);
        } }, ...frames.map((frame, index) => h('div', { key: frame.id, id: `${id}-${frame.id}`, role: 'option', 'aria-selected': frame.id === debug.selectedFrameId,
          'aria-label': frame.name + ' · ' + (frame.path ? frame.path + ':' + frame.line : t('debug.external')) + (index === 0 ? ' · ' + t('debug.executionFrame') : ''),
          className: 'jb-stack-frame', 'data-executing': index === 0, title: frame.name + ' · ' + (frame.path ? frame.path + ':' + frame.line : t('debug.external')),
          onClick: () => { ref.current.focus({ preventScroll: true }); debug.selectFrame(frame.id); },
          onDoubleClick: () => debug.selectFrame(frame.id, true), onContextMenu: event => menu(event, frame) },
          h('span', { className: 'jb-stack-marker', 'aria-hidden': true }, index === 0 ? '▶' : ''),
          h('span', { className: 'jb-stack-name' }, frame.name),
          h('span', { className: 'jb-stack-file' }, frame.path ? frame.path.split(/[\\/]/).at(-1) + ':' + frame.line : t('debug.external'))))),
      selected ? h('div', { className: 'jb-stack-location' },
        h('span', { className: 'jb-stack-location-file' }, selected.path ? selected.path.split(/[\\/]/).at(-1) + ':' + selected.line : t('debug.external')),
        selected.path ? h('details', { className: 'jb-stack-path' }, h('summary', null, t('debug.fullPath')), h('div', null, selected.path)) : null) : null);
  }
  function DebugPane({ debug, t, onMenu, layout }) {
    const session = debug.session;
    const [frameScopes, setFrameScopes] = useState(null);
    const frameId = debug.selectedFrameId;
    useEffect(() => {
      setFrameScopes(null);
      if (session?.state !== 'paused' || frameId == null || frameId === session.frames?.[0]?.id) return;
      const controller = new AbortController();
      api('/api/git.debug.action', { method: 'POST', signal: controller.signal, body: { cwd: debug.cwd, id: session.id, action: 'scopes', frameId } })
        .then(data => { if (!controller.signal.aborted) setFrameScopes({ sessionId: session.id, frameId, pauseId: session.pauseId, scopes: data.scopes }); })
        .catch(error => { if (!controller.signal.aborted) setFrameScopes({ sessionId: session.id, frameId, pauseId: session.pauseId, error: t('debug.failed', { message: error.message }) }); });
      return () => controller.abort();
    }, [debug.cwd, session?.id, session?.state, session?.pauseId, frameId]);
    if (!isDebugVisible(debug)) return null;
    const selectedScopes = frameId === session?.frames?.[0]?.id ? { scopes: session.scopes }
      : frameScopes?.sessionId === session?.id && frameScopes?.frameId === frameId && frameScopes.pauseId === session?.pauseId ? frameScopes : null;
    return h('section', { className: 'jb-debug-pane', 'aria-label': t('debug.title'), onKeyDown: event => {
      if (event.metaKey || event.ctrlKey || event.isComposing) return;
      if (event.key === 'F8' && event.altKey && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); debug.openEvaluation(); return; }
      const action = event.key === 'F5' ? event.shiftKey ? 'stop' : event.altKey ? 'pause' : 'continue'
        : event.key === 'F8' && !event.altKey ? event.shiftKey ? 'stepOut' : 'next' : event.key === 'F7' && !event.shiftKey && !event.altKey ? 'stepIn' : null;
      if (!action) return;
      event.preventDefault(); event.stopPropagation();
      if (action === 'continue' && !debug.busy && !active(session)) { debug.run(); return; }
      if (!debug.busy && session?.id && (action === 'stop' ? session.state !== 'ended' : action === 'pause' ? session.state === 'running' : session.state === 'paused')) debug.action(action);
    } },
      h(DebugToolbar, { debug, t }),
      debug.error || session?.error ? h('div', { role: 'alert' }, debug.error ?? session.error) : null,
      h('div', { className: 'jb-debug-topbar' },
        h('div', { className: 'jb-debug-heading' }, h('span', { className: 'jb-debug-name', title: session?.name ?? debug.path }, session?.name?.split(/[\\/]/).at(-1) ?? t('debug.title')), h('span', { className: 'jb-debug-state', 'data-state': session?.state ?? 'ready' }, t('debug.' + (session?.state ?? 'ready')))),
        h('label', { className: 'jb-debug-dock' }, h('span', null, t('debug.dock')), h('select', { value: layout.dock, onChange: event => layout.change(event.target.value) },
          h('option', { value: 'right' }, t('debug.dockRight')), h('option', { value: 'bottom' }, t('debug.dockBottom'))))),
      layout.error ? h('div', { role: 'alert' }, layout.error) : null,
      !session || session.state === 'ended' ? h('div', { className: 'jb-debug-hint' }, t(session ? 'debug.endedHint' : 'debug.readyHint')) : null,
      h('div', { className: 'jb-debug-sections' }, session?.state === 'paused' ? h(React.Fragment, null,
        h('details', { open: true, className: 'jb-debug-section jb-debug-stack' }, h('summary', null, t('debug.stack'), h('span', { className: 'jb-debug-count' }, session.frames?.length ?? 0)),
          h(FrameList, { debug, t, onMenu })),
        h('details', { open: true, className: 'jb-debug-section jb-debug-scopes' }, h('summary', null, t('debug.variables')),
          selectedScopes?.error ? h('div', { role: 'alert' }, selectedScopes.error) : null,
          h('div', { key: `${session.id}:${session.pauseId}:${frameId}`, className: 'jb-debug-variables', 'aria-busy': !selectedScopes },
            !selectedScopes ? h('div', { className: 'jb-debug-placeholder', role: 'status' }, t('loading')) : null,
            selectedScopes && !selectedScopes.error && !selectedScopes.scopes?.length ? h('div', { className: 'jb-debug-placeholder' }, t('debug.noVariables')) : null,
            ...(selectedScopes?.scopes ?? []).map((scope, index) => h(VariableTree, { key: scope.variablesReference, debug, reference: scope.variablesReference, title: scope.name, defaultOpen: index === 0, t }))))) : null,
      session?.output ? h('details', { open: true, className: 'jb-debug-section jb-debug-output' }, h('summary', null, t('debug.output')), h('pre', null, session.output)) : null));
  }
  return { useDebugger, useDebugDock, DebugPane, EvaluationDialog, controlItems, isDebugVisible };
}
