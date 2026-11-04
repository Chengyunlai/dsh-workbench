/** One session-scoped selection and shared height for the workbench's bottom tool window. */
export function createBottomTools(React) {
  const { useState, useRef, useCallback } = React;
  const storageKey = 'dsh.workbench.toolHeight';
  return function useBottomTools(scope, t) {
    const [selection, setSelection] = useState({ scope, tool: null });
    const [height, setHeight] = useState(() => {
      try {
        const stored = Number(window.localStorage.getItem(storageKey));
        return Number.isFinite(stored) && stored >= 120 && stored <= 600 ? stored : 260;
      } catch (error) { return 260; } // Storage restrictions do not prevent using the tool window.
    });
    const [error, setError] = useState(null);
    const drag = useRef(null);
    const save = value => {
      setHeight(value);
      try { window.localStorage.setItem(storageKey, String(value)); setError(null); }
      catch (error) { setError(t('layout.unsaved')); }
    };
    const limit = (value, element) => Math.round(Math.max(120, Math.min(600,
      (element.closest('.jb-root')?.getBoundingClientRect().height || 1000) * .6, value)));
    const show = useCallback(tool => setSelection({ scope, tool }), [scope]);
    const toggle = tool => setSelection(previous => ({ scope, tool: previous.scope === scope && previous.tool === tool ? null : tool }));
    const cancel = () => { if (drag.current) setHeight(drag.current.height); drag.current = null; };
    return {
      active: selection.scope === scope ? selection.tool : null, height, error, show, toggle,
      hide: () => show(null),
      divider: {
        role: 'separator', tabIndex: 0, 'aria-label': t('tools.resize'), 'aria-orientation': 'horizontal',
        'aria-valuemin': 120, 'aria-valuemax': 600, 'aria-valuenow': height,
        title: t('layout.resizeHint'),
        onPointerDown: event => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag.current = { y: event.clientY, height, value: height, pointerId: event.pointerId };
          event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: event => {
          if (!drag.current || drag.current.pointerId !== event.pointerId) return;
          drag.current.value = limit(drag.current.height + drag.current.y - event.clientY, event.currentTarget);
          setHeight(drag.current.value);
        },
        onPointerUp: event => {
          if (drag.current?.pointerId !== event.pointerId) return;
          const value = drag.current.value; drag.current = null; save(value);
          event.currentTarget.releasePointerCapture(event.pointerId);
        },
        onPointerCancel: cancel, onLostPointerCapture: cancel,
        onDoubleClick: () => { cancel(); save(260); },
        onKeyDown: event => {
          if (event.key === 'Escape' && drag.current) { event.preventDefault(); cancel(); return; }
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const value = event.key === 'Home' ? 120 : event.key === 'End' ? 600 : event.key === 'Enter' ? 260
            : height + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 40 : 10);
          save(limit(value, event.currentTarget));
        },
      },
    };
  };
}
