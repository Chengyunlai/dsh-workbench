/** Bottom terminal UI backed by the host's terminal controller; the emulator loads on explicit open. */
export function createTerminalDock(React, loadRuntime) {
  const { createElement: h, useState, useRef, useEffect, useLayoutEffect } = React;
  function Screen({ entry, runtime, shown, t }) {
    const parent = useRef(null), screen = useRef(null);
    const [state, setState] = useState(() => entry.model.state.getSnapshot());
    useLayoutEffect(() => {
      screen.current = runtime.mountTerminal(parent.current, entry.model, t('terminal.title'));
      const sync = () => { const next = entry.model.state.getSnapshot(); screen.current.update(next); setState(next); };
      const unsubscribe = entry.model.state.subscribe(sync), detach = entry.model.mount();
      sync();
      return () => { unsubscribe(); detach(); screen.current.dispose(); screen.current = null; };
    }, [entry]);
    useEffect(() => { screen.current?.visible(shown); }, [shown]);
    const ended = state.info?.state === 'exited' || state.phase === 'closed';
    const failed = state.phase === 'failed' || state.phase === 'disconnected';
    return h(React.Fragment, null,
      h('div', { className: 'jb-terminal-screen', ref: parent, hidden: !shown }),
      shown && (ended || failed || state.error || state.issue) ? h('div', { className: 'jb-terminal-notice', role: failed || state.error || state.issue ? 'alert' : 'status' },
        t(ended ? 'terminal.exited' : 'terminal.failed'),
        !ended ? h('button', { type: 'button', onClick: () => { if (state.info) entry.model.connect(); else void entry.model.refresh(); } }, t('terminal.retry')) : null) : null,
      shown && !ended && !failed && !state.issue && ['idle', 'loading', 'creating', 'connecting'].includes(state.phase) ? h('div', { className: 'jb-terminal-notice', role: 'status' }, t('terminal.connecting')) : null,
      shown && state.phase === 'connected' && !state.writable ? h('button', { className: 'jb-terminal-notice', type: 'button', onClick: () => entry.model.connect() }, t('terminal.control')) : null);
  }
  return function TerminalDock({ sessionId, cwd, available, create, release, t }) {
    const [shown, setShown] = useState(false), [entry, setEntry] = useState(null), [runtime, setRuntime] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(false), [height, setHeight] = useState(240);
    const current = useRef(null), lifetime = useRef(0), drag = useRef(null);
    useEffect(() => () => { lifetime.current++; if (current.current) release(current.current); }, []);
    const open = async () => {
      setShown(true);
      if (entry || loading) return;
      setLoading(true); setError(false);
      const generation = lifetime.current;
      try {
        const loaded = await loadRuntime();
        if (generation !== lifetime.current) return;
        const next = create(sessionId);
        current.current = next; setRuntime(loaded); setEntry(next);
      } catch (error) { if (generation === lifetime.current) setError(true); }
      finally { if (generation === lifetime.current) setLoading(false); }
    };
    const close = () => { lifetime.current++; if (current.current) release(current.current); current.current = null; setEntry(null); setShown(false); setLoading(false); setError(false); };
    return h('section', { className: 'jb-terminal', 'data-open': shown, style: shown ? { height } : undefined, 'aria-label': t('terminal.title') },
      shown ? h('div', { className: 'jb-terminal-divider', role: 'separator', tabIndex: 0, 'aria-label': t('terminal.resize'), 'aria-orientation': 'horizontal', 'aria-valuemin': 120, 'aria-valuemax': 600, 'aria-valuenow': height,
        onPointerDown: e => { if (e.button !== 0) return; drag.current = { y: e.clientY, height }; e.currentTarget.setPointerCapture(e.pointerId); },
        onPointerMove: e => { if (drag.current) setHeight(Math.max(120, Math.min(600, drag.current.height + drag.current.y - e.clientY))); },
        onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { if (drag.current) setHeight(drag.current.height); drag.current = null; }, onLostPointerCapture: () => { drag.current = null; },
        onKeyDown: e => { if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) { e.preventDefault(); setHeight(value => e.key === 'Home' ? 120 : e.key === 'End' ? 600 : Math.max(120, Math.min(600, value + (e.key === 'ArrowUp' ? 20 : -20)))); } }, onDoubleClick: () => setHeight(240) }) : null,
      h('div', { className: 'jb-terminal-bar' },
        h('button', { type: 'button', className: 'jb-terminal-toggle', disabled: !entry && (!available || loading), 'aria-expanded': shown, title: available ? t('terminal.title') : t('terminal.unavailable'), onClick: () => shown ? setShown(false) : void open() }, h('span', { 'aria-hidden': true }, '›_'), t('terminal.title')),
        h('span', { className: 'jb-terminal-path', title: cwd }, cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? ''),
        shown && entry ? h('button', { type: 'button', onClick: () => entry.model.write('\x03') }, t('terminal.interrupt')) : null,
        shown ? h('button', { type: 'button', disabled: !entry, onClick: () => { close(); } }, t('terminal.close')) : null),
      error && shown ? h('div', { className: 'jb-terminal-notice', role: 'alert' }, t('terminal.failed'), h('button', { type: 'button', onClick: () => void open() }, t('terminal.retry'))) : null,
      entry && runtime ? h(Screen, { entry, runtime, shown, t }) : null);
  };
}
