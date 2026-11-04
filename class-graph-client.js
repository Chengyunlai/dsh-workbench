import { Graph, layout as arrange } from '@dagrejs/dagre';

/** Modeless Python class relationships and source navigation; all content comes from the static grammar index. */

/** Lay out a focused inheritance component with bases above children, bounding visible cards.
 * @param graph - Class nodes and child-to-base edges.
 * @param focus - Selected class identifier, or null for all declarations.
 * @returns Visible positioned nodes, edges, dimensions and truncation state.
 */
export function classGraphLayout(graph, focus) {
  const included = new Set(focus ? [focus] : graph.nodes.map(n => n.id));
  if (focus) {
    const queue = [focus];
    for (let i = 0; i < queue.length; i++) for (const edge of graph.edges) {
      const other = edge.from === queue[i] ? edge.to : edge.to === queue[i] ? edge.from : null;
      if (other && !included.has(other)) { included.add(other); queue.push(other); }
    }
  }
  const visible = new Set([...included].slice(0, 100));
  const nodes = graph.nodes.filter(node => visible.has(node.id)), ids = new Set(nodes.map(n => n.id));
  const edges = graph.edges.filter(e => ids.has(e.from) && ids.has(e.to));
  const diagram = new Graph({ multigraph: true }).setGraph({ rankdir: 'TB', ranksep: 76, nodesep: 48, edgesep: 20, marginx: 32, marginy: 32 }).setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    const signatures = (node.methods ?? []).map(m => m.name + '(' + (m.parameters ?? '') + ')' + (m.returns ? '  ' + m.returns : ''));
    const length = Math.max(node.qualified?.length ?? 0, ...signatures.map(s => s.length));
    diagram.setNode(node.id, { width: Math.max(244, Math.min(370, length * 6.6 + 62)), height: 67 + Math.max(1, Math.min(7, signatures.length)) * 25 + (node.unresolved?.length || node.decorated ? 22 : 0) });
  }
  for (const [index, edge] of edges.entries()) diagram.setEdge(edge.to, edge.from, {}, String(index));
  if (nodes.length) arrange(diagram);
  const placed = nodes.map(node => { const box = diagram.node(node.id); return { ...node, x: box.x - box.width / 2, y: box.y - box.height / 2, width: box.width, height: box.height }; });
  const routed = edges.map((edge, index) => ({ ...edge, points: diagram.edge(edge.to, edge.from, String(index)).points }));
  return { nodes: placed, edges: routed, limited: included.size > nodes.length, width: Math.max(400, diagram.graph().width ?? 0), height: Math.max(240, diagram.graph().height ?? 0) };
}

/** Create a theme-token-driven graph window using the host React instance.
 * @param React - Host React exports.
 * @param api - Authenticated JSON request helper.
 * @param createPortal - Host React portal renderer.
 * @returns A modeless window component that owns request cancellation and viewport state.
 */
export function createClassGraphUI(React, api, createPortal) {
  const h = React.createElement, { useState, useEffect, useRef, useMemo } = React;
  return function ClassGraphWindow({ cwd, seed, onOpen, onClose, t }) {
    const [graph, setGraph] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
    const [focus, setFocus] = useState(null), [query, setQuery] = useState(''), [dock, setDock] = useState('right'), [zoom, setZoom] = useState(1);
    const root = useRef(null), scroll = useRef(null), opening = useRef(null);
    useEffect(() => { root.current?.focus(); return () => opening.current?.abort(); }, []);
    useEffect(() => {
      opening.current?.abort(); const controller = new AbortController(); setBusy(true); setError(null);
      api('/api/git.classes?' + new URLSearchParams({ cwd }), { signal: controller.signal })
        .then(data => {
          if (controller.signal.aborted) return;
          if (!Array.isArray(data.nodes) || !data.nodes.every(n => n && typeof n.id === 'string' && typeof n.path === 'string' && typeof n.qualified === 'string' && typeof n.version === 'string' && Number.isSafeInteger(n.line) && n.line >= 0 && Number.isSafeInteger(n.character) && n.character >= 0 && ['class','abc','abstract','protocol'].includes(n.kind) && Array.isArray(n.methods) && n.methods.every(m => m && typeof m.name === 'string' && Number.isSafeInteger(m.line) && m.line >= 0 && Number.isSafeInteger(m.character) && m.character >= 0 && (m.parameters === undefined || typeof m.parameters === 'string') && (m.returns === undefined || typeof m.returns === 'string')) && ['abstractMethods','overrides','unresolved'].every(key => Array.isArray(n[key]) && n[key].every(value => typeof value === 'string'))) || !Array.isArray(data.edges) || !data.edges.every(e => e && data.nodes.some(n => n.id === e.from) && data.nodes.some(n => n.id === e.to)) || !Array.isArray(data.skipped)) throw new Error(t('classes.invalid'));
          setGraph(data);
          const matching = data.nodes.filter(n => n.path === seed?.path && n.line <= (seed?.line ?? 0)).sort((a, b) => b.line - a.line);
          setFocus(matching[0]?.id ?? data.nodes.find(n => n.path === seed?.path)?.id ?? data.nodes[0]?.id ?? null);
        })
        .catch(error => { if (!controller.signal.aborted) setError(t('classes.failed', { message: error.message })); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
      return () => controller.abort();
    }, [cwd, seed, revision]);
    const layout = useMemo(() => graph ? classGraphLayout(graph, focus) : null, [graph, focus]);
    useEffect(() => {
      const node = layout?.nodes.find(n => n.id === focus), element = scroll.current;
      if (node && element) {
        element.scrollLeft = Math.max(0, (node.x + node.width / 2) * zoom - element.clientWidth / 2);
        element.scrollTop = Math.max(0, (node.y + node.height / 2) * zoom - element.clientHeight / 2);
      }
    }, [layout, focus]);
    const show = id => { setFocus(id); if (scroll.current) { scroll.current.scrollLeft = 0; scroll.current.scrollTop = 0; } };
    const jump = async (node, member = node) => {
      opening.current?.abort(); const controller = new AbortController(); opening.current = controller;
      try {
        const source = await api('/api/git.source?' + new URLSearchParams({ cwd, path: node.path }), { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (source.version !== node.version) { setError(t('classes.changed')); return; }
        onOpen({ path: node.path, line: member.line, character: member.character, focusSource: true });
      } catch (error) { if (!controller.signal.aborted) setError(t('classes.failed', { message: error.message })); }
    };
    const pan = event => {
      if (event.button !== 0 || event.target.closest('.jb-class-card,button')) return;
      const element = scroll.current, start = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
      element.setPointerCapture(event.pointerId);
      const move = e => { element.scrollLeft = start.left - e.clientX + start.x; element.scrollTop = start.top - e.clientY + start.y; };
      const end = () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); element.removeEventListener('lostpointercapture', end); };
      element.addEventListener('pointermove', move); element.addEventListener('pointerup', end); element.addEventListener('lostpointercapture', end);
    };
    const positioned = new Map(layout?.nodes.map(n => [n.id, n]) ?? []);
    return createPortal(h('section', { ref: root, tabIndex: -1, role: 'region', 'aria-label': t('classes.title'), className: 'jb-class-window', 'data-dock': dock,
      onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } } },
      h('header', null, h('strong', null, t('classes.title')), h('span', { className: 'jb-spacer' }),
        h('label', null, t('classes.dock'), ' ', h('select', { value: dock, onChange: e => setDock(e.target.value) }, ...['right', 'bottom'].map(value => h('option', { key: value, value }, t('classes.' + value))))),
        h('button', { type: 'button', onClick: () => { opening.current?.abort(); onClose(); }, 'aria-label': t('classes.close') }, '×')),
      h('div', { className: 'jb-class-controls' },
        h('input', { type: 'search', value: query, 'aria-label': t('classes.search'), placeholder: t('classes.search'), onChange: e => setQuery(e.target.value) }),
        h('button', { type: 'button', disabled: busy, onClick: () => setRevision(n => n + 1) }, t('classes.refresh')),
        h('button', { type: 'button', onClick: () => show(null) }, t('classes.all')),
        h('button', { type: 'button', 'aria-label': t('classes.zoomOut'), disabled: zoom <= .4, onClick: () => setZoom(z => Math.max(.4, z - .2)) }, '−'),
        h('button', { type: 'button', 'aria-label': t('classes.zoomReset'), onClick: () => setZoom(1) }, Math.round(zoom * 100) + '%'),
        h('button', { type: 'button', 'aria-label': t('classes.zoomIn'), disabled: zoom >= 2, onClick: () => setZoom(z => Math.min(2, z + .2)) }, '+')),
      query && graph ? h('div', { className: 'jb-class-results', role: 'list', 'aria-label': t('classes.search') }, ...graph.nodes.filter(n => (n.qualified + ' ' + n.path).toLowerCase().includes(query.toLowerCase())).slice(0, 50).map(n => h('button', { type: 'button', key: n.id, onClick: () => { show(n.id); setQuery(''); } }, n.qualified + ' · ' + n.path))) : null,
      h('div', { className: 'jb-class-hint' }, t('classes.hint')),
      h('div', { className: 'jb-class-legend' }, h('span', { className: 'jb-class-legend-inherit' }, t('classes.inherits')), h('span', { className: 'jb-class-legend-protocol' }, t('classes.protocolBase')), h('span', null, t('classes.abstractHint'))),
      busy ? h('div', { role: 'status' }, t('loading')) : null,
      error ? h('div', { role: 'alert', className: 'jb-class-hint' }, error) : null,
      graph?.limited || layout?.limited ? h('div', { role: 'status', className: 'jb-class-hint' }, t('classes.limited')) : null,
      graph?.skipped.length ? h('details', { className: 'jb-class-hint' }, h('summary', null, t('classes.skipped', { n: String(graph.skipped.length) })), ...graph.skipped.map(row => h('div', { key: row.path }, row.path + ' · ' + row.code))) : null,
      graph && !graph.nodes.length && !busy ? h('div', { className: 'jb-class-hint' }, t('classes.empty')) : null,
      h('div', { className: 'jb-class-viewport', ref: scroll, onPointerDown: pan }, layout ? h('div', { style: { width: layout.width * zoom, height: layout.height * zoom } },
        h('div', { className: 'jb-class-canvas', style: { width: layout.width, height: layout.height, transform: `scale(${zoom})` } },
          h('svg', { width: layout.width, height: layout.height, 'aria-hidden': true, className: 'jb-class-links' }, ...layout.edges.map(edge => {
            const parent = positioned.get(edge.to), points = [...edge.points].reverse();
            const end = points.at(-1), before = points.at(-2) ?? end;
            const direction = end.y < before.y ? 1 : -1;
            const lineEnd = { x: end.x, y: end.y + direction * 9 };
            let d = `M${points[0].x},${points[0].y}`;
            if (points.length <= 3) d += ` V${(points[0].y + lineEnd.y) / 2} H${lineEnd.x} V${lineEnd.y}`;
            else for (let i = 1; i < points.length; i++) {
              const a = points[i - 1], b = i === points.length - 1 ? lineEnd : points[i];
              if (Math.abs(a.x - b.x) > 1 && Math.abs(a.y - b.y) > 1) d += ` V${(a.y + b.y) / 2} H${b.x} V${b.y}`;
              else d += ` L${b.x},${b.y}`;
            }
            return h('g', { key: edge.from + ':' + edge.to, 'data-protocol': parent.kind === 'protocol' }, h('path', { className: 'jb-class-edge', d, fill: 'none' }), h('path', { className: 'jb-class-arrow', d: `M${end.x},${end.y} l-5,${direction * 9} h10 z` }));
          })),
          ...layout.nodes.map(node => h('article', { key: node.id, className: 'jb-class-card', 'data-selected': focus === node.id, 'data-kind': node.kind, style: { left: node.x, top: node.y, width: node.width, height: node.height }, 'aria-label': node.qualified },
            h('div', { className: 'jb-class-heading' },
              h('span', { className: 'jb-class-symbol', title: t('classes.' + node.kind), 'aria-label': t('classes.' + node.kind) }, node.kind === 'protocol' ? 'P' : node.kind === 'abstract' || node.kind === 'abc' ? 'A' : 'C'),
              h('button', { type: 'button', className: 'jb-class-name', title: node.qualified + ' · ' + t('classes.open') + ' · ' + node.path, onClick: () => show(node.id), onDoubleClick: () => jump(node), onKeyDown: e => { if (e.key === 'F4' || e.key === 'Enter') { e.preventDefault(); jump(node); } } }, node.qualified)),
            h('div', { className: 'jb-class-path', title: node.path }, node.path + ':' + (node.line + 1)),
            h('div', { className: 'jb-class-members' }, ...node.methods.map(method => h('button', { key: method.name + ':' + method.line, type: 'button', onClick: () => jump(node, method), title: `${method.name}(${method.parameters ?? ''})${method.returns ? ' → ' + method.returns : ''}`, 'data-abstract': node.abstractMethods.includes(method.name) },
              h('span', { className: 'jb-class-method-symbol', 'aria-hidden': true }, node.overrides.includes(method.name) ? '↥' : 'm'),
              h('span', { className: 'jb-class-method-name' }, method.name, h('span', { className: 'jb-class-parameters' }, '(' + (method.parameters ?? '') + ')')),
              method.returns ? h('span', { className: 'jb-class-return' }, method.returns) : null))),
            node.unresolved.length ? h('div', { className: 'jb-class-unresolved', title: node.unresolved.join(', ') }, t('classes.unresolved') + ': ' + node.unresolved.join(', ')) : null,
            node.decorated ? h('div', { className: 'jb-class-unresolved' }, t('classes.decorated')) : null)))) : null)), document.body);
  };
}
