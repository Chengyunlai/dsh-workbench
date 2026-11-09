/** Panel-local editor groups and internal tab drag/drop; external file drops are ignored.
 * @param React - Host React exports.
 * @returns A hook owning two editor groups and their drag state.
 */
export function createEditorSplit(React) {
  const { useRef, useState } = React;
  return function useEditorSplit() {
    const groups = useRef({}), dragging = useRef(null);
    const [split, setSplit] = useState(null), [active, setActive] = useState('primary'), [over, setOver] = useState(null);
    const clear = () => { dragging.current = null; setOver(null); };
    const region = event => {
      if (event.target.closest('.jb-source-tabs')) return 'center';
      const box = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
      const distances = { left: x, right: 1 - x, top: y, bottom: 1 - y };
      const side = Object.keys(distances).sort((a, b) => distances[a] - distances[b])[0];
      return distances[side] <= .25 ? side : 'center';
    };
    const move = (record, destination, keepSource = false) => {
      const source = groups.current[record.group], receiver = groups.current[destination];
      if (record.group === destination) { receiver?.receive(record.target); return; }
      receiver?.receive(record.target);
      if (!keepSource) source?.remove(record.path);
      setActive(destination);
    };
    return { groups, split, active, over, setActive,
      openSplit: setSplit,
      close: () => { setSplit(null); setActive('primary'); clear(); },
      drag: (group, path, event) => {
        const source = groups.current[group];
        dragging.current = { group, path, target: source.snapshot(path) };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-dsh-workbench-tab', path);
      }, clear,
      handlers: group => ({
        onDragOver: event => {
          if (!dragging.current) return;
          event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
          const side = region(event); setOver(old => old?.group === group && old.side === side ? old : { group, side });
        },
        onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(null); },
        onDrop: event => {
          const record = dragging.current;
          if (!record) return;
          event.preventDefault(); event.stopPropagation();
          const side = region(event); clear();
          if (side === 'center') { move(record, group); return; }
          const axis = side === 'left' || side === 'right' ? 'x' : 'y';
          const reverse = side === 'left' || side === 'top';
          if (!split) {
            setSplit({ axis, reverse, initial: record.target });
            if (groups.current[record.group].paths.length > 1) groups.current[record.group].remove(record.path);
            setActive('secondary');
          } else {
            setSplit(old => ({ ...old, axis, reverse }));
            move(record, 'secondary', record.group === 'primary' && groups.current.primary.paths.length === 1);
          }
        },
      }),
    };
  };
}
