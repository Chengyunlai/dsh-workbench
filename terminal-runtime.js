/** On-demand xterm screen. The host model owns PTY execution, transport and flow control. */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import css from '@xterm/xterm/css/xterm.css';

/** Mount one emulator and return state, visibility and disposal commands. */
export function mountTerminal(parent, model, label) {
  const style = document.createElement('style'); style.textContent = css; parent.append(style);
  const node = document.createElement('div'); node.className = 'jb-terminal-emulator'; parent.append(node);
  const terminal = new Terminal({ fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', cursorBlink: true, minimumContrastRatio: 4.5, allowProposedApi: false });
  const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(node); terminal.textarea?.setAttribute('aria-label', label);
  let state, revision = 0, shown = true, disposed = false, lastColors;
  const theme = () => { const colors = getComputedStyle(parent); const nextColors = colors.backgroundColor + colors.color; if (lastColors === nextColors) return; lastColors = nextColors; terminal.options.theme = { background: colors.backgroundColor, foreground: colors.color, cursor: colors.color, cursorAccent: colors.backgroundColor, selectionBackground: getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-document-selection').trim() || '#64748b80' }; };
  const measure = () => {
    if (!shown || !state?.writable || !parent.clientWidth || !parent.clientHeight) return;
    const size = fit.proposeDimensions(); if (!size) return;
    const cols = Math.min(size.cols, state.environment?.maxCols ?? size.cols), rows = Math.min(size.rows, state.environment?.maxRows ?? size.rows);
    if (cols < 2 || rows < 1) return; terminal.resize(cols, rows); model.resize(cols, rows);
  };
  const resize = new ResizeObserver(measure); resize.observe(parent);
  const colors = new MutationObserver(theme); colors.observe(document.documentElement, { attributes: true, subtree: false }); colors.observe(document.body, { attributes: true });
  const input = terminal.onData(data => model.write(data)); theme();
  return {
    update(next) {
      state = next; terminal.options.disableStdin = !next.writable;
      if (next.environment) terminal.options.scrollback = next.environment.scrollback;
      const render = next.render;
      if (render && render.revision > revision) {
        revision = render.revision;
        if (render.frame.type === 'snapshot') { terminal.reset(); terminal.resize(render.frame.info.cols, render.frame.info.rows); }
        terminal.write(render.frame.type === 'snapshot' ? render.frame.screen : render.frame.data, () => { if (!disposed) model.acknowledge(render.revision); });
      }
      measure();
    },
    visible(value) { shown = value; if (shown) { measure(); terminal.focus(); } },
    dispose() { disposed = true; resize.disconnect(); colors.disconnect(); input.dispose(); terminal.dispose(); style.remove(); node.remove(); },
  };
}
