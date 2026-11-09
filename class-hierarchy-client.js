/** Flatten a bounded inheritance DAG into expandable class/member rows, retaining repeated-parent references.
 * @param selection - Visible class nodes and child-to-parent relationships.
 * @param expansion - Per-class expansion overrides; parents start expanded and leaf classes start collapsed.
 * @returns Visible rows and a truncation indicator; cycles and shared children become reference leaves.
 */
export function classHierarchyRows(selection, expansion) {
  const nodes = new Map(selection.nodes.map(node => [node.id, node])), children = new Map(), parented = new Set();
  for (const edge of selection.edges) {
    if (edge.kind === 'field') continue;
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const list = children.get(edge.to) ?? []; list.push(edge); children.set(edge.to, list); parented.add(edge.from);
  }
  const roots = selection.nodes.filter(node => !parented.has(node.id)), covered = new Set();
  const cover = id => { if (covered.has(id)) return; covered.add(id); for (const edge of children.get(id) ?? []) cover(edge.from); };
  roots.forEach(node => cover(node.id));
  for (const node of selection.nodes) if (!covered.has(node.id)) { roots.push(node); cover(node.id); }
  const rows = [], seen = new Set(); let limited = false;
  const add = row => { if (rows.length >= 300) { limited = true; return false; } rows.push(row); return true; };
  const visit = (node, depth, parentKey, edge) => {
    if (limited) return;
    const key = parentKey + '/' + node.id, reference = seen.has(node.id), derived = children.get(node.id) ?? [];
    const expandable = !reference && Boolean(derived.length || node.fields?.length || node.methods.length || node.unresolved.length);
    const expanded = expandable && (expansion.get(node.id) ?? derived.length > 0);
    if (!add({ key, parentKey, node, depth, edge, reference, expandable, expanded, kind: 'class' })) return;
    seen.add(node.id);
    if (!expanded) return;
    for (const child of derived) visit(nodes.get(child.from), depth + 1, key, child);
    for (const field of node.fields ?? []) {
      const relations = selection.edges.filter(edge => edge.kind === 'field' && edge.from === node.id && edge.fields.includes(field.name));
      const targets = relations.length ? relations.map(edge => nodes.get(edge.to)) : [null];
      for (const target of targets) {
        if (!add({ key: key + '/field:' + field.name + ':' + (target?.id ?? ''), parentKey: key, node, member: field, target,
          name: field.name + ': ' + (targets.length > 1 ? target.qualified : field.annotation), depth: depth + 1, kind: 'field' })) break;
      }
    }
    for (const method of node.methods) if (!add({ key: key + '/method:' + method.line + ':' + method.character, parentKey: key, node, member: method, depth: depth + 1, kind: 'method' })) break;
    for (const name of node.unresolved) if (!add({ key: key + '/unresolved:' + name, parentKey: key, node, name, depth: depth + 1, kind: 'unresolved' })) break;
  };
  for (const node of roots) visit(node, 0, '', null);
  return { rows, limited };
}

/** Create a compact, keyboard-navigable class hierarchy using the host React instance.
 * @param React - Host React exports.
 * @returns A read-only tree with class selection, expansion and version-checked source navigation callbacks.
 */
export function createClassHierarchyUI(React) {
  const h = React.createElement, { useState, useMemo, useLayoutEffect, useRef } = React;
  return function ClassHierarchy({ panelId, labelId, selection, expansion, onExpansion, focus, revealKey, onSelect, onOpen, t }) {
    const { rows, limited } = useMemo(() => classHierarchyRows(selection, expansion), [selection, expansion]);
    const [active, setActive] = useState(null), root = useRef(null), id = React.useId();
    const index = Math.max(0, rows.findIndex(row => row.key === active) >= 0 ? rows.findIndex(row => row.key === active) : rows.findIndex(row => row.node.id === focus));
    const current = rows[index];
    const select = row => { setActive(row.key); if (row.kind === 'class') onSelect(row.node.id); };
    const toggle = (row, value = !row.expanded) => onExpansion(new Map(expansion).set(row.node.id, value));
    const open = row => { if (row.kind !== 'unresolved') onOpen(row.target ?? row.node, row.target ?? row.member ?? row.node); };
    useLayoutEffect(() => { setActive(rows.find(row => row.node.id === focus)?.key ?? null); }, [revealKey]);
    useLayoutEffect(() => { root.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active]);
    return h('div', { className: 'jb-class-tree-seat', id: panelId, role: 'tabpanel', 'aria-labelledby': labelId }, limited ? h('div', { role: 'status', className: 'jb-class-hint' }, t('classes.treeLimited')) : null,
      h('div', { ref: root, className: 'jb-class-tree', role: 'tree', tabIndex: 0, 'aria-label': t('classes.tree'), 'aria-activedescendant': current ? id + '-' + index : undefined,
        onKeyDown: event => {
          if (!current) return;
          const key = event.key;
          if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'F4', ' '].includes(key)) return;
          event.preventDefault(); event.stopPropagation();
          if (key === 'Enter' || key === 'F4') { open(current); return; }
          if (key === ' ' && current.expandable) { toggle(current); return; }
          if (key === 'ArrowRight') {
            if (current.expandable && !current.expanded) toggle(current, true);
            else if (rows[index + 1]?.depth > current.depth) select(rows[index + 1]);
          } else if (key === 'ArrowLeft') {
            if (current.expanded) toggle(current, false);
            else { const parent = rows.find(row => row.key === current.parentKey); if (parent) select(parent); }
          } else if (key !== ' ') select(rows[key === 'Home' ? 0 : key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (key === 'ArrowUp' ? -1 : 1)))]);
        } }, ...rows.map((row, at) => {
          const { node, member } = row, label = row.kind === 'class' ? node.qualified : row.kind === 'field' ? row.name : row.kind === 'method' ? member.name + '()' : row.name;
          const title = row.kind === 'method' ? `${member.name}(${member.parameters ?? ''})${member.returns ? ' → ' + member.returns : ''}` : row.kind === 'unresolved' ? t('classes.unresolved') + ': ' + row.name : node.path + ':' + (node.line + 1);
          return h('div', { id: id + '-' + at, key: row.key, role: 'treeitem', className: 'jb-class-tree-row', 'data-active': at === index, 'data-kind': row.kind === 'class' ? node.kind : row.kind,
            'aria-label': label, 'aria-level': row.depth + 1, 'aria-selected': at === index, 'aria-expanded': row.expandable ? row.expanded : undefined, 'aria-disabled': row.kind === 'unresolved' || undefined,
            style: { paddingLeft: 5 + row.depth * 16 }, title,
            onClick: () => { select(row); root.current?.focus({ preventScroll: true }); if (row.kind === 'method' || row.kind === 'field') open(row); },
            onDoubleClick: () => { if (row.kind === 'class') open(row); } },
            row.expandable ? h('button', { type: 'button', tabIndex: -1, className: 'jb-class-tree-toggle', 'aria-label': t(row.expanded ? 'classes.collapse' : 'classes.expand', { name: node.qualified }), onClick: event => { event.stopPropagation(); select(row); toggle(row); root.current?.focus({ preventScroll: true }); } }, row.expanded ? '▾' : '▸') : h('span', { className: 'jb-class-tree-toggle', 'aria-hidden': true }, row.reference ? '↗' : ''),
            h('span', { className: 'jb-class-tree-symbol', 'aria-hidden': true }, row.kind === 'field' ? 'f' : row.kind === 'method' ? 'm' : row.kind === 'unresolved' ? '?' : node.kind === 'protocol' ? 'P' : ['abstract','abc'].includes(node.kind) ? 'A' : 'C'),
            h('span', { className: 'jb-class-tree-name' }, label),
            row.edge?.kind === 'factory' ? h('span', { className: 'jb-class-tree-badge', title: t('classes.factoryHint') }, t('classes.factoryShort')) : null,
            row.reference ? h('span', { className: 'jb-class-tree-badge', title: t('classes.reference') }, '↗') : null,
            row.kind === 'class' ? h('span', { className: 'jb-class-tree-path' }, node.path.split('/').at(-1)) : null);
        })));
  };
}
