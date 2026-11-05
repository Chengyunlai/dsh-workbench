/** Client-local pane sizes and accessible drag/keyboard dividers without editor remounts. */
const storageKey = 'dsh.git-control.paneSizes';
const sizeKeys = ['treeWidth', 'treeHeight', 'classWidth', 'classHeight'];
const variable = key => '--jb-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());

/** Create pane layout controls using the host React instance.
 * @param React - Host React exports.
 * @returns A persistent size hook and a pointer/keyboard divider component.
 */
export function createPaneLayout(React) {
  const h = React.createElement;
  const { useState, useRef, useLayoutEffect, useEffect } = React;
  function usePaneLayout(t) {
    const root = useRef(null), workspace = useRef(null);
    const [sizes, setSizes] = useState(() => {
      try {
        const data = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}');
        return Object.fromEntries(sizeKeys.filter(key => data && typeof data[key] === 'number' && Number.isFinite(data[key]) && data[key] > 0 && data[key] <= 10000).map(key => [key, data[key]]));
      } catch (error) { return {}; } // Missing or unreadable preferences use the CSS defaults.
    });
    const current = useRef(sizes); current.current = sizes;
    const [error, setError] = useState(null);
    const save = (key, value) => {
      const next = { ...current.current };
      if (value === null) delete next[key]; else next[key] = value;
      current.current = next; setSizes(next);
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)); setError(null); }
      catch (error) { setError(t('layout.unsaved')); }
    };
    return { root, workspace, save, error, style: Object.fromEntries(Object.entries(sizes).map(([key, value]) => [variable(key), value + 'px'])) };
  }
  function PaneDivider({ layout, t, hidden = false, pane = 'tree' }) {
    const ref = useRef(null), drag = useRef(null), latest = useRef(null);
    latest.current = { layout, t };
    const [metrics, setMetrics] = useState({ axis: 'x', key: 'treeWidth', min: 0, max: 0, value: 0 });
    const [dragging, setDragging] = useState(false);
    const geometry = () => {
      const parent = ref.current.parentElement;
      const classes = pane === 'classes', element = parent.querySelector(classes ? '.jb-class-window' : '.jb-tree');
      const vertical = window.getComputedStyle(parent).flexDirection !== 'column';
      const axis = vertical ? 'x' : 'y', dimension = vertical ? 'width' : 'height';
      const available = parent.getBoundingClientRect()[dimension];
      const gap = ref.current.getBoundingClientRect()[dimension];
      const preferred = classes ? (vertical ? 240 : 160) : (vertical ? 160 : 60);
      const remaining = classes && vertical ? 280 : vertical ? 240 : 160;
      const min = classes ? Math.min(preferred, available * .45) : vertical ? preferred : Math.min(preferred, available * .3);
      return { axis, key: classes ? (vertical ? 'classWidth' : 'classHeight') : vertical ? 'treeWidth' : 'treeHeight', direction: classes ? -1 : 1,
        min: Math.round(min), max: Math.round(Math.max(min, available - Math.min(remaining, available * .6) - gap)), value: Math.round(element?.getBoundingClientRect()[dimension] ?? 0) };
    };
    const finish = cancelled => {
      const operation = drag.current;
      if (!operation) return;
      drag.current = null;
      const root = latest.current.layout.root.current;
      if (cancelled) {
        if (operation.previous) root.style.setProperty(variable(operation.key), operation.previous);
        else root.style.removeProperty(variable(operation.key));
      } else latest.current.layout.save(operation.key, operation.value);
      setDragging(false);
      if (ref.current?.hasPointerCapture(operation.pointerId)) ref.current.releasePointerCapture(operation.pointerId);
      setMetrics(geometry());
    };
    useLayoutEffect(() => {
      if (hidden) { finish(true); return; }
      const measure = () => {
        const next = geometry();
        if (drag.current && drag.current.key !== next.key) finish(true);
        if (!drag.current) setMetrics(previous => Object.keys(next).every(key => previous[key] === next[key]) ? previous : next);
      };
      measure();
      const observer = new window.ResizeObserver(measure);
      const parent = ref.current.parentElement;
      observer.observe(ref.current.closest('.jb-code-browser')); observer.observe(parent);
      const element = parent.querySelector(pane === 'classes' ? '.jb-class-window' : '.jb-tree');
      if (element) observer.observe(element);
      return () => observer.disconnect();
    }, [hidden, pane, layout.root, layout.workspace]);
    useEffect(() => () => {
      const operation = drag.current;
      if (!operation) return;
      // A departing divider owns no persistent size until pointer-up commits it.
      const root = latest.current.layout.root.current;
      if (root) {
        if (operation.previous) root.style.setProperty(variable(operation.key), operation.previous);
        else root.style.removeProperty(variable(operation.key));
      }
      drag.current = null;
    }, []);
    const apply = (next, value) => {
      const size = Math.round(Math.max(next.min, Math.min(next.max, value)));
      latest.current.layout.root.current.style.setProperty(variable(next.key), size + 'px');
      setMetrics({ ...next, value: size });
      return size;
    };
    const reset = () => {
      finish(true);
      const next = geometry();
      layout.root.current.style.removeProperty(variable(next.key)); layout.save(next.key, null);
      setMetrics(geometry());
    };
    return h('div', { ref, hidden, role: 'separator', tabIndex: hidden ? -1 : 0, className: 'jb-pane-divider', 'data-pane': pane, 'data-dragging': dragging,
      'aria-label': t('layout.' + metrics.key), 'aria-orientation': metrics.axis === 'x' ? 'vertical' : 'horizontal',
      'aria-valuemin': metrics.min, 'aria-valuemax': metrics.max, 'aria-valuenow': metrics.value, 'aria-valuetext': t('layout.pixels', { n: String(metrics.value) }),
      title: t('layout.resizeHint'),
      onPointerDown: event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        const next = geometry();
        drag.current = { ...next, pointerId: event.pointerId, origin: next.axis === 'x' ? event.clientX : event.clientY, start: next.value, previous: layout.root.current.style.getPropertyValue(variable(next.key)) };
        event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
      },
      onPointerMove: event => {
        const operation = drag.current;
        if (!operation || event.pointerId !== operation.pointerId) return;
        event.preventDefault();
        const position = operation.axis === 'x' ? event.clientX : event.clientY;
        operation.value = apply(operation, operation.start + (position - operation.origin) * operation.direction);
      },
      onPointerUp: event => { if (event.pointerId === drag.current?.pointerId) finish(false); },
      onPointerCancel: event => { if (event.pointerId === drag.current?.pointerId) finish(true); },
      onLostPointerCapture: () => finish(true), onDoubleClick: reset,
      onKeyDown: event => {
        if (event.key === 'Escape' && drag.current) { event.preventDefault(); finish(true); return; }
        const next = geometry();
        const negative = next.axis === 'x' ? 'ArrowLeft' : 'ArrowUp', positive = next.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); reset(); return; }
        if (![negative, positive, 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const value = event.key === 'Home' ? next.min : event.key === 'End' ? next.max : next.value + (event.key === negative ? -1 : 1) * next.direction * (event.shiftKey ? 40 : 10);
        layout.save(next.key, apply(next, value));
      },
    });
  }
  return { usePaneLayout, PaneDivider };
}
