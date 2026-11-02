/** React debug state and tree views, kept separate from file navigation and Git selection. */
/**
 * Create stable client components sharing the host's React instance and authenticated API helper.
 * @param React - Host React exports.
 * @param api - JSON request helper accepting plain object bodies and abort signals.
 * @returns Workspace debugger state, client-local dock preferences, execution actions and a stack/variable/output view.
 */
export function createDebugUI(React, api) {
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
  function useDebugger(cwd, t, onLocation) {
    const [session, setSession] = useState(null), [breakpoints, setBreakpoints] = useState({});
    const [error, setError] = useState(null), [choices, setChoices] = useState(null), [busy, setBusy] = useState(false), [attach, setAttach] = useState(null);
    const [selectedFrameId, setSelectedFrameId] = useState(null);
    const refs = useRef({}); Object.assign(refs.current, { cwd, session, breakpoints, t, onLocation, selectedFrameId });
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
        setError(t('debug.failed', { message: error.message }));
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
    useEffect(() => { setSession(null); setSelectedFrameId(null); setBreakpoints({}); setChoices(null); setAttach(null); setError(null); }, [cwd]);
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
    const toggle = line => {
      const path = refs.current.path;
      const old = refs.current.breakpoints[path] ?? [];
      const next = { ...refs.current.breakpoints, [path]: old.includes(line) ? old.filter(n => n !== line) : [...old, line].sort((a, b) => a - b) };
      setBreakpoints(next); refs.current.breakpoints = next;
      if (refs.current.session?.id && refs.current.session.state !== 'ended') action('breakpoints', { breakpoints: next });
    };
    return { session, selectedFrameId, selectFrame, breakpoints, error, choices, busy, attach, closeAttach: () => setAttach(null),
      submitAttach: input => { setAttach(null); return action('start', { attach: input, breakpoints: refs.current.breakpoints }); },
      setPath: path => { refs.current.path = path; }, toggle,
      choose: name => { setChoices(null); return action('start', { name, breakpoints }); }, closeChoices: () => setChoices(null),
      start, action, run: () => active(refs.current.session) ? action('continue') : start('launch') };
  }
  function controlItems(debug, t) {
    return [['continue', 'F5'], ['next', 'F8'], ['stepIn', 'F7'], ['stepOut', 'Shift F8'], ['pause', 'Alt F5'], ['stop', 'Shift F5']].map(([name, shortcut]) => ({
      id: 'debug-' + name, label: t('debug.' + name), shortcut, disabled: debug.busy || !enabled(debug.session, name), run: () => debug.action(name),
    }));
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
      api('/api/git.debug.action', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: { cwd: debug.cwd, id: debug.session.id, action: 'variables', reference } })
        .then(data => { if (alive) setItems(data.variables ?? []); })
        .catch(error => { if (alive) setError(t('debug.failed', { message: error.message })); });
      return () => { alive = false; controller.abort(); };
    }, [debug.cwd, debug.session.id, debug.session.pauseId, reference]);
    if (error) return h('div', { role: 'alert' }, error);
    if (items === null) return h('div', { className: 'jb-debug-placeholder', role: 'status' }, t('loading'));
    if (!items.length) return h('div', { className: 'jb-debug-placeholder' }, t('debug.noVariables'));
    return h('ul', { className: 'jb-variable-list' }, ...(items ?? []).map(item => h('li', { key: item.name + ':' + item.variablesReference }, item.variablesReference > 0
      ? h(VariableTree, { debug, reference: item.variablesReference, title: h(VariableValue, { item }), t })
      : h('div', { className: 'jb-variable-leaf' }, h(VariableValue, { item })))));
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
  return { useDebugger, useDebugDock, DebugPane, controlItems, isDebugVisible };
}
