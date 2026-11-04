/** Bottom terminal UI backed by the host's terminal controller; the emulator loads on explicit open. */
export function createTerminalDock(React, loadRuntime) {
  const { createElement: h, useState, useRef, useEffect, useLayoutEffect } = React;
  function Screen({ entry, runtime, shown, cwd, onClose, t }) {
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
      h('div', { className: 'jb-terminal-bar' },
        h('span', { className: 'jb-terminal-path', title: cwd }, cwd?.split(/[\\/]/).at(-1) ?? ''),
        h('button', { type: 'button', disabled: !state.writable, onClick: () => entry.model.write('\x03') }, t('terminal.interrupt')),
        h('button', { type: 'button', onClick: onClose }, t('terminal.close'))),
      h('div', { className: 'jb-terminal-screen', ref: parent, hidden: !shown }),
      shown && (ended || failed || state.error || state.issue) ? h('div', { className: 'jb-terminal-notice', role: failed || state.error || state.issue ? 'alert' : 'status' },
        t(ended ? 'terminal.exited' : 'terminal.failed'),
        !ended ? h('button', { type: 'button', onClick: () => { if (state.info) entry.model.connect(); else void entry.model.refresh(); } }, t('terminal.retry')) : null) : null,
      shown && !ended && !failed && !state.issue && ['idle', 'loading', 'creating', 'connecting'].includes(state.phase) ? h('div', { className: 'jb-terminal-notice', role: 'status' }, t('terminal.connecting')) : null,
      shown && state.phase === 'connected' && !state.writable ? h('button', { className: 'jb-terminal-notice', type: 'button', onClick: () => entry.model.connect() }, t('terminal.control')) : null);
  }
  return function TerminalDock({ sessionId, cwd, available, active, onClose, create, release, t }) {
    const [entry, setEntry] = useState(null), [runtime, setRuntime] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(false);
    const current = useRef(null), lifetime = useRef(0);
    useEffect(() => () => { lifetime.current++; if (current.current) release(current.current); }, []);
    const open = async () => {
      if (!available || entry || loading) return;
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
    useEffect(() => { if (active) void open(); }, [active, available]);
    const close = () => { lifetime.current++; if (current.current) release(current.current); current.current = null; setEntry(null); setLoading(false); setError(false); onClose(); };
    return h('section', { className: 'jb-terminal', 'aria-label': t('terminal.title') },
      !entry ? h('div', { className: 'jb-terminal-bar' },
        h('span', { className: 'jb-terminal-path', title: cwd }, cwd?.split(/[\\/]/).at(-1) ?? ''),
        loading ? h('button', { type: 'button', onClick: close }, t('terminal.close')) : null) : null,
      !available && !entry ? h('div', { className: 'jb-terminal-notice' }, t('terminal.unavailable')) : null,
      error && active ? h('div', { className: 'jb-terminal-notice', role: 'alert' }, t('terminal.failed'), h('button', { type: 'button', onClick: () => void open() }, t('terminal.retry'))) : null,
      loading && active ? h('div', { className: 'jb-terminal-notice', role: 'status' }, t('terminal.connecting')) : null,
      entry && runtime ? h(Screen, { entry, runtime, shown: active, cwd, onClose: close, t }) : null);
  };
}
