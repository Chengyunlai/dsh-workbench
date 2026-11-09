import { createClassGraphUI } from './class-graph-client.js';
import { createTerminalDock } from './terminal-client.js';
import { createDebugUI } from './debug-client.js';
import { createSourceEditor } from './source-editor.js';
import { createMarkdownReader } from './markdown-reader.js';
import { createPaneLayout } from './pane-layout.js';
import { createBottomTools } from './bottom-tools.js';
import { createWorkspaceSearchUI } from './workspace-search-client.js';
import { parsePreviewAddress, previewPatterns, resolveDocumentPreview } from './document-preview.js';

/**
 * DSH Workbench — code, documents, Git inspection and debugging beside chat.
 *
 * A project workbench with file browsing, read-only source and documents,
 * definitions, Git inspection, and explicit launch/attach debugging.
 * Source and Git operations are read-only; debugged programs execute normally.
 * The client shares React and theme variables with the Harness host.
 */
window.__ModuleLoader__.load({
  id: '@yunlai/dsh-workbench',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;
    const { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } = React;
    const TerminalDock = createTerminalDock(React, () => require.async('./client.terminal.js'));
    const MarkdownReader = createMarkdownReader(React);
    const { usePaneLayout, PaneDivider } = createPaneLayout(React);
    const useBottomTools = createBottomTools(React);
    const WorkspaceSearch = createWorkspaceSearchUI(React, api);

    // Stable installation, locale and dock ids preserve existing profiles and open panes.
    const NS = 'git-control';
    const PANEL_ID = 'git';
    const TAB_ID = '@local/dsh-git-control';

    // Host variables also reach editor menus portalled directly into document.body.
    const C = {
      bg: 'var(--dsw-alias-bg-base)',
      panel: 'var(--dsw-alias-bg-layer-1)',
      toolbar: 'var(--dsw-alias-bg-layer-2)',
      gutter: 'var(--dsw-alias-markdown-code-block-banner)',
      border: 'var(--dsw-alias-border-l2)',
      text: 'var(--dsw-alias-label-primary)',
      textDim: 'var(--dsw-alias-label-secondary)',
      code: 'var(--shiki-foreground)',
      selection: 'var(--dsw-alias-interactive-bg-active)',
      textSelection: 'var(--dsw-alias-bg-document-selection)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
      accent: 'var(--dsw-alias-state-business-primary)',
      primary: 'var(--dsw-alias-button-primary-fill)',
      primaryHover: 'var(--dsw-alias-button-primary-hover)',
      onPrimary: 'var(--dsw-alias-label-primary-foreground)',
      added: 'var(--dsw-alias-file-diff-added-marker)',
      modified: 'var(--dsw-alias-link)',
      deleted: 'var(--dsw-alias-file-diff-deleted-marker)',
      untracked: 'var(--dsw-alias-label-secondary)',
      diffAddBg: 'var(--dsw-alias-file-diff-added-bg)',
      diffDelBg: 'var(--dsw-alias-file-diff-deleted-bg)',
      diffAddGutter: 'var(--dsw-alias-file-diff-added-gutter)',
      diffDelGutter: 'var(--dsw-alias-file-diff-deleted-gutter)',
      diffAddFg: 'var(--dsw-alias-label-primary)',
      diffDelFg: 'var(--dsw-alias-label-primary)',
      // Nested literal and punctuation styles override enclosing annotation/type colors.
      syntax: {
        annotation: 'var(--shiki-token-string-expression)', type: 'var(--shiki-token-constant)',
        property: 'var(--shiki-token-parameter)', function: 'var(--shiki-token-function)',
        keyword: 'var(--shiki-token-keyword)', string: 'var(--shiki-token-string)',
        number: 'var(--shiki-token-constant)', comment: 'var(--shiki-token-comment)',
        escape: 'var(--shiki-token-parameter)', punctuation: 'var(--shiki-token-punctuation)',
      },
    };
    const GRAPH_COLORS = [C.modified, C.added, 'var(--dsw-alias-state-warn-label)', C.deleted, 'var(--dsw-alias-state-done-primary)', C.syntax.annotation];

    // ------------------------------------------------------------- i18n
    const en = {
      'debug.inspect': 'Inspect variable value', 'debug.hoverMissing': 'Not exposed in the selected frame', 'debug.hoverLimited': 'Variable limit reached; use Evaluate expression', 'debug.hoverInvalid': 'Invalid variable response', 'debug.hoverFailed': 'Could not inspect this variable: {message}',
      'debug.typeDefinition': 'Go to source type definition', 'debug.typeMissing': 'No source type definition found',
      "tree.locate": "Locate current file",
      "tree.findName": "Find by file name",
      "tree.findFile": "Find in file",
      "tree.findDirectory": "Find in directory",
      "classes.inherits": "Inheritance", "classes.protocolBase": "Declared Protocol base", "classes.abstractHint": "Italic: abstract method",
      "classes.factory": "Factory return association", "classes.factoryHint": "Annotated factory returns · Not a protocol compatibility check",
      "classes.evidence": "Factory return evidence", "classes.fit": "Fit diagram to pane",
      "classes.languageTitle": "{language} class relationships", "classes.beta": "Beta", "classes.betaHint": "Python class analysis is in Beta.",
      "classes.unsupportedFile": "This is a {language} file. Class relationships currently support Python (.py/.pyi) only, in Beta.",
      "classes.unsupportedProject": "This project uses {language}. Class relationships currently support Python only, in Beta.",
      "classes.mixedUnsupported": "Multiple project languages detected. Select a Python file to use class relationships (Beta).",
      "classes.externalUnsupported": "Library source previews are readable, but library class analysis is not supported. Select a workspace Python file (Beta).",
      "classes.choosePython": "Select a Python file or open a Python project to use class relationships (Beta).", "classes.detecting": "Identifying project file types…",
      "classes.language.python": "Python", "classes.language.javascript": "JavaScript", "classes.language.typescript": "TypeScript", "classes.language.javascript-typescript": "JavaScript / TypeScript", "classes.language.go": "Go", "classes.language.java": "Java", "classes.language.rust": "Rust", "classes.language.c": "C", "classes.language.cpp": "C++", "classes.language.markdown": "Markdown", "classes.language.json": "JSON", "classes.language.yaml": "YAML", "classes.language.other": "Other",
      "classes.view": "Relationship view", "classes.tree": "Hierarchy", "classes.graph": "Diagram",
      "classes.treeHint": "←/→ to collapse/expand · Double-click or Enter/F4 to open source",
      "classes.expand": "Expand {name}", "classes.collapse": "Collapse {name}", "classes.reference": "Repeated reference; expand the first occurrence",
      "classes.factoryShort": "Factory", "classes.treeLimited": "Some rows are hidden. Collapse branches to reveal more.", "classes.viewUnsaved": "View changed for this pane; the preference could not be saved.",
      "classes.title": "Class relationships",
      "classes.dock": "Position",
      "classes.right": "Right",
      "classes.bottom": "Bottom",
      "classes.close": "Close class relationships",
      "classes.search": "Find a class",
      "classes.refresh": "Refresh",
      "classes.all": "All classes",
      "classes.zoomOut": "Zoom out",
      "classes.zoomIn": "Zoom in",
      "classes.zoomReset": "Reset zoom",
      "classes.hint": "Source relationships · Double-click a class or click a method to open source · Drag blank space to pan",
      "classes.limited": "Partial graph: scan or display limit reached. Narrow the project or increase the scan limits.",
      "classes.skipped": "Skipped {n} files",
      "classes.empty": "No Python class declarations found.",
      "classes.class": "Class",
      "classes.abc": "ABC base",
      "classes.abstract": "Abstract methods",
      "classes.protocol": "Protocol",
      "classes.open": "Open source",
      "classes.unresolved": "Unresolved base",
      "classes.decorated": "Decorated declaration; runtime behavior may differ",
      "classes.invalid": "Invalid class graph response",
      "classes.failed": "Could not read class relationships: {message}",
      "classes.changed": "Source changed since the scan. Refresh the class graph before navigating.",
      "tree.expand": "Expand directory recursively",
      "tree.collapse": "Collapse directory recursively",
      "tree.copyName": "Copy name",
      "tree.copyRelative": "Copy relative path",
      "tree.copyAbsolute": "Copy absolute path",
      "tree.revealLocal": "Show in file manager",
      "tree.openLocal": "Open in file manager",
      "tree.openLocalFailed": "Could not open this path in the file manager. Check that the workspace is accessible from the Harness desktop.",
      "tree.copied": "Copied: {value}",
      "tree.manualCopy": "Copy path",
      "tree.copyHint": "Clipboard access is unavailable. Press ⌘C / Ctrl+C to copy the selected text.",
      "tree.close": "Close",
      "search.title": "Find",
      "search.invalid": "The search response is invalid.",
      "search.failed": "Search failed: {message}",
      "search.query": "Find text",
      "search.case": "Match case",
      "search.run": "Search",
      "search.scope": "Scope: {path}",
      "search.project": "Entire project",
      "search.count": "{n} matches",
      "search.limited": "Showing partial results. Narrow the scope or use a more specific query.",
      "search.skipped": "Skipped {n} files that cannot be previewed.",
      "search.open": "Open {path} at line {line}",
      "search.empty": "No matches",
      "find.current": "Current match", "find.onLine": "on line",
      "find.label": "Find",
      "find.next": "Next",
      "find.previous": "Previous",
      "find.all": "All",
      "find.case": "Match case",
      "find.regexp": "Regular expression",
      "find.word": "Whole word",
      "find.close": "Close",

      'tools.title': 'Tool windows', 'tools.hide': 'Hide tool window', 'tools.resize': 'Tool window height',
      'preview.original': 'Open original preview',
      'preview.retry': 'Retry',
      "debug.clearBreakpoints": "Remove all breakpoints",
      "debug.evaluate": "Evaluate expression",
      "debug.inspection": "Inspection controls",
      "debug.expression": "Expression",
      "debug.result": "Result",
      "debug.closeEvaluation": "Close evaluation",
      "debug.evaluateHint": "Enter to evaluate · Shift Enter for a new line",
      "debug.evaluateEffects": "Evaluation may call functions and change program state.",
      "debug.invalidExpression": "Enter an expression of 1 to 8192 characters.",
      "debug.evaluateFailed": "Evaluation failed; the expression may have executed. No automatic retry. {message}",

      "debug.next": "Step over", "debug.stepIn": "Step into", "debug.stepOut": "Step out", "debug.pause": "Pause",
      "debug.title": "Debugger",
      "debug.launch": "Start debugging",
      "debug.attach": "Attach to process",
      "debug.stop": "End debugging",
      "debug.breakpoint": "Toggle breakpoint",
      "debug.choose": "Choose debug configuration",
      "debug.openFile": "Open a Python, Go or Node.js entry file; use .dsh/debug.json for custom project arguments.",
      "debug.tsBuild": "Build this TypeScript file with source maps first. For a custom output path, add a launch configuration in .dsh/debug.json.",
      "debug.language": "Language", "debug.kind": "Attach using", "debug.port": "Local debugger port", "debug.pid": "Go process ID",
      "debug.attachPrompt": "Enter to attach · Esc to cancel", "debug.invalidAttach": "Enter a positive process ID or a port from 1 to 65535.",
      "debug.pythonPort": "Use the debugpy listen port, not a Python process ID.",
      "debug.goPort": "Use a Delve DAP server port, or select Go process ID.",
      "debug.nodePort": "Use the Node inspector port (--inspect).",
      "debug.breakpointsFailed": "Could not update all adapter breakpoints. Their state is unverified; apply your changes again. {message}",
      "debug.failed": "Debugging failed: {message}",
      "debug.starting": "Starting",
      "debug.running": "Running",
      "debug.paused": "Paused",
      "debug.ended": "Ended", "debug.unknown": "Outcome unknown — end debugging before retrying",
      "debug.ready": "Not started", "debug.readyHint": "Set a gutter breakpoint, then start debugging.", "debug.endedHint": "Program ended. Start debugging to run it again.",
      "debug.execution": "Execution controls", "debug.stepping": "Stepping controls", "debug.connection": "Attach controls",
      "debug.nextHint": "Step Over: execute the current line without entering the called function.",
      "debug.stepInHint": "Step Into: enter the called function.",
      "debug.stepOutHint": "Step Out: finish this function and return to its caller.",
      "debug.stack": "Call stack",
      "debug.continue": "Resume program", "debug.executionFrame": "Execution frame", "debug.external": "External source",
      "debug.variables": "Variables",
      "debug.output": "Program output",
      "debug.fullPath": "Full path", "debug.noVariables": "No variables in this scope",
      'document.preview': 'Reading preview', 'document.source': 'Source', 'document.mode': 'Document view',
      'document.metadataTags': 'Tags', 'document.metadataKind': 'Type', 'document.metadataSource': 'Source',
      'document.image': 'Image: {alt}', 'document.readOnly': 'Markdown · Read-only', 'document.linkFailed': 'This link cannot be opened inside the workspace.',
      'layout.treeWidth': 'File tree width', 'layout.treeHeight': 'File tree height',
      'layout.classWidth': 'Class diagram width', 'layout.classHeight': 'Class diagram height',
      'layout.resizeHint': 'Drag to resize · Arrow keys to adjust · Double-click or Enter to reset', 'layout.pixels': '{n} pixels',
      'layout.unsaved': 'Size changed for this panel. Browser storage is unavailable, so it cannot be saved.',

      panel: 'Development workbench',
      'guide.description': 'Browse projects, navigate code, inspect Git changes, and debug',
      'log.message': 'Message', 'log.author': 'Author', 'log.date': 'Date', 'log.hash': 'Hash',
      title: 'Development workbench',
      'tabs.files': 'Files',
      'files.empty': 'No files match the filter.',
      'files.source': 'Source', 'files.diff': 'Diff',
      'files.back': 'Back', 'files.forward': 'Forward',
      'files.hint': '⌘/Ctrl+click or F12: definition · Right-click: more actions',
      'files.definition': 'Go to definition',
      'files.goLine': 'Go to line/column',
      'files.fold': 'Fold code', 'files.unfold': 'Unfold code', 'files.foldedCode': 'Folded code',
      'files.foldedLines': 'Folded lines', 'files.unfoldedLines': 'Unfolded lines', 'files.rangeTo': 'to',
      'files.opening': 'Opening {path}…', 'files.openFailed': 'Could not open {path}: {message}',
      'files.openTabs': 'Open files', 'files.closeTab': 'Close {path}',
      'files.tabMenu': 'File tab actions', 'files.tabClose': 'Close', 'files.tabCloseOthers': 'Close other tabs', 'files.tabCloseAll': 'Close all tabs',
      'files.linePrompt': 'Line[:column] · Enter to go · Esc to cancel',
      'files.invalidLine': 'Enter an existing line and column.',
      'files.position': 'Ln {line}, Col {column}',
      'files.readOnly': 'Read-only · UTF-8',
      'files.pick': 'Select a file to read its source.',
      'files.results': 'Choose a definition',
      'files.none': 'No definition found here.',
      'files.external': '{n} definitions have no readable source preview.',
      'files.library': 'Library source · Read-only · UTF-8', 'files.libraryShort': 'Library', 'files.libraryExpired': 'This library reference expired. Navigate from project source again.',
      'files.unavailable': 'No language service is available for this file or execution environment.',
      'files.serverMissing': 'The language server is unavailable. Configure its launch command in the Git plugin settings.',
      'files.serverTimeout': 'Code navigation timed out. Check the project and language-server configuration, or increase the navigation timeout in plugin settings.',
      'files.serverFailed': 'The language server could not complete navigation. Check the project configuration and try again: {message}',
      'files.changed': 'The file changed. Reopen it before navigating.',
      'files.failed': 'Could not navigate: {message}',
      'files.more': 'Showing {shown} of {total} matching files. Refine the filter.',
      'files.read': 'Read source',
      'files.tooLarge': 'Source is larger than 512 KiB.',
      'files.binary': 'This is a binary file; source preview is unavailable.',
      'terminal.interrupt': 'Interrupt', 'terminal.title': 'Terminal', 'terminal.resize': 'Terminal height', 'terminal.close': 'Close terminal', 'terminal.failed': 'Terminal could not connect. Retry or reload the workbench.', 'terminal.retry': 'Retry', 'terminal.connecting': 'Connecting…', 'terminal.control': 'Take control', 'terminal.exited': 'Shell exited. Close this terminal to start another.', 'terminal.unavailable': 'Open the session workspace and enable the official terminal service to use the terminal.',
      'image.preview': 'Image preview', 'image.fit': 'Fit', 'image.actual': 'Actual size',
      'image.zoomIn': 'Zoom in', 'image.zoomOut': 'Zoom out', 'image.dimensions': '{width} × {height} px',
      'image.failed': 'Could not decode this image. Check its format and file contents.',
      'image.tooLarge': 'This image exceeds the preview limit. Adjust imagePreviewMaxBytes in plugin settings.',
      'image.invalid': 'This icon file is damaged or incomplete.',
      'image.icnsUnsupported': 'This ICNS has no embedded PNG. Legacy and JPEG 2000 icon encodings are not supported.',

      'files.notFile': 'This file is missing or is not a regular file. Deleted files can be inspected in Diff.',
      'files.encoding': 'Source preview requires UTF-8 text.',
      'files.outside': 'This file resolves outside the workspace and cannot be opened.',
      'repo.notGit': 'This workspace is not a Git repository.',
      'tabs.changes': 'Changes',
      'tabs.log': 'Log',
      'repo.select': 'Repository',
      'repo.detached': 'detached',
      'repo.ahead': '{ahead} ahead · {behind} behind',
      'group.staged': 'Staged',
      'group.changes': 'Changes',
      'group.unversioned': 'Unversioned Files',
      'filter.placeholder': 'Filter files',
      'review.button.task': 'Assign a task',
      'review.button.explain': 'Explain',
      'review.title.task': 'Assign a change task',
      'review.title.explain': 'Explain it to me',
      'review.note.task': 'Uses the default DeepSeek conversation, with no extra skills or workflows.',
      'review.note.explain': 'Uses the default DeepSeek conversation and saves the explanation as one memory card.',
      'review.placeholder.task': 'Describe the fix or feature change to make in this project…',
      'review.placeholder.explain': 'What do you want to understand?',
      'review.send': 'Send',
      'review.cancel': 'Cancel',
      'review.sent': 'New conversation created ✓',
      'review.error': 'Failed to send: {message}',
      'review.admission': 'The conversation was created. Check its messages before sending again.',
      'review.code.added': '{n} lines selected',
      'review.code.clear': 'Clear',
      'review.code.hint': 'Click diff lines to include them',
      'cards.title': 'Memory cards',
      'cards.filter': 'Search questions, tags, or sources',
      'cards.general': 'General', 'cards.uncategorized': 'Uncategorized',
      'cards.refresh': 'Refresh memory cards',
      'cards.dir': 'Cards folder: {dir}',
      'cards.loading': 'Loading memory cards…',
      'cards.empty': 'No memory cards yet. Ask “Explain it to me” to create cards in this folder.',
      'cards.noMatch': 'No memory cards match the filter.',
      'cards.error': 'Could not load memory cards: {message}',
      'cards.open': 'Open card',
      'cards.back': 'Back to cards',
      'cards.skipped': 'Skipped {n} cards',
      'cards.truncated': 'Showing the first {n} cards',
      'cards.detailError': 'Could not read this card: {message}',
      'diff.select': 'Select a file to view its changes.',
      'diff.staged': 'Staged changes',
      'diff.unstaged': 'Uncommitted changes',
      'diff.both': 'Staged + working-tree changes',
      'diff.untracked': 'Unversioned file',
      'diff.empty': 'No changes in this file.',
      'diff.binary': 'Binary file — diff unavailable.',
      'log.empty': 'No commits yet',
      'log.detail': 'Commit',
      'log.files': '{n} files changed',
      'log.parents': '{n} parents',
      'loading': 'Loading…',
      'changes.limited': 'Showing {shown} of {total} changes',
      'error.load': 'Could not load repository state: {message}',
      'status.a': 'Added',
      'status.m': 'Modified',
      'status.d': 'Deleted',
      'status.r': 'Renamed',
      'status.c': 'Copied',
      'status.u': 'Unmerged',
      'status.untracked': 'Untracked',
    };
    const zh = {
      'debug.inspect': '查看变量值', 'debug.hoverMissing': '当前栈帧未提供此变量', 'debug.hoverLimited': '已达到变量读取上限，请使用计算表达式', 'debug.hoverInvalid': '变量响应无效', 'debug.hoverFailed': '无法读取此变量：{message}',
      'debug.typeDefinition': '跳转到源码类型定义', 'debug.typeMissing': '未找到源码中的类型定义',
      "tree.locate": "定位当前文件",
      "tree.findName": "按文件名查找",
      "tree.findFile": "在文件中查找",
      "tree.findDirectory": "在目录中查找内容",
      "classes.inherits": "继承", "classes.protocolBase": "显式 Protocol 基类", "classes.abstractHint": "斜体：抽象方法",
      "classes.factory": "工厂返回关联", "classes.factoryHint": "依据工厂返回注解关联 · 不代表已通过协议兼容性检查",
      "classes.evidence": "工厂返回关联依据", "classes.fit": "适应面板",
      "classes.languageTitle": "{language} 类关系", "classes.beta": "Beta", "classes.betaHint": "Python 类关系分析目前为 Beta。",
      "classes.unsupportedFile": "当前为 {language} 文件，类关系暂不支持此类型。目前仅支持 Python（.py／.pyi），处于 Beta 阶段。",
      "classes.unsupportedProject": "当前项目识别为 {language}，类关系暂未支持。目前仅支持 Python，处于 Beta 阶段。",
      "classes.mixedUnsupported": "检测到多语言项目，请选择 Python 文件查看类关系（Beta）。",
      "classes.externalUnsupported": "库源码可以阅读，暂不支持库文件的类关系分析。请选择工作区内的 Python 文件（Beta）。",
      "classes.choosePython": "请选择 Python 文件或打开 Python 项目，以查看类关系（Beta）。", "classes.detecting": "正在识别项目文件类型…",
      "classes.language.python": "Python", "classes.language.javascript": "JavaScript", "classes.language.typescript": "TypeScript", "classes.language.javascript-typescript": "JavaScript / TypeScript", "classes.language.go": "Go", "classes.language.java": "Java", "classes.language.rust": "Rust", "classes.language.c": "C", "classes.language.cpp": "C++", "classes.language.markdown": "Markdown", "classes.language.json": "JSON", "classes.language.yaml": "YAML", "classes.language.other": "其他",
      "classes.view": "关系展示方式", "classes.tree": "层级树", "classes.graph": "关系图",
      "classes.treeHint": "←/→ 折叠展开 · 双击或 Enter/F4 阅读源码",
      "classes.expand": "展开 {name}", "classes.collapse": "折叠 {name}", "classes.reference": "重复引用，展开见首次出现的位置",
      "classes.factoryShort": "工厂关联", "classes.treeLimited": "部分行未显示，请折叠分支后继续查看。", "classes.viewUnsaved": "已切换当前视图，但偏好未能保存。",
      "classes.title": "类关系",
      "classes.dock": "位置",
      "classes.right": "右侧",
      "classes.bottom": "底部",
      "classes.close": "关闭类关系图",
      "classes.search": "查找类",
      "classes.refresh": "刷新",
      "classes.all": "全部类",
      "classes.zoomOut": "缩小",
      "classes.zoomIn": "放大",
      "classes.zoomReset": "重置缩放",
      "classes.hint": "源码关系 · 双击类或点击方法跳转源码 · 拖动空白处平移",
      "classes.limited": "当前为部分关系图：已达到扫描或显示上限，可缩小项目范围或调整扫描配置。",
      "classes.skipped": "已跳过 {n} 个文件",
      "classes.empty": "未找到 Python 类声明。",
      "classes.class": "类",
      "classes.abc": "ABC 基类",
      "classes.abstract": "抽象方法",
      "classes.protocol": "Protocol",
      "classes.open": "打开源码",
      "classes.unresolved": "未解析基类",
      "classes.decorated": "含类装饰器，运行时行为可能不同",
      "classes.invalid": "类关系响应无效",
      "classes.failed": "无法读取类关系：{message}",
      "classes.changed": "源码在扫描后发生了变化，请刷新类关系图再跳转。",
      "tree.expand": "展开此目录及子目录",
      "tree.collapse": "收起此目录及子目录",
      "tree.copyName": "复制名称",
      "tree.copyRelative": "复制相对路径",
      "tree.copyAbsolute": "复制绝对路径",
      "tree.revealLocal": "在文件管理器中显示",
      "tree.openLocal": "在文件管理器中打开",
      "tree.openLocalFailed": "无法在文件管理器中打开此路径。请确认 Harness 桌面端可以访问该工作区。",
      "tree.copied": "已复制：{value}",
      "tree.manualCopy": "复制路径",
      "tree.copyHint": "无法访问剪贴板，请按 ⌘C / Ctrl+C 复制已选中的文本。",
      "tree.close": "关闭",
      "search.title": "查找",
      "search.invalid": "搜索响应无效。",
      "search.failed": "查找失败：{message}",
      "search.query": "查找内容",
      "search.case": "区分大小写",
      "search.run": "查找",
      "search.scope": "范围：{path}",
      "search.project": "整个项目",
      "search.count": "{n} 条匹配",
      "search.limited": "仅显示部分结果，请缩小范围或使用更具体的关键词。",
      "search.skipped": "略过 {n} 个无法预览的文件。",
      "search.open": "打开 {path} 第 {line} 行",
      "search.empty": "没有匹配内容",
      "find.current": "当前匹配", "find.onLine": "所在行",
      "find.label": "查找",
      "find.next": "下一个",
      "find.previous": "上一个",
      "find.all": "全部",
      "find.case": "区分大小写",
      "find.regexp": "正则表达式",
      "find.word": "全字匹配",
      "find.close": "关闭",

      'tools.title': '工具窗口', 'tools.hide': '收起工具窗口', 'tools.resize': '工具窗口高度',
      'preview.original': '打开原预览',
      'preview.retry': '重试',
      "debug.clearBreakpoints": "清理全部断点",
      "debug.evaluate": "计算表达式",
      "debug.inspection": "检查操作",
      "debug.expression": "表达式",
      "debug.result": "计算结果",
      "debug.closeEvaluation": "关闭表达式求值",
      "debug.evaluateHint": "Enter 计算 · Shift Enter 换行",
      "debug.evaluateEffects": "求值可能调用函数并改变程序状态。",
      "debug.invalidExpression": "请输入 1～8192 个字符的表达式。",
      "debug.evaluateFailed": "求值失败，表达式可能已执行；未自动重试。{message}",

      "debug.next": "单步跳过", "debug.stepIn": "单步进入", "debug.stepOut": "跳出", "debug.pause": "暂停",
      "debug.title": "调试",
      "debug.launch": "启动调试",
      "debug.attach": "接入已有进程",
      "debug.stop": "结束调试",
      "debug.breakpoint": "切换断点",
      "debug.choose": "选择调试配置",
      "debug.openFile": "请先打开 Python、Go 或 Node.js 入口文件；项目自定义参数可写入 .dsh/debug.json",
      "debug.tsBuild": "请先生成该 TypeScript 文件的 JS 和 source map；输出路径较复杂时，可在 .dsh/debug.json 中配置启动入口",
      "debug.language": "语言", "debug.kind": "接入方式", "debug.port": "本机调试端口", "debug.pid": "Go 进程 ID",
      "debug.attachPrompt": "Enter 接入 · Esc 取消", "debug.invalidAttach": "请输入正整数进程 ID，或 1～65535 的端口",
      "debug.pythonPort": "填写 debugpy 的监听端口，不能直接填写 Python 进程 ID",
      "debug.goPort": "填写 Delve DAP 服务端口，或切换为 Go 进程 ID",
      "debug.nodePort": "填写 Node inspector（--inspect）的监听端口",
      "debug.breakpointsFailed": "未能更新全部调试器断点，实际状态尚未确认；请重新应用断点。{message}",
      "debug.failed": "调试失败：{message}",
      "debug.starting": "正在启动",
      "debug.running": "运行中",
      "debug.paused": "已暂停",
      "debug.ended": "已结束", "debug.unknown": "执行结果不明确，请结束调试后重试",
      "debug.ready": "未启动", "debug.readyHint": "点击行号旁设置断点，再启动调试", "debug.endedHint": "程序已结束，可点击上方启动调试重新运行",
      "debug.execution": "运行控制", "debug.stepping": "单步控制", "debug.connection": "进程接入",
      "debug.nextHint": "Step Over：执行当前行，不进入被调用函数",
      "debug.stepInHint": "Step Into：进入被调用函数",
      "debug.stepOutHint": "Step Out：执行完当前函数，返回调用处",
      "debug.stack": "调用栈",
      "debug.continue": "继续运行", "debug.executionFrame": "当前执行帧", "debug.external": "工作区外源码",
      "debug.variables": "变量",
      "debug.output": "程序输出",
      "debug.fullPath": "完整路径", "debug.noVariables": "此作用域没有变量",
      'document.preview': '阅读预览', 'document.source': '源码', 'document.mode': '文档视图',
      'document.metadataTags': '标签', 'document.metadataKind': '类型', 'document.metadataSource': '来源',
      'document.image': '图片：{alt}', 'document.readOnly': 'Markdown · 只读', 'document.linkFailed': '无法在当前工作区内打开此链接',
      'layout.treeWidth': '文件树宽度', 'layout.treeHeight': '文件树高度',
      'layout.classWidth': '类图宽度', 'layout.classHeight': '类图高度',
      'layout.resizeHint': '拖动调整尺寸 · 方向键微调 · 双击或 Enter 恢复默认', 'layout.pixels': '{n} 像素',
      'layout.unsaved': '尺寸已调整，但浏览器存储不可用，仅对本次面板生效',

      panel: '开发工作台',
      'guide.description': '浏览项目、跳转代码、查看 Git 变更并调试程序',
      'log.message': '提交说明', 'log.author': '作者', 'log.date': '日期', 'log.hash': '提交号',
      title: '开发工作台',
      'tabs.files': '文件',
      'files.empty': '没有匹配的文件。',
      'files.source': '源码', 'files.diff': '差异',
      'files.back': '后退', 'files.forward': '前进',
      'files.hint': '⌘/Ctrl＋点击或 F12 跳到定义；右键查看更多操作',
      'files.definition': '跳转到定义',
      'files.goLine': '跳转到行／列',
      'files.fold': '折叠代码', 'files.unfold': '展开代码', 'files.foldedCode': '已折叠的代码',
      'files.foldedLines': '已折叠行', 'files.unfoldedLines': '已展开行', 'files.rangeTo': '至',
      'files.opening': '正在打开 {path}…', 'files.openFailed': '无法打开 {path}：{message}',
      'files.openTabs': '已打开文件', 'files.closeTab': '关闭 {path}',
      'files.tabMenu': '文件标签操作', 'files.tabClose': '关闭', 'files.tabCloseOthers': '关闭其他标签', 'files.tabCloseAll': '关闭全部标签',
      'files.linePrompt': '行号[:列号] · Enter 跳转 · Esc 取消',
      'files.invalidLine': '请输入文件中存在的行号和列号',
      'files.position': '行 {line}，列 {column}',
      'files.readOnly': '只读 · UTF-8',
      'files.pick': '选择文件以阅读源码。',
      'files.results': '选择一个定义',
      'files.none': '这里没有找到定义。',
      'files.external': '有 {n} 个定义暂未提供可读的源码预览。',
      'files.library': '库源码 · 只读 · UTF-8', 'files.libraryShort': '库', 'files.libraryExpired': '库源码引用已过期，请重新从项目代码跳转。',
      'files.unavailable': '这个文件或运行环境尚无可用的语言服务',
      'files.serverMissing': '语言服务尚未就绪，请在 Git 插件设置中配置对应的启动命令',
      'files.serverTimeout': '代码导航超时，请检查项目与语言服务配置，或在插件设置中增加等待时间',
      'files.serverFailed': '语言服务未能完成跳转，请检查项目配置后重试：{message}',
      'files.changed': '文件已变化，请重新打开后再跳转。',
      'files.failed': '跳转失败：{message}',
      'files.more': '显示 {shown} / {total} 个匹配文件，请缩小过滤范围。',
      'files.read': '阅读源码',
      'files.tooLarge': '源码超过 512 KiB，无法在此预览。',
      'files.binary': '这是二进制文件，无法预览源码。',
      'terminal.interrupt': '中断', 'terminal.title': '终端', 'terminal.resize': '终端高度', 'terminal.close': '关闭终端', 'terminal.failed': '终端连接失败，请重试或重新加载工作台', 'terminal.retry': '重试', 'terminal.connecting': '正在连接…', 'terminal.control': '接管输入', 'terminal.exited': 'Shell 已退出，关闭后可重新启动终端', 'terminal.unavailable': '请打开当前会话的工作区，并启用官方终端服务',
      'image.preview': '图片预览', 'image.fit': '适应窗口', 'image.actual': '原始大小',
      'image.zoomIn': '放大', 'image.zoomOut': '缩小', 'image.dimensions': '{width} × {height} 像素',
      'image.failed': '无法解码图片，请检查文件格式和内容',
      'image.tooLarge': '图片超过预览上限，可在插件设置中调整 imagePreviewMaxBytes',
      'image.invalid': '图标文件损坏或不完整',
      'image.icnsUnsupported': '这个 ICNS 没有内嵌 PNG，暂不支持旧式或 JPEG 2000 图标编码',

      'files.notFile': '文件不存在或不是普通文件；已删除文件可切到“差异”查看。',
      'files.encoding': '源码预览只支持 UTF-8 文本。',
      'files.outside': '这个文件的实际位置在工作区外，无法打开。',
      'repo.notGit': '当前工作区不是 Git 仓库。',
      'tabs.changes': '变更',
      'tabs.log': '历史',
      'repo.select': '仓库',
      'repo.detached': '游离 HEAD',
      'repo.ahead': '领先 {ahead} · 落后 {behind}',
      'group.staged': '已暂存',
      'group.changes': '工作区变更',
      'group.unversioned': '未跟踪文件',
      'filter.placeholder': '过滤文件',
      'review.button.task': '分配修改任务',
      'review.button.explain': '讲给我听',
      'review.title.task': '分配修改任务',
      'review.title.explain': '讲给我听',
      'review.note.task': '默认 DeepSeek 会话，不附加技能或工作流',
      'review.note.explain': '使用默认 DeepSeek 会话，完整讲解保存为一张记忆卡片',
      'review.placeholder.task': '描述要完成的修复或功能改动…',
      'review.placeholder.explain': '想弄懂哪件事或哪段原理？',
      'review.send': '发送',
      'review.cancel': '取消',
      'review.sent': '已创建新对话 ✓',
      'review.error': '发送失败：{message}',
      'review.admission': '对话已创建，请先检查其中的消息，再决定是否重发。',
      'review.code.added': '已选择 {n} 行代码',
      'review.code.clear': '清空',
      'review.code.hint': '点击 diff 中的行可加入消息',
      'cards.title': '记忆卡片',
      'cards.filter': '搜索问题、标签或来源',
      'cards.general': '通用', 'cards.uncategorized': '未归类',
      'cards.refresh': '刷新记忆卡片',
      'cards.dir': '卡片目录：{dir}',
      'cards.loading': '正在读取记忆卡片…',
      'cards.empty': '还没有记忆卡片。在「讲给我听」会话中讲解后，卡片会出现在这里。',
      'cards.noMatch': '没有匹配筛选条件的卡片。',
      'cards.error': '读取记忆卡片失败：{message}',
      'cards.open': '打开卡片',
      'cards.back': '返回卡片列表',
      'cards.skipped': '跳过 {n} 张卡片',
      'cards.truncated': '仅显示前 {n} 张卡片',
      'cards.detailError': '读取卡片失败：{message}',
      'diff.select': '选择文件以查看其变更。',
      'diff.staged': '暂存区变更',
      'diff.unstaged': '未提交变更',
      'diff.both': '暂存 + 工作区变更',
      'diff.untracked': '未版本化文件',
      'diff.empty': '该文件没有差异。',
      'diff.binary': '二进制文件 —— 无法显示差异。',
      'log.empty': '还没有提交',
      'log.detail': '提交',
      'log.files': '共 {n} 个文件变更',
      'log.parents': '{n} 个父提交',
      'loading': '加载中……',
      'changes.limited': '仅显示 {shown} / {total} 项变更',
      'error.load': '无法加载仓库状态：{message}',
      'status.a': '新增',
      'status.m': '修改',
      'status.d': '删除',
      'status.r': '重命名',
      'status.c': '复制',
      'status.u': '冲突未合并',
      'status.untracked': '未跟踪',
    };

    // ------------------------------------------------------------- css
    const css = `
.jb-root{container-type:inline-size;container-name:git-panel;box-sizing:border-box;flex:1;width:100%;min-width:0;height:100%;max-height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:${C.bg};color:${C.text};font-size:13px;line-height:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif}
.jb-toolbar{flex:none;display:flex;align-items:center;gap:10px;height:38px;padding:0 10px;background:${C.toolbar};border-bottom:1px solid ${C.border}}
.jb-toolbar .jb-selectwrap{position:relative;display:inline-flex;align-items:center;gap:6px;min-width:0}
.jb-toolbar svg.jb-tool-icon{flex:none;color:${C.text}}
.jb-select{box-sizing:border-box;height:26px;min-width:110px;max-width:220px;color:${C.text};background:${C.toolbar};border:1px solid ${C.border};border-radius:4px;font:inherit;font-size:12.5px;line-height:20px;padding:0 22px 0 8px;outline:none;cursor:pointer;appearance:none}
.jb-selectwrap:after{content:"";position:absolute;right:8px;top:calc(50% - 4px);width:5px;height:5px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);pointer-events:none}
.jb-select:hover{border-color:${C.accent}}
.jb-select:focus{border-color:${C.accent}}
.jb-tb-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;border-radius:4px;background:transparent;color:${C.text};cursor:pointer;padding:0}
.jb-tb-btn:hover:not(:disabled){background:${C.hover}}
.jb-tb-btn:disabled{opacity:.45;cursor:default}
.jb-tb-btn svg{width:15px;height:15px}
.jb-branchinfo{display:inline-flex;align-items:center;gap:8px;min-width:0}
.jb-branchchip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 10px;border-radius:12px;background:${C.gutter};border:1px solid ${C.border};color:${C.text};font-size:12.5px;font-weight:500;white-space:nowrap}
.jb-branchchip svg{width:13px;height:13px;color:${C.modified}}
.jb-headchip{color:${C.textDim};font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap}
.jb-spacer{flex:1}

.jb-tools-bar{display:flex;align-items:center;gap:4px;flex:none;min-height:34px;padding:0 8px;background:${C.toolbar};border-top:1px solid ${C.border}}
.jb-tool-toggle{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:30px;border:0;border-radius:4px;background:transparent;color:${C.textDim};cursor:pointer;padding:0}
.jb-tool-toggle svg{width:18px;height:18px}
.jb-tool-toggle[aria-pressed=true]{color:${C.accent};background:${C.selection}}
.jb-tool-toggle[aria-pressed=true]:after{position:absolute;content:"";height:2px;left:6px;right:6px;bottom:0;background:${C.accent}}
.jb-tool-toggle:hover:not(:disabled){color:${C.text};background:${C.hover}}
.jb-tool-toggle:disabled{opacity:.4;cursor:default}
.jb-tool-toggle:focus-visible,.jb-tools-divider:focus-visible{outline:2px solid ${C.accent};outline-offset:-2px}
.jb-tools-window{position:relative;display:flex;flex-direction:column;flex:0 0 auto;min-height:120px;max-height:60%;min-width:0;background:${C.panel};border-top:1px solid ${C.border}}
.jb-tools-window[hidden],.jb-tool-panel[hidden]{display:none}
.jb-tools-header{display:flex;align-items:center;justify-content:space-between;flex:none;min-height:28px;padding:0 8px 0 12px;border-bottom:1px solid ${C.border};font-size:12px}
.jb-tool-panel{display:flex;flex:1;min-width:0;min-height:0;overflow:hidden}
.jb-tool-panel>.jb-changes,.jb-tool-panel>.jb-log{min-height:0;flex:1}
.jb-tool-panel .jb-debug-sections{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:0 8px;align-items:start}
.jb-tool-panel .jb-debug-section{max-height:100%;overflow:auto;margin-top:0}
.jb-tools-divider{position:absolute;top:-4px;left:0;right:0;height:7px;cursor:row-resize;touch-action:none;z-index:3}
.jb-tools-divider:hover{background:${C.hover}}
.jb-tools-notice{padding:4px 8px;border-top:1px solid ${C.border};color:${C.text};font-size:12px}
.jb-content{position:relative;flex:1;min-height:0;display:flex}
.jb-browser-seat{flex:1;min-width:0;min-height:0;display:flex;overflow:hidden}
.jb-filebutton{box-sizing:border-box;width:100%;border:0;background:transparent;color:inherit;font:inherit;text-align:left}
.jb-filebutton:focus-visible{outline:2px solid ${C.accent};outline-offset:-2px}
.jb-editor-title{display:flex;align-items:center;gap:8px;padding:6px 12px;background:${C.gutter};border-bottom:1px solid ${C.border};flex:none;min-height:24px}
.jb-source-tabs{display:flex;flex:none;min-height:32px;max-width:100%;overflow-x:auto;background:${C.gutter};border-bottom:1px solid ${C.border}}
.jb-source-tabs:empty{display:none}
.jb-source-tab{display:flex;flex:none;align-items:center;max-width:260px;border-right:1px solid ${C.border};border-bottom:2px solid transparent}
.jb-source-tab[data-active=true]{background:${C.bg};border-bottom-color:${C.accent}}
.jb-source-tab [role=tab]{display:flex;align-items:center;gap:6px;min-width:0;min-height:30px;padding:4px 6px 4px 10px;border:0;background:transparent;color:${C.text};font:inherit;font-size:12px;white-space:nowrap;cursor:default}
.jb-source-tab [role=tab] span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.jb-source-tab svg{flex:none}
.jb-source-tab-close{flex:none;display:flex;align-items:center;justify-content:center;width:24px;height:26px;padding:0;margin-right:3px;border:0;border-radius:3px;background:transparent;color:${C.textDim};font:inherit;font-size:16px;cursor:default}
.jb-source-tab button:focus-visible{outline:2px solid ${C.accent};outline-offset:-2px}
.jb-source-panel{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column}
@media(hover:hover){.jb-source-tab-close:hover{background:${C.hover};color:${C.text}}}
.jb-debug-pane{box-sizing:border-box;display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;max-width:none;overflow:auto;background:${C.panel};color:${C.text};padding:8px;font-size:13px;line-height:20px}
.jb-debug-pane pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:8px;font:12px/20px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:${C.code};user-select:text}
.jb-debug-pane summary{cursor:default;padding:3px 8px}
.jb-debug-topbar{display:flex;flex:none;flex-wrap:wrap;align-items:center;gap:4px 12px;margin-bottom:8px}
.jb-debug-sections{min-height:0;flex:1;overflow:auto}
.jb-debug-section{min-width:0;border-top:1px solid ${C.border};margin-top:4px}
.jb-debug-section>summary{position:sticky;top:0;z-index:1;background:${C.toolbar};font-weight:500;min-height:24px}
.jb-debug-count{margin-left:8px;font-weight:400;color:${C.textDim};font-size:12px}
.jb-debug-placeholder{padding:4px 8px;color:${C.textDim};font:12px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.jb-debug-toolbar{position:sticky;top:-8px;z-index:2;display:flex;flex:none;flex-wrap:wrap;align-items:center;gap:2px;margin:-8px -8px 8px;padding:6px 8px;background:${C.panel};border-bottom:1px solid ${C.border}}
.jb-debug-action-group{display:flex;flex:none;align-items:center;gap:2px}
.jb-debug-action-group+.jb-debug-action-group{border-left:1px solid ${C.border};margin-left:5px;padding-left:5px}
.jb-debug-action{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:26px;min-height:28px;padding:4px;border:0;border-radius:4px;background:transparent;color:${C.text};font:inherit;cursor:default;white-space:nowrap}
.jb-debug-action svg{flex:none}
.jb-debug-action[data-action=run]{color:${C.added};padding:4px 6px}
.jb-debug-action[data-action=stop]{color:${C.deleted}}
.jb-debug-action:disabled{opacity:.4}
.jb-debug-action:focus-visible{outline:2px solid ${C.accent};outline-offset:-2px}
.jb-debug-hint{padding:3px 0 8px;color:${C.textDim};overflow-wrap:anywhere}
@media(hover:hover){.jb-debug-action:hover:not(:disabled){background:${C.hover}}}
.jb-debug-heading{display:flex;flex:1 1 140px;min-width:0;align-items:baseline;gap:8px;font-weight:500}
.jb-debug-heading>span:last-child{flex:none}
.jb-debug-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jb-debug-state{font-size:12px;font-weight:400;color:${C.textDim}}
.jb-debug-state[data-state=paused]{color:${C.accent}}
.jb-stack-list{outline:none;max-height:240px;overflow:auto;margin:4px 0}
.jb-stack-frame{display:flex;align-items:center;gap:6px;min-height:30px;padding:0 8px;white-space:nowrap;cursor:default;user-select:none}
.jb-stack-frame[aria-selected=true]{background:${C.selection};color:${C.text}}
.jb-stack-list:focus-visible .jb-stack-frame[aria-selected=true]{outline:1px solid ${C.accent};outline-offset:-1px}
.jb-stack-marker{flex:none;width:12px;color:${C.accent};font-size:10px}
.jb-stack-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.jb-stack-file{flex:none;max-width:55%;overflow:hidden;text-overflow:ellipsis;text-align:right;color:${C.textDim};font-size:12px}
.jb-stack-location{padding:4px 8px 8px;border-top:1px solid ${C.border};font-size:12px}
.jb-stack-location-file{display:block;white-space:nowrap;overflow:auto;color:${C.text}}
.jb-stack-path{color:${C.textDim}}
.jb-stack-path>summary{padding:0}
.jb-stack-path>div{overflow-wrap:anywhere;user-select:text}
.jb-debug-variables{padding:4px 0;overflow-wrap:anywhere}
.jb-variable-list{list-style:none;padding:0 0 0 16px;margin:0;font:12px/22px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.jb-variable-branch>summary{padding:2px 8px}
.jb-variable-list .jb-variable-branch>summary{padding:2px 8px 2px 0}
.jb-variable-leaf{padding:2px 8px 2px 17px}
.jb-variable-row{display:inline-grid;grid-template-columns:minmax(0,40%) auto minmax(0,1fr);gap:0 4px;align-items:baseline;width:calc(100% - 18px);vertical-align:top}
.jb-variable-leaf>.jb-variable-row{width:100%}
.jb-variable-label{min-width:0;overflow-wrap:anywhere}
.jb-variable-name{color:${C.text}}
.jb-variable-type{display:block;color:${C.textDim};font:11px/16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.jb-variable-type-link{border:0;background:transparent;padding:0;text-align:left;color:${C.modified};cursor:pointer;overflow-wrap:anywhere}
.jb-variable-type-link:hover,.jb-variable-type-link:focus-visible{text-decoration:underline}
.jb-variable-separator{color:${C.textDim}}
.jb-variable-value{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;color:${C.code};user-select:text}
.jb-variable-value[data-kind=string]{color:${C.syntax.string}}
.jb-variable-value[data-kind=number],.jb-variable-value[data-kind=constant]{color:${C.syntax.number}}
@media(hover:hover){.jb-stack-frame:hover:not([aria-selected=true]){background:${C.hover}}}
.jb-sourcebody{flex:1;min-height:0;overflow:hidden}
.jb-sourcebody[hidden]{display:none}
.jb-terminal{flex:1;min-height:0;background:${C.bg};display:flex;flex-direction:column;min-width:0}
.jb-terminal-bar{display:flex;align-items:center;gap:10px;min-height:34px;padding:0 12px;background:${C.panel};flex:none}
.jb-terminal-bar button,.jb-terminal-notice button{background:none;border:0;color:${C.textDim};font:inherit;padding:4px 6px;cursor:pointer;border-radius:4px}
.jb-terminal-bar button:hover{background:${C.hover};color:${C.text}}
.jb-terminal-bar button:focus-visible{outline:2px solid ${C.accent};outline-offset:-2px}
.jb-terminal-bar button:disabled{opacity:.45;cursor:default}
.jb-terminal-path{color:${C.textDim};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.jb-terminal-screen{flex:1;min-height:0;min-width:0;padding:8px 12px;background:${C.bg};color:${C.text};overflow:hidden}
.jb-terminal-screen[hidden]{display:none}
.jb-terminal-emulator{height:100%;width:100%}
.jb-terminal-notice{padding:4px 12px;color:${C.textDim};font:inherit;background:${C.panel};flex:none}
.jb-image-reader{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column}
.jb-image-reader>.jb-document-toolbar{flex-wrap:wrap}
.jb-image-stage{flex:1;min-height:0;min-width:0;overflow:auto;outline:none;background:${C.bg}}
.jb-image-stage:focus-visible{outline:2px solid ${C.accent};outline-offset:-2px}
.jb-image-canvas{display:flex;min-width:100%;min-height:100%;width:max-content;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.jb-image-stage[data-fit=true] .jb-image-canvas{width:100%;height:100%}
.jb-image-stage img{display:block;flex:none;background-color:${C.bg};background-image:conic-gradient(${C.hover} 25%,transparent 0 50%,${C.hover} 0 75%,transparent 0);background-size:16px 16px;box-shadow:0 0 0 1px ${C.border};object-fit:contain}
.jb-image-stage[data-fit=true] img{max-width:100%;max-height:100%}
.jb-image-meta{margin-left:auto;color:${C.textDim};white-space:nowrap}
.jb-document-toolbar{display:flex;flex:none;align-items:center;gap:4px;padding:4px 10px;border-bottom:1px solid ${C.border};background:${C.panel}}
.jb-document-toolbar button{border:0;border-radius:4px;background:transparent;color:${C.textDim};padding:3px 8px;font:inherit;cursor:default;min-height:28px}
.jb-document-toolbar button[aria-pressed=true]{background:${C.selection};color:${C.text}}
.jb-document-toolbar button:focus-visible,.jb-document:focus-visible{outline:2px solid ${C.accent};outline-offset:-2px}
.jb-document-toolbar button:disabled{opacity:.4}
.jb-document-wrap{display:flex;flex:1;min-height:0;min-width:0;flex-direction:column}
.jb-document-seat{display:flex;flex:1;min-height:0;min-width:0}
.jb-document-seat[hidden]{display:none}
.jb-document-error{flex:none;padding:6px 16px;background:${C.toolbar};color:${C.text};overflow-wrap:anywhere}
.jb-document{box-sizing:border-box;flex:1;min-height:0;overflow:auto;padding:20px clamp(16px,3%,36px) 40px;color:${C.text};background:${C.bg};font-size:14px;line-height:1.8;overflow-wrap:anywhere;user-select:text}
.jb-document>:first-child,.jb-document-body>:first-child{margin-top:0}
.jb-document-metadata{margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid ${C.border}}
.jb-document .jb-document-metadata h1{margin:0 0 8px;padding:0;border:0}
.jb-document-metadata .jb-card-tag{white-space:normal}
.jb-document-metadata dl{display:grid;gap:2px;margin:8px 0 0;font-size:12px}
.jb-document-metadata dl>div{display:flex;flex-wrap:wrap;gap:0 12px}
.jb-document-metadata dt{min-width:3em;color:${C.textDim}}
.jb-document-metadata dd{min-width:0;margin:0;white-space:pre-wrap}
.jb-document p{margin:0 0 14px}
.jb-document h1,.jb-document h2,.jb-document h3,.jb-document h4,.jb-document h5,.jb-document h6{font-weight:500;line-height:1.5;margin:24px 0 12px;scroll-margin-top:16px}
.jb-document h1{font-size:24px;padding-bottom:10px;border-bottom:1px solid ${C.border}}
.jb-document h2{font-size:20px;padding-bottom:6px;border-bottom:1px solid ${C.border}}
.jb-document h3{font-size:16px}
.jb-document h4,.jb-document h5,.jb-document h6{font-size:14px}
.jb-document strong,.jb-document th{font-weight:500}
.jb-document a{color:${C.modified};text-decoration:underline;text-underline-offset:3px}
.jb-document ul,.jb-document ol{padding-left:24px;margin:0 0 14px}
.jb-document li{margin:3px 0}
.jb-document li>p{margin-bottom:6px}
.jb-document blockquote{margin:14px 0;padding:4px 14px;border-left:3px solid ${C.accent};color:${C.textDim};background:${C.panel}}
.jb-document blockquote>:last-child{margin-bottom:0}
.jb-document hr{border:0;border-top:1px solid ${C.border};margin:24px 0}
.jb-document code{font:12.5px/1.8 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:${C.panel};color:${C.code};border-radius:3px;padding:2px 5px}
.jb-document-codeblock{margin:14px 0;border:1px solid ${C.border};border-radius:6px;overflow:hidden;background:${C.panel}}
.jb-document-language{padding:4px 12px;background:${C.gutter};color:${C.textDim};border-bottom:1px solid ${C.border};font-size:12px;line-height:20px}
.jb-document pre{margin:0;padding:12px;overflow:auto;white-space:pre;overflow-wrap:normal}
.jb-document pre code{padding:0;border-radius:0;background:transparent}
.jb-document table{display:block;max-width:100%;width:max-content;overflow:auto;border-collapse:collapse;margin:14px 0;font-size:13px}
.jb-document th,.jb-document td{padding:7px 12px;border:1px solid ${C.border};vertical-align:top}
.jb-document th{background:${C.toolbar};text-align:left}
.jb-document tbody tr:nth-child(even){background:${C.panel}}
.jb-document-image{display:inline-block;padding:4px 8px;border:1px solid ${C.border};border-radius:4px;color:${C.textDim}}
.jb-document-checkbox{color:${C.accent}}
.jb-document ::selection{background:${C.textSelection};color:${C.code}}
${Object.entries(C.syntax).map(([role,color]) => '.jb-document .jb-syntax-' + role + '{color:' + color + '}').join('\n')}
.jb-editor-status{flex:none;display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;padding:2px 10px;border-top:1px solid ${C.border};font-size:12px;color:${C.text}}
.jb-editor-popup{box-sizing:border-box;position:fixed;z-index:10000;width:280px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;background:${C.toolbar};border:0;border-radius:5px;padding:4px;box-shadow:var(--dsw-elevation-panel);color:${C.text};font:13px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.jb-editor-popup [role=menuitem]{display:flex;width:100%;justify-content:space-between;gap:18px;box-sizing:border-box;border:0;border-radius:3px;background:transparent;color:inherit;font:inherit;text-align:left;padding:5px 8px;cursor:default}
.jb-editor-popup [role=menuitem]:focus-visible{outline:none;background:${C.selection}}
.jb-editor-popup [role=menuitem]:disabled{opacity:.45}
.jb-editor-popup kbd{font:inherit;white-space:nowrap;color:inherit}
.cm-tooltip-hover:has(>.jb-debug-hover){background:${C.panel};color:${C.text};border:1px solid ${C.border};border-radius:5px;overflow:hidden;z-index:10000}
.jb-debug-hover{width:max-content;min-width:min(240px,calc(100vw - 24px));max-width:min(460px,calc(100vw - 24px));font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;user-select:text}
.jb-debug-hover-body{padding:8px 10px;max-height:min(400px,60vh);overflow:auto;box-sizing:border-box}
.jb-debug-hover-frame{color:${C.textDim};font-size:11px;border-bottom:1px solid ${C.border};padding-bottom:5px;margin-bottom:5px;overflow-wrap:anywhere}
.jb-debug-hover .jb-variable-row{flex-wrap:wrap;white-space:pre-wrap;overflow-wrap:anywhere}
.jb-debug-hover .jb-variable-value{white-space:pre-wrap;overflow-wrap:anywhere}

.jb-reader-layout{display:flex;flex:1;min-width:0;min-height:0;overflow:hidden;container-type:inline-size;container-name:workbench-reader}
.jb-reader-workspace{display:flex;flex:1;min-width:0;min-height:0;overflow:hidden}
.jb-reader-workspace[data-class-dock=bottom]{flex-direction:column}
.jb-class-window{box-sizing:border-box;flex:0 0 clamp(240px,var(--jb-class-width,44%),calc(100% - 286px));min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;container-type:size;container-name:class-pane;background:${C.panel};color:${C.text};font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.jb-reader-workspace[data-class-dock=bottom]>.jb-class-window{flex-basis:clamp(min(160px,45%),var(--jb-class-height,45%),max(0px,calc(100% - 166px)))}
@container workbench-reader (max-width:660px){.jb-reader-workspace[data-class-dock=right]{flex-direction:column}.jb-reader-workspace[data-class-dock=right]>.jb-class-window{flex-basis:clamp(min(160px,45%),var(--jb-class-height,45%),max(0px,calc(100% - 166px)))}}
.jb-class-window header,.jb-class-controls{display:flex;flex:none;gap:4px;align-items:center;padding:5px 6px;border-bottom:1px solid ${C.border};flex-wrap:wrap}
.jb-class-window button,.jb-class-window select,.jb-class-window input{font:inherit;color:inherit;background:${C.panel};border:1px solid ${C.border};border-radius:4px;padding:3px 7px}
.jb-class-window button{cursor:pointer}.jb-class-window button:hover{background:${C.hover}}.jb-class-window button:focus-visible,.jb-class-window input:focus-visible{outline:2px solid ${C.accent};outline-offset:1px}
.jb-class-mode{display:flex;gap:1px;margin-left:6px}.jb-class-window .jb-class-mode button{font-size:11px;padding:2px 5px;border-color:transparent;background:transparent}.jb-class-window .jb-class-mode [aria-selected=true]{color:${C.accent};background:${C.selection}}
.jb-class-beta{flex:none;padding:0 4px;border:1px solid ${C.border};border-radius:3px;color:${C.textDim};font-size:10px;line-height:16px}.jb-class-unavailable{min-height:0;overflow:auto;padding:16px 12px;color:${C.textDim};font-size:12px;line-height:1.7;overflow-wrap:anywhere}
.jb-class-tree-seat{display:flex;flex:1;min-height:0;min-width:0;flex-direction:column;overflow:hidden}.jb-class-tree{flex:1;min-height:0;overflow:auto;outline:none;padding:4px 0}.jb-class-tree-row{display:flex;align-items:center;gap:5px;box-sizing:border-box;min-height:25px;padding-right:8px;white-space:nowrap;cursor:default;font:12px/24px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.jb-class-tree-row:hover{background:${C.hover}}.jb-class-tree-row[data-active=true]{background:${C.selection}}.jb-class-tree:focus-visible [data-active=true]{box-shadow:inset 2px 0 ${C.accent}}
.jb-class-window .jb-class-tree-toggle{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:22px;padding:0;border:0;background:transparent;color:${C.textDim};font:12px/1 inherit}.jb-class-tree-symbol{display:inline-flex;align-items:center;justify-content:center;flex:none;width:15px;height:15px;font-size:10px;line-height:15px;border-radius:50%;color:${C.modified};background:color-mix(in srgb,${C.modified} 14%,${C.panel})}.jb-class-tree-row[data-kind=protocol] .jb-class-tree-symbol{color:${C.added};background:color-mix(in srgb,${C.added} 14%,${C.panel})}.jb-class-tree-row[data-kind=method] .jb-class-tree-symbol{background:transparent;border-radius:0}.jb-class-tree-row[data-kind=unresolved]{color:${C.textDim}}
.jb-class-tree-name{overflow:hidden;text-overflow:ellipsis;min-width:0}.jb-class-tree-badge{flex:none;font:10px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:${C.textDim};padding:0 3px;border:1px solid ${C.border};border-radius:3px}.jb-class-tree-path{margin-left:auto;max-width:30%;overflow:hidden;text-overflow:ellipsis;font-size:10px;color:${C.textDim}}@container class-pane (max-width:340px){.jb-class-tree-path{display:none}}
.jb-class-window input{width:0;min-width:80px;flex:1}.jb-class-controls button{flex:none;padding:3px 5px}.jb-class-controls button[aria-pressed=true]{color:${C.accent};border-color:${C.accent}}.jb-class-controls svg{display:block}.jb-class-hint{padding:4px 8px;color:${C.textDim};font-size:11px;overflow-wrap:anywhere}.jb-class-hint[role=alert]{color:${C.text}}
.jb-class-info{flex:0 1 auto;min-height:0;max-height:30%;overflow:auto;border-bottom:1px solid ${C.border}}
@container class-pane (max-height:240px){.jb-class-info{display:none}}
.jb-class-results{display:flex;flex:none;flex-direction:column;max-height:20%;overflow:auto}.jb-class-results button{text-align:left}
.jb-class-viewport{flex:1;min-width:0;min-height:0;overflow:auto;cursor:grab;touch-action:none}.jb-class-stage{position:relative;overflow:hidden;margin-inline:auto}.jb-class-canvas{position:absolute;left:0;top:0;transform-origin:top left}.jb-class-links{position:absolute;inset:0;stroke:${C.textDim};stroke-width:1.5;pointer-events:none}
.jb-class-card{position:absolute;box-sizing:border-box;border:1px solid color-mix(in srgb,${C.modified} 22%,${C.border});border-radius:3px;background:color-mix(in srgb,${C.modified} 3%,${C.panel});display:flex;flex-direction:column;overflow:hidden;cursor:default;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.jb-class-card[data-kind=protocol]{border-color:color-mix(in srgb,${C.added} 28%,${C.border});background:color-mix(in srgb,${C.added} 4%,${C.panel})}
.jb-class-card[data-selected=true]{border-color:${C.accent};box-shadow:0 0 0 1px ${C.accent}}
.jb-class-heading{display:flex;align-items:center;gap:7px;padding:7px 9px 3px;min-height:25px}.jb-class-symbol{display:inline-flex;align-items:center;justify-content:center;flex:none;width:18px;height:18px;border-radius:50%;font:600 11px/1 ui-monospace,monospace;color:${C.modified};background:color-mix(in srgb,${C.modified} 16%,${C.panel})}.jb-class-card[data-kind=protocol] .jb-class-symbol{color:${C.added};background:color-mix(in srgb,${C.added} 15%,${C.panel})}.jb-class-card[data-kind=abstract] .jb-class-name{font-style:italic}
.jb-class-window .jb-class-name{padding:0;border:0;border-radius:0;text-align:left;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;min-width:0;color:${C.code}}
.jb-class-path{font-size:10px;padding:0 9px 6px 34px;color:${C.textDim};overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.jb-class-members{display:flex;flex-direction:column;overflow:auto;min-height:0;flex:1;border-top:1px solid ${C.border};padding:3px 0}.jb-class-window .jb-class-members button{display:flex;gap:6px;align-items:center;flex:none;height:25px;padding:2px 9px;border:0;border-radius:0;text-align:left;font-family:inherit;background:transparent;font-size:11px}
.jb-class-members button[data-abstract=true]{font-style:italic;color:${C.modified}}.jb-class-method-symbol{flex:none;width:14px;font:600 11px/1 ui-monospace,monospace;color:${C.modified}}.jb-class-method-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.jb-class-parameters{color:${C.textDim};font-weight:400}.jb-class-return{color:${C.textDim};margin-left:auto;flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jb-class-unresolved{padding:2px 6px;font-size:10px;color:${C.textDim};overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.jb-class-links{stroke:${C.modified};stroke-linejoin:round;stroke-linecap:round}.jb-class-links .jb-class-arrow{fill:${C.panel}}.jb-class-links [data-protocol=true]{stroke:${C.added}}.jb-class-links [data-protocol=true] .jb-class-edge{stroke-dasharray:5 4}
.jb-class-links [data-factory=true]{stroke:${C.textDim}}.jb-class-links [data-factory=true] .jb-class-edge{stroke-dasharray:2 4}.jb-class-links [data-factory=true] .jb-class-arrow{fill:none}
.jb-class-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:10px;color:${C.textDim};padding:2px 10px 7px}.jb-class-legend-inherit:before,.jb-class-legend-protocol:before,.jb-class-legend-factory:before{content:"";display:inline-block;vertical-align:middle;width:18px;border-top:1.5px solid ${C.modified};margin-right:5px}.jb-class-legend-protocol:before{border-color:${C.added};border-top-style:dashed}.jb-class-legend-factory:before{border-color:${C.textDim};border-top-style:dotted}
.jb-class-evidence{padding:0 10px 7px;font-size:11px;color:${C.textDim};flex:none}.jb-class-evidence>div{max-height:86px;overflow:auto;margin-top:4px}.jb-class-window .jb-class-evidence button{display:block;width:100%;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;background:transparent;padding:3px 0;color:${C.text};font-size:11px}

.jb-debug-hover code{font:inherit;color:${C.text}}
.jb-debug-hover .jb-variable-list{padding-left:12px}
.jb-evaluate{width:620px;max-height:calc(88vh - 16px);left:50%;top:12%;transform:translateX(-50%);padding:14px;display:flex;flex-direction:column;gap:10px}
.jb-evaluate-heading,.jb-evaluate-submit{display:flex;align-items:center;justify-content:space-between;gap:12px}
.jb-evaluate-heading{font-weight:500}.jb-evaluate-frame{color:${C.textDim};overflow-wrap:anywhere}
.jb-evaluate label{display:flex;flex-direction:column;gap:6px}.jb-evaluate textarea{box-sizing:border-box;width:100%;min-height:72px;resize:vertical;background:${C.bg};color:${C.text};border:1px solid ${C.border};border-radius:3px;padding:8px;font:13px/20px monospace}
.jb-evaluate button{background:${C.panel};color:${C.text};border:1px solid ${C.border};border-radius:3px;padding:4px 10px;font:inherit}.jb-evaluate button:disabled{opacity:.45}.jb-evaluate :focus-visible{outline:2px solid ${C.accent};outline-offset:2px}
.jb-evaluate small{color:${C.textDim}}.jb-evaluate-result{border-top:1px solid ${C.border};padding-top:10px;overflow:auto;max-height:40vh}
.jb-editor-popup-title{padding:4px 8px;font-weight:500;overflow-wrap:anywhere}
.jb-goto{width:320px;padding:10px;left:50%;top:25%;transform:translateX(-50%)}
.jb-goto label{display:block;margin-bottom:6px}
.jb-goto input,.jb-goto select{box-sizing:border-box;width:100%;padding:6px 8px;background:${C.bg};color:${C.text};border:1px solid ${C.accent};border-radius:3px;font:inherit}
.jb-goto small{display:block;margin-top:6px;overflow-wrap:anywhere}
@media(hover:hover){.jb-editor-popup [role=menuitem]:hover:not(:disabled){background:${C.selection}}}
@media(pointer:coarse){.jb-goto input{font-size:16px}}
.jb-changes{flex:1;min-width:0;display:flex}
.jb-code-browser{position:relative;min-height:0;overflow:hidden}
.jb-code-workspace{display:flex;flex:1;min-width:0;min-height:0;overflow:hidden}
.jb-code-browser .jb-code-workspace>.jb-tree{box-sizing:border-box;width:clamp(160px,var(--jb-tree-width,340px),calc(100% - 246px));min-width:0}
.jb-pane-divider{position:relative;flex:none;align-self:stretch;background:${C.bg};touch-action:none;user-select:none;outline:none}
.jb-pane-divider[hidden]{display:none}
.jb-pane-divider[aria-orientation=vertical]{width:6px;cursor:col-resize}
.jb-pane-divider[aria-orientation=horizontal]{height:6px;cursor:row-resize}
.jb-pane-divider:after{content:"";position:absolute;background:${C.border}}
.jb-pane-divider[aria-orientation=vertical]:after{top:0;bottom:0;left:2px;width:1px}
.jb-pane-divider[aria-orientation=horizontal]:after{left:0;right:0;top:2px;height:1px}
.jb-pane-divider:focus-visible:after,.jb-pane-divider[data-dragging=true]:after{background:${C.accent}}
.jb-pane-divider:focus-visible{box-shadow:inset 0 0 0 1px ${C.accent}}
@media(hover:hover){.jb-pane-divider:hover:after{background:${C.accent}}}
@media(pointer:coarse){.jb-pane-divider[aria-orientation=vertical]{width:10px}.jb-pane-divider[aria-orientation=horizontal]{height:10px}}
.jb-layout-notice{position:absolute;z-index:3;right:8px;bottom:8px;max-width:calc(100% - 16px);padding:6px 10px;background:${C.toolbar};color:${C.text};border:1px solid ${C.border};border-radius:4px;overflow-wrap:anywhere}
.jb-tree{flex:none;width:340px;min-width:260px;overflow-y:auto;background:${C.panel};border-right:1px solid ${C.border};scrollbar-gutter:stable}
.jb-code-browser .jb-tree{scroll-padding-top:46px}
.jb-tree-toolbar{position:sticky;top:0;z-index:2;background:${C.panel};display:flex;align-items:center;gap:2px;padding-right:6px;min-width:0}
.jb-tree-toolbar .jb-filter{flex:1;min-width:0;margin-right:2px}
.jb-tree-toolbar>.jb-tb-btn{flex:none}
.jb-search-panel{display:flex;flex:1;min-width:0;flex-direction:column;min-height:0;height:100%;color:${C.text};font-size:12px}
.jb-search-form{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px}
.jb-search-form>input{flex:1;min-width:140px;background:${C.bg};color:${C.text};border:1px solid ${C.border};border-radius:4px;padding:5px 8px;font:inherit}
.jb-search-form label{display:flex;align-items:center;gap:4px;white-space:nowrap;color:${C.textDim}}
.jb-search-summary{display:flex;gap:12px;justify-content:space-between;padding:0 10px 7px;color:${C.textDim};border-bottom:1px solid ${C.border}}
.jb-search-summary>span:first-child{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.jb-search-summary>span:last-child{flex-shrink:0}
.jb-search-results{overflow:auto;flex:1;min-height:0}
.jb-search-result{display:flex;gap:12px;align-items:baseline;width:100%;border:0;background:transparent;color:${C.text};text-align:left;padding:6px 10px;font:inherit;cursor:pointer}
.jb-search-result:hover{background:${C.hover}}
.jb-search-result:focus-visible{outline:1px solid ${C.accent};outline-offset:-1px;background:${C.selection}}
.jb-search-location{flex:0 0 35%;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${C.modified}}
.jb-search-result code{overflow:hidden;white-space:pre;text-overflow:ellipsis;color:${C.code};font:12px/1.5 ui-monospace,monospace}
.jb-search-notice{padding:6px 10px;color:${C.textDim}}
.jb-filter{box-sizing:border-box;display:flex;align-items:center;gap:6px;height:30px;margin:8px 10px;padding:0 8px;background:${C.toolbar};border:1px solid ${C.border};border-radius:4px}
.jb-filter svg{flex:none;width:14px;height:14px;color:${C.textDim}}
.jb-filter input{flex:1;min-width:0;height:100%;background:transparent;border:none;outline:none;color:${C.text};font:inherit;font-size:12.5px}
.jb-filter input::placeholder{color:${C.textDim}}
.jb-group-title{display:flex;align-items:center;gap:6px;height:28px;padding:0 10px;color:${C.text};font-weight:500;font-size:12.5px;white-space:nowrap}
.jb-group-title .jb-count{color:${C.textDim};font-weight:400}
.jb-tree-hint{color:${C.textDim};font-size:12px;padding:2px 10px 8px}
.jb-node{display:flex;align-items:center;gap:7px;height:24px;padding:0 6px;cursor:pointer;white-space:nowrap;user-select:none}
.jb-node:hover{background:${C.hover}}
.jb-node[data-selected=true]{background:${C.selection}}
.jb-node .jb-chevron{flex:none;width:12px;height:12px;color:${C.textDim};display:inline-flex;align-items:center;justify-content:center;transition:transform .1s}
.jb-node[data-open=true] .jb-chevron{transform:rotate(90deg)}
.jb-node .jb-folder{flex:none;color:${C.textDim}}
.jb-node .jb-dirname{overflow:hidden;text-overflow:ellipsis;color:${C.text}}
.jb-node .jb-fileicon{flex:none;width:16px;height:16px}
.jb-node .jb-fileicon-gray{color:${C.textDim}}
.jb-node .jb-fileicon-gray *{fill:currentColor;stroke:currentColor}
.jb-node .jb-filename{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.jb-node[data-status=A] .jb-filename{color:${C.added}}
.jb-node[data-status=M] .jb-filename{color:${C.modified}}
.jb-node[data-status=R] .jb-filename{color:${C.modified}}
.jb-node[data-status=C] .jb-filename{color:${C.modified}}
.jb-node[data-status=D] .jb-filename{color:${C.deleted}}
.jb-node[data-status=U] .jb-filename{color:${C.deleted}}
.jb-node[data-status=?] .jb-filename{color:${C.untracked}}
.jb-node[data-status=D] .jb-filename{text-decoration:line-through}
.jb-stats{flex:none;color:${C.textDim};font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.jb-detail{position:relative;flex:1;min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.jb-source-notice{position:absolute;top:76px;right:8px;z-index:2;max-width:calc(100% - 16px);box-sizing:border-box;padding:6px 10px;background:${C.toolbar};color:${C.text};border:1px solid ${C.border};border-radius:4px;box-shadow:var(--dsw-elevation-panel);overflow-wrap:anywhere}
.jb-diffwrap{flex:1;min-height:0;display:flex;flex-direction:column}
.jb-diffhead{flex:none;display:flex;align-items:center;gap:10px;height:34px;padding:0 14px;background:${C.gutter};border-bottom:1px solid ${C.border}}
.jb-diffpath{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${C.text};font-size:12.5px;font-weight:500}
.jb-difftag{flex:none;color:${C.textDim};font-size:12px}
.jb-diffstats{flex:none;color:${C.textDim};font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.jb-diffbody{flex:1;min-height:0;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:12.5px;line-height:19px;background:${C.panel}}
.jb-dline{display:flex;min-width:0}
.jb-dline-num{flex:none;width:44px;text-align:right;padding:0 8px 0 0;color:${C.textDim};background:${C.gutter};user-select:none;border-right:1px solid ${C.border}}
.jb-dline-num2{flex:none;width:44px;text-align:right;padding:0 8px 0 0;color:${C.textDim};background:${C.gutter};user-select:none;border-right:1px solid ${C.border}}
.jb-dline-text{flex:1;min-width:0;white-space:pre-wrap;word-break:break-all;padding:0 12px 0 8px}
.jb-dline-add .jb-dline-text{background:${C.diffAddBg};color:${C.diffAddFg}}
.jb-dline-add .jb-dline-num{background:${C.diffAddGutter};color:${C.textDim}}
.jb-dline-add .jb-dline-num2{background:${C.diffAddGutter};color:${C.textDim}}
.jb-dline-del .jb-dline-text{background:${C.diffDelBg};color:${C.diffDelFg}}
.jb-dline-del .jb-dline-num{background:${C.diffDelGutter};color:${C.textDim}}
.jb-dline-del .jb-dline-num2{background:${C.diffDelGutter};color:${C.textDim}}
.jb-dline-hunk .jb-dline-text{background:${C.gutter};color:${C.code}}
.jb-dline-hunk .jb-dline-num{background:${C.gutter}}
.jb-dline-hunk .jb-dline-num2{background:${C.gutter}}
.jb-dline-file .jb-dline-text{color:${C.textDim}}
.jb-dline-file .jb-dline-num{background:${C.gutter}}
.jb-dline-file .jb-dline-num2{background:${C.gutter}}
.jb-dline-ctx .jb-dline-text{color:${C.code}}
.jb-dline-meta .jb-dline-text{color:${C.textDim}}
.jb-diffempty{flex:1;display:flex;align-items:center;justify-content:center;color:${C.textDim};font-size:13px;background:${C.panel}}
.jb-reviewbar{flex:none;display:flex;flex-direction:column;gap:8px;padding:8px 14px;background:${C.toolbar};border-bottom:1px solid ${C.border}}
.jb-review-input{box-sizing:border-box;width:100%;min-height:64px;max-height:150px;color:${C.text};background:${C.panel};border:1px solid ${C.border};border-radius:4px;font:inherit;font-size:12.5px;line-height:19px;resize:vertical;padding:6px 8px;outline:none}
.jb-review-input:focus{border-color:${C.accent}}
.jb-review-row{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.jb-review-sent{color:${C.added};font-size:12px}
.jb-review-err{color:${C.deleted};font-size:12px;margin-right:auto}
.jb-review-btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 12px;border:none;border-radius:4px;background:${C.primary};color:${C.onPrimary};font:inherit;font-size:12px;font-weight:500;cursor:pointer}
.jb-review-btn:hover:not(:disabled){background:${C.primaryHover}}
.jb-review-btn:disabled{opacity:.5;cursor:default}
.jb-review-btn-ghost{background:${C.gutter};color:${C.text};border:1px solid ${C.border}}
.jb-review-btn-ghost:hover:not(:disabled){background:${C.hover}}
.jb-dline-selected .jb-dline-text{background:${C.selection} !important;color:${C.text} !important;box-shadow:inset 2px 0 0 ${C.accent}}
.jb-dline-selected .jb-dline-num{background:${C.selection} !important;color:${C.text} !important}
.jb-dline-selected .jb-dline-num2{background:${C.selection} !important;color:${C.text} !important}
.jb-review-hint{color:${C.textDim};font-size:11.5px}
.jb-review-code{flex:none;max-height:140px;overflow:auto;border:1px solid ${C.border};border-radius:4px;background:${C.panel}}
.jb-review-code-head{display:flex;align-items:center;gap:8px;height:26px;padding:0 8px;color:${C.textDim};font-size:11px;border-bottom:1px solid ${C.border}}
.jb-review-code-clear{background:none;border:none;color:${C.modified};font:inherit;font-size:11px;cursor:pointer;padding:0}
.jb-review-code-body{margin:0;padding:6px 8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:17px;color:${C.code};white-space:pre}
.jb-review-head{display:flex;flex-direction:column;gap:1px;min-width:0}
.jb-review-title{font-size:12.5px;font-weight:500;color:${C.text};overflow-wrap:anywhere}
.jb-review-note{color:${C.textDim};font-size:11.5px;overflow-wrap:anywhere}
.jb-cards{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;background:${C.panel};color:${C.text}}
.jb-tool-panel>.jb-cards{min-height:0;flex:1}
.jb-cards-bar{display:flex;align-items:center;gap:8px;flex:none;min-height:34px;padding:4px 10px;border-bottom:1px solid ${C.border};flex-wrap:wrap}
.jb-cards-filter{box-sizing:border-box;display:flex;align-items:center;gap:6px;flex:1 1 160px;min-width:0;height:26px;padding:0 8px;background:${C.toolbar};border:1px solid ${C.border};border-radius:4px}
.jb-cards-filter svg{flex:none;width:14px;height:14px;color:${C.textDim}}
.jb-cards-filter input{flex:1;min-width:0;height:100%;background:transparent;border:0;outline:none;color:${C.text};font:inherit;font-size:12.5px}
.jb-cards-filter input::placeholder{color:${C.textDim}}
.jb-cards-dir{flex:0 1 auto;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${C.textDim};font-size:11.5px}
.jb-cards-body{flex:1;min-height:0;overflow:auto}
.jb-cards-list{display:flex;flex-direction:column;gap:6px;padding:6px 10px}
.jb-card-group>summary{padding:4px 2px;color:${C.text};font-size:12px;overflow-wrap:anywhere;cursor:pointer}
.jb-card-group>summary small{margin-inline-start:6px;color:${C.textDim}}
.jb-card-group>.jb-cards-list{padding:3px 0 6px 12px}
.jb-card-row{box-sizing:border-box;display:flex;flex-direction:column;gap:3px;width:100%;text-align:left;border:1px solid ${C.border};border-radius:5px;background:${C.bg};color:${C.text};font:inherit;padding:7px 10px;cursor:default}
.jb-card-row:focus-visible{outline:2px solid ${C.accent};outline-offset:-2px}
.jb-card-title{font-size:12.5px;font-weight:500;overflow-wrap:anywhere}
.jb-card-tags{display:flex;flex-wrap:wrap;gap:4px}
.jb-card-tag{font-size:10.5px;line-height:16px;padding:0 6px;border-radius:8px;background:${C.gutter};border:1px solid ${C.border};color:${C.textDim};white-space:nowrap}
.jb-card-summary{color:${C.textDim};font-size:11.5px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.jb-card-source{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${C.textDim};font-size:11.5px}
.jb-cards-empty{padding:14px 12px;color:${C.textDim};overflow-wrap:anywhere}
.jb-cards-notice{padding:3px 12px;color:${C.textDim};font-size:11.5px;overflow-wrap:anywhere}
.jb-cards-detail{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column}
.jb-cards-detail-bar{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap;min-height:32px;padding:4px 10px;border-bottom:1px solid ${C.border}}
.jb-cards-detail-title{min-width:0;flex:1 1 120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:500}
.jb-cards-reader{display:flex;flex:1;min-width:0;min-height:0;overflow:hidden}
.jb-cards-reader .jb-document{padding:12px 14px 24px;font-size:13px;line-height:1.7}
@media(hover:hover){.jb-card-row:hover{background:${C.hover}}}
.jb-notice{flex:none;display:flex;align-items:center;gap:6px;padding:6px 14px;font-size:12px;background:${C.toolbar};border-bottom:1px solid ${C.border};color:${C.text}}
.jb-notice-error{color:${C.deleted}}
.jb-empty{color:${C.textDim};padding:16px;font-size:13px;background:${C.panel}}
.jb-log{flex:1;min-width:0;display:flex;flex-direction:column;background:${C.panel}}
.jb-loghead{flex:none;display:flex;align-items:center;height:28px;padding:0 10px;background:${C.gutter};border-bottom:1px solid ${C.border};color:${C.textDim};font-size:12px;white-space:nowrap}
.jb-loghead .jb-col-graph{width:auto;min-width:40px}
.jb-loghead .jb-col-msg{flex:1;min-width:0}
.jb-loghead .jb-col-author{flex:none;width:150px}
.jb-loghead .jb-col-date{flex:none;width:130px;text-align:right}
.jb-loghead .jb-col-hash{flex:none;width:72px;text-align:right}
.jb-logbody{flex:1;min-height:0;overflow:auto}
.jb-logrow{display:flex;align-items:center;height:24px;padding:0 10px;white-space:nowrap;cursor:pointer}
.jb-logrow:hover{background:${C.hover}}
.jb-logrow[data-selected=true]{background:${C.selection}}
.jb-logrow .jb-col-graph{flex:none;width:auto;min-width:40px;display:flex;align-items:center}
.jb-logrow .jb-col-msg{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;color:${C.text}}
.jb-logrow .jb-col-author{flex:none;width:150px;overflow:hidden;text-overflow:ellipsis;color:${C.textDim}}
.jb-logrow .jb-col-date{flex:none;width:130px;text-align:right;color:${C.textDim}}
.jb-logrow .jb-col-hash{flex:none;width:72px;text-align:right;color:${C.textDim};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.jb-logdetail{flex:none;height:46%;min-height:220px;display:flex;flex-direction:column;border-top:1px solid ${C.border};background:${C.panel}}
.jb-logdetail-head{flex:none;display:flex;align-items:center;gap:10px;min-height:34px;padding:0 14px;background:${C.gutter};border-bottom:1px solid ${C.border}}
.jb-logdetail-subject{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${C.text};font-size:12.5px;font-weight:500}
.jb-logdetail-meta{flex:none;padding:6px 14px 0;color:${C.textDim};font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.jb-detail-files{flex:none;max-height:130px;overflow:auto;margin:8px 14px 0;border:1px solid ${C.border};border-radius:6px}
.jb-detail-fileshead{height:24px;padding:0 8px;display:flex;align-items:center;color:${C.textDim};font-size:11px;text-transform:uppercase;letter-spacing:.02em;border-bottom:1px solid ${C.border}}
.jb-dfile{display:flex;align-items:center;gap:8px;height:22px;padding:0 8px;font-size:12px}
.jb-dfile:hover{background:${C.hover}}
.jb-dfile-stats{flex:none;color:${C.textDim};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}
.jb-dfile-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jb-branchchip-log{display:inline-flex;align-items:center;height:16px;margin:0 0 0 6px;padding:0 6px;border-radius:8px;background:${C.primary};color:${C.onPrimary};font-size:11px;line-height:16px;font-weight:500}
.jb-loghash{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:18px;color:${C.textDim};background:${C.panel};border:1px solid ${C.border};border-radius:6px;padding:1px 6px}

@container git-panel (max-width:720px){
.jb-toolbar{height:auto;min-height:38px;flex-wrap:wrap;padding:6px 10px;gap:6px}
.jb-toolbar .jb-selectwrap{flex:1 1 150px;max-width:100%}
.jb-select{width:100%;max-width:100%;min-width:0}
.jb-branchinfo{max-width:100%;flex-wrap:wrap}
.jb-branchchip{max-width:100%;overflow-wrap:anywhere;white-space:normal;height:auto;min-height:24px;box-sizing:border-box}
.jb-changes{flex-direction:column;min-height:0}
.jb-code-workspace{flex-direction:column}
.jb-tree{width:100%;min-width:0;flex:0 1 auto;max-height:40%;border-right:0;border-bottom:1px solid ${C.border}}
.jb-code-browser .jb-code-workspace>.jb-tree{width:100%;flex:0 0 clamp(min(60px,30%),var(--jb-tree-height,28%),max(0px,calc(100% - 166px)));max-height:none}
.jb-detail{min-height:0}
.jb-diffhead{height:auto;min-height:34px;flex-wrap:wrap;padding:6px 10px;gap:6px}
.jb-diffpath{flex-basis:100%;white-space:normal;overflow-wrap:anywhere}
.jb-loghead{display:none}
.jb-logrow{height:auto;min-height:46px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;column-gap:8px;padding:5px 10px}
.jb-logrow .jb-col-graph{grid-row:1/4;grid-column:1}
.jb-logrow .jb-col-msg{grid-row:1;grid-column:2/4;white-space:normal;overflow-wrap:anywhere}
.jb-logrow .jb-col-author{grid-row:2;grid-column:2;width:auto}
.jb-logrow .jb-col-date{grid-row:3;grid-column:2;width:auto;text-align:left}
.jb-logrow .jb-col-hash{grid-row:2;grid-column:3;width:auto}
.jb-logdetail{min-height:0;height:50%;overflow:auto}
}

`;

    // ------------------------------------------------------------- file icons
    // File-type icons from vscode-icons (MIT License). Geometry converted to a
    // compact shape table; gradients resolved to solid colors.
const FILE_ICONS = {typescript:[['path',{fill:"#007acc",d:"M23.827 8.243a4.4 4.4 0 0 1 2.223 1.281 6 6 0 0 1 .852 1.143c.011.045-1.534 1.083-2.471 1.662-.034.023-.169-.124-.322-.35a2.01 2.01 0 0 0-1.67-1c-1.077-.074-1.771.49-1.766 1.433a1.3 1.3 0 0 0 .153.666c.237.49.677.784 2.059 1.383 2.544 1.095 3.636 1.817 4.31 2.843a5.16 5.16 0 0 1 .416 4.333 4.76 4.76 0 0 1-3.932 2.815 11 11 0 0 1-2.708-.028 6.53 6.53 0 0 1-3.616-1.884 6.3 6.3 0 0 1-.926-1.371 3 3 0 0 1 .327-.208c.158-.09.756-.434 1.32-.761l1.024-.6.214.312a4.8 4.8 0 0 0 1.35 1.292 3.3 3.3 0 0 0 3.458-.175 1.545 1.545 0 0 0 .2-1.974c-.276-.395-.84-.727-2.443-1.422a8.8 8.8 0 0 1-3.349-2.055 4.7 4.7 0 0 1-.976-1.777 7.1 7.1 0 0 1-.062-2.268 4.33 4.33 0 0 1 3.644-3.374 9 9 0 0 1 2.691.084m-8.343 1.483.011 1.454h-4.63v13.148H7.6V11.183H2.97V9.755a14 14 0 0 1 .04-1.466c.017-.023 2.832-.034 6.245-.028l6.211.017Z"}]],js:[['path',{fill:"#f5de19",d:"M18.774 19.7a3.73 3.73 0 0 0 3.376 2.078c1.418 0 2.324-.709 2.324-1.688 0-1.173-.931-1.589-2.491-2.272l-.856-.367c-2.469-1.052-4.11-2.37-4.11-5.156 0-2.567 1.956-4.52 5.012-4.52A5.06 5.06 0 0 1 26.9 10.52l-2.665 1.711a2.33 2.33 0 0 0-2.2-1.467 1.49 1.49 0 0 0-1.638 1.467c0 1.027.636 1.442 2.1 2.078l.856.366c2.908 1.247 4.549 2.518 4.549 5.376 0 3.081-2.42 4.769-5.671 4.769a6.58 6.58 0 0 1-6.236-3.5ZM6.686 20c.538.954 1.027 1.76 2.2 1.76 1.124 0 1.834-.44 1.834-2.15V7.975h3.422v11.683c0 3.543-2.078 5.156-5.11 5.156A5.31 5.31 0 0 1 3.9 21.688Z"}]],json:[['path',{fill:"#f5de19",d:"M4.014 14.976a2.5 2.5 0 0 0 1.567-.518 2.38 2.38 0 0 0 .805-1.358 15.3 15.3 0 0 0 .214-2.944q.012-2.085.075-2.747a5.2 5.2 0 0 1 .418-1.686 3 3 0 0 1 .755-1.018A3.05 3.05 0 0 1 9 4.125 6.8 6.8 0 0 1 10.544 4h.7v1.96h-.387a2.34 2.34 0 0 0-1.723.468 3.4 3.4 0 0 0-.425 2.092 36 36 0 0 1-.137 4.133 4.7 4.7 0 0 1-.768 2.06A4.6 4.6 0 0 1 6.1 16a3.8 3.8 0 0 1 1.992 1.754 8.9 8.9 0 0 1 .618 3.865q0 2.435.05 2.9a1.76 1.76 0 0 0 .504 1.181 2.64 2.64 0 0 0 1.592.337h.387V28h-.7a5.7 5.7 0 0 1-1.773-.2 2.97 2.97 0 0 1-1.324-.93 3.35 3.35 0 0 1-.681-1.63 24 24 0 0 1-.165-3.234 16.5 16.5 0 0 0-.214-3.106 2.4 2.4 0 0 0-.805-1.361 2.5 2.5 0 0 0-1.567-.524Zm23.972 2.035a2.5 2.5 0 0 0-1.567.524 2.4 2.4 0 0 0-.805 1.361 16.5 16.5 0 0 0-.212 3.109 24 24 0 0 1-.169 3.234 3.35 3.35 0 0 1-.681 1.63 2.97 2.97 0 0 1-1.324.93 5.7 5.7 0 0 1-1.773.2h-.7V26.04h.387a2.64 2.64 0 0 0 1.592-.337 1.76 1.76 0 0 0 .506-1.186q.05-.462.05-2.9a8.9 8.9 0 0 1 .618-3.865A3.8 3.8 0 0 1 25.9 16a4.6 4.6 0 0 1-1.7-1.286 4.7 4.7 0 0 1-.768-2.06 36 36 0 0 1-.137-4.133 3.4 3.4 0 0 0-.425-2.092 2.34 2.34 0 0 0-1.723-.468h-.387V4h.7a6.8 6.8 0 0 1 1.54.125 3.05 3.05 0 0 1 1.149.581 3 3 0 0 1 .755 1.018 5.2 5.2 0 0 1 .418 1.686q.062.662.075 2.747a15.3 15.3 0 0 0 .212 2.947 2.38 2.38 0 0 0 .805 1.355 2.5 2.5 0 0 0 1.567.518Z"}]],markdown:[['path',{stroke:"#755838",d:"M2.5 7.955h27v16.091h-27z"}],['path',{fill:"#755838",d:"M5.909 20.636v-9.272h2.727l2.728 3.409 2.727-3.409h2.727v9.272h-2.727v-5.318l-2.727 3.409-2.728-3.409v5.318zm17.046 0-4.091-4.5h2.727v-4.772h2.727v4.772h2.727z"}]],yaml:[['path',{fill:"#ffe885",d:"M2 12.218c.755 0 1.51-.008 2.264 0l.053.038 2.761 2.758c.891-.906 1.8-1.794 2.7-2.7.053-.052.11-.113.192-.1h1.823a1.4 1.4 0 0 1 .353.019c-.7.67-1.377 1.369-2.069 2.05L5.545 18.8c-.331.324-.648.663-.989.975-.754.022-1.511.007-2.266.007 1.223-1.209 2.431-2.433 3.658-3.637-1.321-1.304-2.63-2.62-3.948-3.927m10.7 0h1.839v7.566c-.611 0-1.222.012-1.832-.008v-4.994c-1.6 1.607-3.209 3.2-4.811 4.8-.089.08-.166.217-.305.194-.824-.006-1.649 0-2.474 0Q8.916 16 12.7 12.218m2.258.002c.47-.009.939 0 1.409 0 .836.853 1.69 1.689 2.536 2.532q1.268-1.267 2.539-2.532h1.4q-.008 3.784 0 7.567c-.471 0-.943.006-1.414 0q.008-2.387 0-4.773c-.844.843-1.676 1.7-2.526 2.536-.856-.835-1.687-1.695-2.532-2.541 0 1.594-.006 3.188.006 4.781-.472 0-.943.005-1.415 0q-.003-3.79-.003-7.57m8.301-.003c.472 0 .944-.007 1.416 0q-.007 3.083 0 6.166h3.782c.063.006.144-.012.191.045.448.454.907.9 1.353 1.354q-3.371.007-6.741 0 .007-3.782-.001-7.565"}]],python:[['path',{fill:"#387eb8",d:"M15.885 2.1c-7.1 0-6.651 3.07-6.651 3.07v3.19h6.752v1H6.545S2 8.8 2 16.005s4.013 6.912 4.013 6.912H8.33v-3.361s-.13-4.013 3.9-4.013h6.762s3.772.06 3.772-3.652V5.8s.572-3.712-6.842-3.712Zm-3.732 2.137a1.214 1.214 0 1 1-1.183 1.244v-.02a1.214 1.214 0 0 1 1.214-1.214Z"}],['path',{fill:"#ffe052",d:"M16.085 29.91c7.1 0 6.651-3.08 6.651-3.08v-3.18h-6.751v-1h9.47S30 23.158 30 15.995s-4.013-6.912-4.013-6.912H23.64V12.4s.13 4.013-3.9 4.013h-6.765S9.2 16.356 9.2 20.068V26.2s-.572 3.712 6.842 3.712h.04Zm3.732-2.147A1.214 1.214 0 1 1 21 26.519v.03a1.214 1.214 0 0 1-1.214 1.214z"}]],go:[['path',{fill:"#00acd7",d:"M0 12.32h1.64q.12.02.06.12l-.34.5a.3.3 0 0 1-.2.12H0zm0 1.8h.62a.1.1 0 0 1 .1.12l-.16.46a.2.2 0 0 1-.17.12H0zm0 1.8h.19q.12 0 .12.13l-.04.47a.15.15 0 0 1-.14.14H0zm16.15-3.22c-1.23.3-2.07.54-3.28.85-.3.08-.32.1-.57-.2-.3-.32-.5-.54-.92-.73a3.4 3.4 0 0 0-3.53.29 4.2 4.2 0 0 0-2 3.7 3.1 3.1 0 0 0 2.64 3.07 3.6 3.6 0 0 0 3.32-1.28q.25-.32.53-.73H8.57c-.41 0-.5-.25-.37-.58.25-.6.72-1.62 1-2.13a.5.5 0 0 1 .48-.31h7.11c-.04.52-.04 1.05-.11 1.58a8.3 8.3 0 0 1-1.6 3.83 8.2 8.2 0 0 1-5.57 3.32 7 7 0 0 1-5.26-1.3 6 6 0 0 1-2.48-4.33 7.7 7.7 0 0 1 1.66-5.72q2.1-2.75 5.47-3.38a6.7 6.7 0 0 1 5.18.96 6 6 0 0 1 2.26 2.75q.17.25-.2.33m6.47 10.81a7.3 7.3 0 0 1-4.76-1.73 6 6 0 0 1-2.11-3.76 7.5 7.5 0 0 1 1.58-5.9 8 8 0 0 1 5.47-3.26 7.2 7.2 0 0 1 5.56 1 6 6 0 0 1 2.76 4.35 7.6 7.6 0 0 1-2.25 6.62 9 9 0 0 1-4.69 2.5c-.52.1-1.05.11-1.56.17m4.65-7.9-.06-.64a3.2 3.2 0 0 0-3.98-2.6c-1.82.41-3 1.56-3.42 3.4a3.2 3.2 0 0 0 1.8 3.69q1.61.69 3.18-.12 2.32-1.2 2.48-3.73"}]],rust:[['path',{fill:"#7d7d7d",d:"M15.124 5.3a.832.832 0 1 1 .832.832.83.83 0 0 1-.832-.832M5.2 12.834a.832.832 0 1 1 .832.832.83.83 0 0 1-.832-.832m19.856.039a.832.832 0 1 1 .832.832.83.83 0 0 1-.832-.832m-17.451 1.14a.76.76 0 0 0 .386-1l-.369-.835h1.452v6.545h-2.93a10.3 10.3 0 0 1-.332-3.911Zm6.074.161v-1.929h3.458c.179 0 1.261.206 1.261 1.016 0 .672-.83.913-1.513.913ZM8.958 24.561a.832.832 0 1 1 .832.832.83.83 0 0 1-.832-.832m12.331.039a.832.832 0 1 1 .832.832.83.83 0 0 1-.832-.832m.257-1.887a.76.76 0 0 0-.9.584l-.418 1.949a10.25 10.25 0 0 1-8.545-.041l-.417-1.949a.76.76 0 0 0-.9-.583l-1.721.37a10 10 0 0 1-.89-1.049h8.374c.095 0 .158-.017.158-.1v-2.966c0-.086-.063-.1-.158-.1h-2.45v-1.881h2.649a1.665 1.665 0 0 1 1.629 1.412c.105.413.336 1.757.494 2.187.157.483.8 1.447 1.482 1.447h4.323a10 10 0 0 1-.949 1.1Zm4.65-7.821a10.3 10.3 0 0 1 .022 1.779h-1.051c-.105 0-.148.069-.148.172v.483c0 1.136-.641 1.384-1.2 1.447-.535.06-1.128-.224-1.2-.551a3.62 3.62 0 0 0-1.671-2.808c1.03-.654 2.1-1.619 2.1-2.911A3.29 3.29 0 0 0 21.44 9.8a4.56 4.56 0 0 0-2.2-.724H8.367A10.25 10.25 0 0 1 14.1 5.84l1.282 1.344a.76.76 0 0 0 1.072.026l1.434-1.372a10.25 10.25 0 0 1 7.015 5l-.982 2.217a.76.76 0 0 0 .386 1Zm2.448.036-.033-.343 1.011-.943a.42.42 0 0 0-.013-.595.4.4 0 0 0-.121-.081l-1.288-.483-.1-.334.806-1.12a.42.42 0 0 0-.13-.581.4.4 0 0 0-.133-.055l-1.363-.222-.164-.306.573-1.257a.42.42 0 0 0-.236-.544.4.4 0 0 0-.146-.029l-1.383.048-.224-.264.318-1.347a.42.42 0 0 0-.343-.487.4.4 0 0 0-.144 0l-1.348.315-.266-.219.049-1.381a.42.42 0 0 0-.431-.411.4.4 0 0 0-.141.028l-1.257.573-.306-.164-.222-1.363a.42.42 0 0 0-.5-.318.4.4 0 0 0-.133.055l-1.121.806-.333-.1-.483-1.293a.42.42 0 0 0-.555-.215.4.4 0 0 0-.12.08l-.946 1.012-.343-.033-.728-1.177a.42.42 0 0 0-.688 0l-.728 1.177-.343.033-.943-1.012a.42.42 0 0 0-.595.015.4.4 0 0 0-.08.12L12.483 3.8l-.333.1-1.12-.8a.42.42 0 0 0-.581.13.4.4 0 0 0-.055.133l-.222 1.363-.306.164-1.258-.573a.42.42 0 0 0-.544.239.4.4 0 0 0-.028.144l.048 1.383-.266.217-1.347-.316a.42.42 0 0 0-.487.343.4.4 0 0 0 0 .144L6.3 7.819l-.218.265L4.7 8.036a.422.422 0 0 0-.383.573l.573 1.257-.164.306-1.363.222a.42.42 0 0 0-.318.5.4.4 0 0 0 .055.133l.806 1.12-.1.334-1.293.483a.42.42 0 0 0-.215.555.4.4 0 0 0 .081.121l1.011.943-.033.343-1.177.728a.42.42 0 0 0 0 .688l1.177.728.033.343-1.011.943a.42.42 0 0 0 .015.595.4.4 0 0 0 .119.08l1.293.483.1.334-.806 1.124a.42.42 0 0 0 .131.581.4.4 0 0 0 .133.055l1.363.222.164.307-.573 1.257a.42.42 0 0 0 .24.545.4.4 0 0 0 .143.028l1.383-.048.219.266-.317 1.348a.42.42 0 0 0 .341.486.4.4 0 0 0 .146 0l1.345-.319.266.218-.049 1.382a.42.42 0 0 0 .429.41.4.4 0 0 0 .143-.028l1.257-.573.306.164.222 1.362a.42.42 0 0 0 .5.319.4.4 0 0 0 .133-.055l1.12-.807.334.1.483 1.292a.42.42 0 0 0 .556.214.4.4 0 0 0 .119-.08l.943-1.011.343.034.728 1.177a.42.42 0 0 0 .588.1.4.4 0 0 0 .1-.1l.728-1.177.343-.034.943 1.011a.42.42 0 0 0 .595-.015.4.4 0 0 0 .08-.119l.483-1.292.334-.1 1.12.807a.42.42 0 0 0 .581-.131.4.4 0 0 0 .055-.133l.222-1.362.306-.164 1.257.573a.42.42 0 0 0 .544-.239.4.4 0 0 0 .028-.143l-.048-1.384.265-.218 1.347.317a.42.42 0 0 0 .487-.34.5.5 0 0 0 0-.146l-.309-1.346.218-.266 1.383.048a.42.42 0 0 0 .41-.431.4.4 0 0 0-.028-.142l-.573-1.257.164-.307 1.363-.222a.42.42 0 0 0 .319-.5.4.4 0 0 0-.056-.135l-.806-1.12.1-.334 1.293-.483a.42.42 0 0 0 .215-.554.4.4 0 0 0-.081-.121l-1.011-.943.033-.343 1.177-.728a.42.42 0 0 0 0-.688Z"}]],shell:[['path',{fill:"#d9b400",d:"M29.4 27.6H2.5V4.5h26.9Zm-25.9-1h24.9V5.5H3.5Z"}],['path',{fill:"#d9b400",d:"m6.077 19.316-.555-.832 4.844-3.229-4.887-4.071.641-.768 5.915 4.928zM12.7 18.2h7.8v1h-7.8zM2.5 5.5h26.9v1.9H2.5z"}]],html:[['path',{fill:"#e44f26",d:"M5.902 27.201 3.655 2h24.69l-2.25 25.197L15.985 30z"}],['path',{fill:"#f1662a",d:"m16 27.858 8.17-2.265 1.922-21.532H16z"}],['path',{fill:"#ebebeb",d:"M16 13.407h-4.09l-.282-3.165H16V7.151H8.25l.074.83.759 8.517H16zm0 8.027-.014.004-3.442-.929-.22-2.465H9.221l.433 4.852 6.332 1.758.014-.004z"}],['path',{fill:"#fff",d:"M15.989 13.407v3.091h3.806l-.358 4.009-3.448.93v3.216l6.337-1.757.046-.522.726-8.137.076-.83zm0-6.256v3.091h7.466l.062-.694.141-1.567.074-.83z"}]],css:[['path',{fill:"#639",d:"M1.995 1.994h23.52a4.48 4.48 0 0 1 4.48 4.48v19.04a4.48 4.48 0 0 1-4.48 4.48H6.475a4.48 4.48 0 0 1-4.48-4.48Z"}],['path',{fill:"#fff",d:"M9.079 24.87v-4.704c0-1.876 1.204-2.884 3.024-2.884 1.792-.028 2.912 1.148 2.856 3.136h-2.072c.056-.756-.28-1.316-.84-1.288-.7 0-.896.476-.896 1.372v4.088c0 .868.28 1.288.896 1.316.644 0 .896-.644.84-1.372h2.072c.112 2.044-1.176 3.248-2.996 3.22-1.764 0-2.884-.98-2.884-2.884m6.636-.336h1.932c.028.896.308 1.456.924 1.456s.84-.364.84-1.204c0-.7-.308-1.092-1.064-1.456l-.728-.336c-1.288-.616-1.82-1.372-1.82-2.884 0-1.68 1.064-2.856 2.8-2.856s2.66 1.204 2.688 3.164h-1.876c0-.812-.168-1.372-.784-1.372-.56 0-.84.28-.84.98s.252.98.924 1.26l.672.308c1.428.672 2.044 1.54 2.044 3.164 0 1.932-1.092 2.996-2.884 2.996s-2.8-1.232-2.828-3.22m6.328 0h1.96c0 .896.308 1.456.896 1.456s.84-.364.84-1.204c0-.7-.28-1.092-1.064-1.456l-.728-.336c-1.288-.616-1.792-1.372-1.792-2.884 0-1.68 1.036-2.856 2.8-2.856s2.632 1.204 2.688 3.164h-1.876c-.028-.812-.196-1.372-.812-1.372-.56 0-.812.28-.812.98s.224.98.896 1.26l.7.308c1.4.672 2.016 1.54 2.016 3.164 0 1.932-1.092 2.996-2.884 2.996s-2.8-1.232-2.828-3.22"}]],sass:[['path',{fill:"#cd6799",d:"M26.11 17.572a5.8 5.8 0 0 0-2.537.588 5.4 5.4 0 0 1-.568-1.314 3.5 3.5 0 0 1-.051-1.1 10 10 0 0 1 .332-1.192c-.005-.051-.061-.292-.624-.3s-1.048.107-1.1.256a6 6 0 0 0-.235.834 19.7 19.7 0 0 1-1.713 3.294 3.2 3.2 0 0 1-.44-2.066 10 10 0 0 1 .332-1.192c-.005-.051-.061-.292-.624-.3s-1.048.107-1.1.256-.118.5-.235.834-1.483 3.386-1.841 4.173c-.184.4-.343.726-.455.946a.2.2 0 0 1-.02.041l-.153.292v.005c-.077.138-.159.266-.2.266a1.7 1.7 0 0 1 .01-.869c.2-1.059.69-2.705.685-2.762 0-.031.092-.317-.317-.465a.51.51 0 0 0-.578.1c-.036 0-.061.087-.061.087s.445-1.851-.849-1.851a3.86 3.86 0 0 0-2.475 1.683c-.348.189-1.089.593-1.882 1.028-.3.169-.614.338-.905.5-.02-.02-.041-.046-.061-.066C6.87 17.6 3.975 16.416 4.1 14.171c.046-.818.327-2.966 5.559-5.575 4.306-2.122 7.733-1.534 8.326-.23.849 1.862-1.836 5.319-6.285 5.82a3.35 3.35 0 0 1-2.813-.711c-.235-.256-.271-.271-.358-.22-.143.077-.051.307 0 .44a2.63 2.63 0 0 0 1.606 1.263 8.55 8.55 0 0 0 5.217-.517c2.7-1.043 4.8-3.943 4.184-6.372-.619-2.465-4.71-3.278-8.582-1.9a19.5 19.5 0 0 0-6.595 3.783c-2.133 1.995-2.47 3.728-2.332 4.455.5 2.578 4.051 4.255 5.472 5.5l-.194.107c-.711.353-3.421 1.77-4.1 3.268-.767 1.7.123 2.915.711 3.079a4.37 4.37 0 0 0 4.71-1.908 4.72 4.72 0 0 0 .423-4.353.1.1 0 0 0-.02-.031l.557-.327a27 27 0 0 1 1.028-.578 6.7 6.7 0 0 0-.363 1.862 3.9 3.9 0 0 0 .834 2.7.92.92 0 0 0 .675.22c.6 0 .875-.5 1.176-1.094.368-.726.7-1.57.7-1.57s-.414 2.281.711 2.281c.409 0 .823-.532 1.008-.8v.005l.031-.051.066-.107v-.01c.164-.286.532-.936 1.079-2.015.706-1.391 1.386-3.13 1.386-3.13a9 9 0 0 0 .271 1.13 11 11 0 0 0 .583 1.309c-.164.23-.266.358-.266.358l.005.005c-.133.174-.276.363-.435.547a16 16 0 0 0-1.314 1.647.447.447 0 0 0 .123.6 1.1 1.1 0 0 0 .685.113 3.2 3.2 0 0 0 1.028-.235 3.5 3.5 0 0 0 .885-.465 1.98 1.98 0 0 0 .849-1.744 3.5 3.5 0 0 0-.322-1.233q.076-.107.148-.215a23 23 0 0 0 1.534-2.649 9 9 0 0 0 .271 1.13 7.6 7.6 0 0 0 .5 1.125 4.86 4.86 0 0 0-1.497 1.922c-.322.931-.072 1.35.4 1.447a1.4 1.4 0 0 0 .747-.153 3.4 3.4 0 0 0 .946-.486 2.13 2.13 0 0 0 1.043-1.729 3.3 3.3 0 0 0-.235-1.023 5.36 5.36 0 0 1 2.716-.312c2.434.286 2.915 1.805 2.823 2.445a1.62 1.62 0 0 1-.772 1.094c-.169.107-.225.143-.21.22.02.113.1.107.245.087A1.9 1.9 0 0 0 30 20.7c.077-1.5-1.355-3.145-3.887-3.13ZM7.33 23.9c-.808.88-1.933 1.212-2.419.931-.522-.3-.317-1.6.675-2.532a13 13 0 0 1 1.9-1.417c.118-.072.292-.174.5-.3l.056-.031.123-.077A3.49 3.49 0 0 1 7.33 23.9m5.881-4c-.281.685-.869 2.44-1.227 2.342-.307-.082-.5-1.412-.061-2.726a6.2 6.2 0 0 1 .956-1.754c.44-.491.926-.655 1.043-.455a9 9 0 0 1-.711 2.593m4.853 2.322c-.118.061-.23.1-.281.072-.036-.02.051-.1.051-.1s.609-.655.849-.951c.138-.174.3-.378.476-.609v.066c0 .782-.757 1.309-1.094 1.524Zm3.744-.854c-.087-.061-.072-.266.22-.905a3.4 3.4 0 0 1 .834-1.074 1.5 1.5 0 0 1 .082.471 1.55 1.55 0 0 1-1.135 1.509Z"}]],vue:[['path',{fill:"#41b883",d:"M24.4 3.925H30l-14 24.15L2 3.925h10.71l3.29 5.6 3.22-5.6Z"}],['path',{fill:"#41b883",d:"m2 3.925 14 24.15 14-24.15h-5.6L16 18.415 7.53 3.925Z"}],['path',{fill:"#35495e",d:"M7.53 3.925 16 18.485l8.4-14.56h-5.18L16 9.525l-3.29-5.6Z"}]],svg:[['path',{fill:"#ffb13b",stroke:"#000",d:"M7.674 14.488a2.218 2.218 0 1 0 0 3.137h16.652a2.218 2.218 0 1 0 0-3.137Z"}],['path',{fill:"#ffb13b",stroke:"#000",d:"M11.222 9.06A2.218 2.218 0 1 0 9 11.278l11.778 11.774A2.218 2.218 0 1 0 23 20.834Z"}],['path',{fill:"#ffb13b",stroke:"#000",d:"M17.568 7.73a2.218 2.218 0 1 0-3.137 0v16.652a2.218 2.218 0 1 0 3.137 0Z"}],['path',{fill:"#ffb13b",stroke:"#000",d:"M23 11.278a2.218 2.218 0 1 0-2.222-2.218L9 20.834a2.218 2.218 0 1 0 2.218 2.218Z"}],['path',{fill:"#ffb13b",d:"M7.674 14.488a2.218 2.218 0 1 0 0 3.137h16.652a2.218 2.218 0 1 0 0-3.137Z"}],['path',{fill:"#ffb13b",d:"M11.222 9.06A2.218 2.218 0 1 0 9 11.278l11.778 11.774A2.218 2.218 0 1 0 23 20.834Z"}],['path',{fill:"#ffb13b",d:"M17.568 7.73a2.218 2.218 0 1 0-3.137 0v16.652a2.218 2.218 0 1 0 3.137 0Z"}],['path',{fill:"#ffb13b",d:"M23 11.278a2.218 2.218 0 1 0-2.222-2.218L9 20.834a2.218 2.218 0 1 0 2.218 2.218Z"}],['path',{fill:"#fff",d:"M6.2 23.045a3.628 3.628 0 1 1 6.2-2.565h-2.13a1.5 1.5 0 1 0-2.57 1.061 1.6 1.6 0 0 0 1.062.441 4.12 4.12 0 0 1 2.566 1.063 3.628 3.628 0 1 1-6.194 2.565h2.13a1.5 1.5 0 1 0 2.566-1.06 1.95 1.95 0 0 0-1.063-.44A4.47 4.47 0 0 1 6.2 23.045m13.451-6.193L17.085 29.24H14.96L12.4 16.852h2.12l1.5 7.255 1.5-7.255Zm3.629 5.131h3.628v3.628a3.628 3.628 0 1 1-7.257 0V20.48a3.628 3.628 0 0 1 7.257 0h-2.125a1.5 1.5 0 1 0-3.005 0v5.13a1.5 1.5 0 0 0 3.005 0v-1.5h-1.5v-2.127Z"}]],image:[['path',{fill:"#2dcc9f",d:"M30 5.851v20.298H2V5.851z"}],['path',{fill:"#fff",d:"M24.232 8.541a2.2 2.2 0 1 0 1.127.623 2.2 2.2 0 0 0-1.127-.623M18.111 20.1q-2.724-3.788-5.45-7.575L4.579 23.766h10.9q1.316-1.832 2.634-3.663M22.057 16q-2.793 3.882-5.584 7.765h11.169Q24.851 19.882 22.057 16"}]],text:[['path',{fill:"#c2c2c2",d:"M22.038 2H6.375a1.755 1.755 0 0 0-1.75 1.75v24.5A1.755 1.755 0 0 0 6.375 30h19.25a1.755 1.755 0 0 0 1.75-1.75V6.856Zm.525 2.844 1.663 1.531h-1.663ZM6.375 28.25V3.75h14.438v4.375h4.813V28.25Z"}],['path',{fill:"#829ec2",d:"M8.125 15.097h13.076v1.75H8.125zm0 9.342h9.762v1.75H8.125zm0-4.676h15.75v1.75H8.125zm0-9.533h15.75v1.75H8.125z"}]],csv:[['path',{fill:"#91d290",d:"M22.038 2H6.375a1.755 1.755 0 0 0-1.75 1.75v24.5A1.755 1.755 0 0 0 6.375 30h19.25a1.755 1.755 0 0 0 1.75-1.75V6.856Zm.525 2.844 1.663 1.531h-1.663ZM6.375 28.25V3.75h14.438v4.375h4.813V28.25Z"}],['path',{fill:"#73b568",d:"M8.125 15.097h13.076v1.75H8.125zm0 9.342h9.762v1.75H8.125zm0-4.676h15.75v1.75H8.125zm0-9.533h15.75v1.75H8.125z"}]],sql:[['path',{fill:"#ffda44",d:"M8.562 15.256A21.2 21.2 0 0 0 16 16.449a21.2 21.2 0 0 0 7.438-1.194c1.864-.727 2.525-1.535 2.525-2V9.7a10.4 10.4 0 0 1-2.084 1.076A22.3 22.3 0 0 1 16 12.078a22.4 22.4 0 0 1-7.879-1.3A10.3 10.3 0 0 1 6.037 9.7v3.55c0 .474.663 1.278 2.525 2.006m0 6.705a15.6 15.6 0 0 0 2.6.741 25 25 0 0 0 4.838.453 25 25 0 0 0 4.838-.452 15.6 15.6 0 0 0 2.6-.741c1.864-.727 2.525-1.535 2.525-2v-3.39a10.7 10.7 0 0 1-1.692.825A23.5 23.5 0 0 1 16 18.74a23.5 23.5 0 0 1-8.271-1.348 11 11 0 0 1-1.692-.825v3.393c0 .466.663 1.271 2.525 2.001M16 30c5.5 0 9.963-1.744 9.963-3.894v-2.837a10.5 10.5 0 0 1-1.535.762l-.157.063A23.5 23.5 0 0 1 16 25.445a23.4 23.4 0 0 1-8.271-1.351l-.157-.063a10.5 10.5 0 0 1-1.535-.762v2.837C6.037 28.256 10.5 30 16 30"}],['ellipse',{cx:'16',cy:'5.894',fill:"#ffda44",rx:'9.963',ry:'3.894'}]],xml:[['path',{fill:"#f1662a",d:"m20.42 21.157 2.211 2.211L30 16l-7.369-7.369-2.211 2.212L25.58 16Zm-8.84-10.314L9.369 8.631 2 16l7.369 7.369 2.211-2.211L6.42 16Zm5.831-3.166 1.6.437-4.42 16.209-1.6-.437z"}]],toml:[['path',{fill:"#7f7f7f",d:"M22.76 6.83v3.25h-5v15.09h-3.5V10.08h-5V6.83Z"}],['path',{fill:"#bfbfbf",d:"M2 2h6.2v3.09H5.34v21.8H8.2V30H2Zm28 28h-6.2v-3.09h2.86V5.11H23.8V2H30Z"}]],dotenv:[['path',{fill:"#ecd53f",rule:'nonzero',d:"M30 2v28H2V2zM14.76 20.54H9.98v6.44h4.9v-1.09h-3.6v-1.75h3.23v-1.08h-3.23v-1.43h3.48zm2.5 0h-1.27v6.44h1.21v-4.2l2.6 4.2h1.3v-6.44h-1.2v4.3zm5.97 0h-1.41l2.3 6.44h1.39l2.3-6.44h-1.37l-1.58 4.76zM8.3 24.96H6.34v1.96H8.3z"}]],git:[['path',{fill:"#dd4c35",d:"M29.472 14.753 17.247 2.528a1.8 1.8 0 0 0-2.55 0l-2.539 2.539 3.22 3.22a2.141 2.141 0 0 1 2.712 2.73l3.1 3.1a2.143 2.143 0 1 1-1.285 1.21l-2.895-2.895v7.617a2.141 2.141 0 1 1-1.764-.062V12.3a2.146 2.146 0 0 1-1.165-2.814l-3.17-3.172L2.528 14.7a1.8 1.8 0 0 0 0 2.551l12.225 12.221a1.8 1.8 0 0 0 2.55 0L29.472 17.3a1.8 1.8 0 0 0 0-2.551"}],['path',{fill:"#fff",d:"m12.158 5.067 3.22 3.22a2.141 2.141 0 0 1 2.712 2.73l3.1 3.1a2.143 2.143 0 1 1-1.285 1.21l-2.895-2.895v7.617a2.141 2.141 0 1 1-1.764-.062V12.3a2.146 2.146 0 0 1-1.165-2.814l-3.17-3.172"}]],docker:[['path',{fill:"#3a4e55",d:"M18.191 13.071H20.7v2.566h1.27a5.5 5.5 0 0 0 1.744-.292 4.5 4.5 0 0 0 .848-.383 3.15 3.15 0 0 1-.589-1.623 3.43 3.43 0 0 1 .616-2.416l.264-.305.314.253a4 4 0 0 1 1.575 2.538 3.84 3.84 0 0 1 2.913.271l.345.2-.181.354a3.63 3.63 0 0 1-3.648 1.74c-2.173 5.413-6.9 7.976-12.642 7.976A7.96 7.96 0 0 1 6.3 20.211l-.025-.043-.226-.459a7.3 7.3 0 0 1-.579-3.693l.035-.38h2.143v-2.565h2.51v-2.51h5.02v-2.51h3.012v5.02Z"}],['path',{fill:"#00aada",d:"M26.324 14.021a3.31 3.31 0 0 0-1.418-2.821 3.07 3.07 0 0 0 .289 3.821 5.28 5.28 0 0 1-3.225 1.037H5.883a6.8 6.8 0 0 0 .667 3.737l.183.335a6 6 0 0 0 .379.569q.992.064 1.829.045a9 9 0 0 0 2.669-.389.193.193 0 1 1 .126.365q-.135.047-.281.088a8.4 8.4 0 0 1-1.845.3c.044 0-.046.007-.046.007l-.082.007a22 22 0 0 1-2.008-.006l-.01.007a7.88 7.88 0 0 0 6.063 2.41c5.56 0 10.276-2.465 12.365-8 1.482.152 2.906-.226 3.553-1.49a3.5 3.5 0 0 0-3.122-.022"}],['path',{fill:"#27b9ec",d:"M26.324 14.021a3.31 3.31 0 0 0-1.418-2.821 3.07 3.07 0 0 0 .289 3.821 5.28 5.28 0 0 1-3.225 1.037H6.836a5.22 5.22 0 0 0 2.106 4.686 9 9 0 0 0 2.669-.389.193.193 0 1 1 .126.365q-.135.047-.281.088a9 9 0 0 1-1.894.314l-.019-.022c1.892.971 4.636.967 7.782-.241a21.87 21.87 0 0 0 9.1-6.889l-.1.048"}],['path',{fill:"#088cb9",d:"M5.913 17.732a6.4 6.4 0 0 0 .637 2.061l.183.335a6 6 0 0 0 .379.569q.992.064 1.829.045a9 9 0 0 0 2.669-.389.193.193 0 1 1 .126.365q-.135.047-.281.088a8.8 8.8 0 0 1-1.891.307h-.1q-.438.025-.922.026c-.351 0-.709-.007-1.1-.026a7.9 7.9 0 0 0 6.076 2.413c4.76 0 8.9-1.807 11.3-5.8Z"}],['path',{fill:"#039cc7",d:"M6.98 17.732a4.83 4.83 0 0 0 1.961 3.01 9 9 0 0 0 2.669-.389.193.193 0 1 1 .126.365q-.135.047-.281.088a9 9 0 0 1-1.9.307c1.892.971 4.628.957 7.773-.252a20.6 20.6 0 0 0 5.377-3.13Z"}],['path',{fill:"#00acd3",d:"M9.889 13.671h.172v1.813h-.172zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813H9.23v-1.813Zm-.33 0h.179v1.813H8.9v-1.813Zm-.33 0h.179v1.813H8.57zm-.323 0h.172v1.813h-.17v-1.813Zm-.181-.181h2.175v2.176H8.066V13.49Zm4.335-2.329h.172v1.813H12.4zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813h-.179zm-.33 0h.178v1.813h-.178zm-.323 0h.172v1.813h-.172zm-.181-.181h2.176v2.176h-2.175z"}],['path',{fill:"#26c2ee",d:"M12.4 13.671h.172v1.813H12.4zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813h-.179zm-.33 0h.178v1.813h-.178zm-.323 0h.172v1.813h-.172zm-.181-.181h2.176v2.176h-2.175z"}],['path',{fill:"#00acd3",d:"M14.909 13.671h.172v1.813h-.172zm-.33 0h.179v1.813h-.178zm-.33 0h.179v1.813h-.178zm-.33 0h.181v1.813h-.179v-1.813Zm-.33 0h.179v1.813h-.179zm-.323 0h.172v1.813h-.172zm-.181-.181h2.176v2.176h-2.174V13.49Z"}],['path',{fill:"#26c2ee",d:"M14.909 11.161h.172v1.813h-.172zm-.33 0h.179v1.813h-.178zm-.33 0h.179v1.813h-.178zm-.33 0h.181v1.813h-.179v-1.813Zm-.33 0h.179v1.813h-.179zm-.323 0h.172v1.813h-.172zm-.181-.181h2.176v2.176h-2.174v-2.177Zm4.335 2.691h.172v1.813h-.172zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813H16.1zm-.323 0h.172v1.813h-.172zm-.177-.181h2.176v2.176H15.6z"}],['path',{fill:"#00acd3",d:"M17.42 11.161h.172v1.813h-.172zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813H16.1zm-.323 0h.172v1.813h-.172zm-.181-.181h2.176v2.176H15.6v-2.177Z"}],['path',{fill:"#26c2ee",d:"M17.42 8.65h.172v1.813h-.172zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813H16.1zm-.323 0h.172v1.813h-.172zm-.177-.181h2.176v2.176H15.6z"}],['path',{fill:"#00acd3",d:"M19.93 13.671h.17v1.813h-.17zm-.33 0h.178v1.813H19.6zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813h-.179zm-.33 0h.179v1.813h-.179zm-.323 0h.172v1.813h-.172zm-.181-.181h2.176v2.176h-2.175z"}],['path',{fill:"#d5eef2",d:"M12.616 19.193a.6.6 0 1 1-.6.6.6.6 0 0 1 .6-.6"}],['path',{fill:"#3a4e55",d:"M12.616 19.363a.4.4 0 0 1 .156.029.175.175 0 1 0 .241.236.43.43 0 1 1-.4-.265M2 17.949h27.92c-.608-.154-1.923-.362-1.707-1.159-1.105 1.279-3.771.9-4.444.267-.749 1.087-5.111.674-5.415-.173-.939 1.1-3.85 1.1-4.789 0-.3.847-4.666 1.26-5.415.173-.673.631-3.338 1.012-4.444-.267.217.8-1.1 1.005-1.707 1.159"}],['path',{fill:"#c0dbe1",d:"M14.211 23.518a5.3 5.3 0 0 1-2.756-2.711 9.2 9.2 0 0 1-1.987.3q-.436.024-.917.025-.554 0-1.168-.033a7.94 7.94 0 0 0 6.145 2.43q.344 0 .683-.013"}],['path',{fill:"#d5eef2",d:"M12.007 21.773a5.2 5.2 0 0 1-.552-.966 9.2 9.2 0 0 1-1.987.3 6.3 6.3 0 0 0 2.539.664"}]],java:[['path',{fill:"#5382a1",d:"M12.7 23.56s-1.07.622.761.833a16 16 0 0 0 5.8-.246 10 10 0 0 0 1.539.753c-5.481 2.349-12.405-.136-8.1-1.339m-.674-3.067s-1.2.888.633 1.078a22.6 22.6 0 0 0 7.481-.359 3.3 3.3 0 0 0 1.152.7c-6.627 1.938-14.009.153-9.266-1.421"}],['path',{fill:"#e76f00",d:"M17.673 15.294a2.05 2.05 0 0 1-.355 2.954s3.429-1.77 1.854-3.987c-1.471-2.067-2.6-3.095 3.508-6.636 0 0-9.586 2.394-5.007 7.669"}],['path',{fill:"#5382a1",d:"M24.922 25.827s.792.652-.872 1.157c-3.164.958-13.168 1.248-15.948.038-1-.435.874-1.038 1.464-1.164a3.8 3.8 0 0 1 .966-.108c-1.111-.783-7.181 1.537-3.083 2.2 11.176 1.812 20.372-.816 17.473-2.124m-11.711-8.508s-5.089 1.209-1.8 1.648a38 38 0 0 0 6.731-.072 53 53 0 0 0 4.221-.555 9 9 0 0 0-1.28.685c-5.17 1.358-15.153.726-12.283-.665a9.6 9.6 0 0 1 4.407-1.042m9.133 5.104c5.253-2.73 2.824-5.353 1.129-5a4 4 0 0 0-.6.161.96.96 0 0 1 .449-.346c3.354-1.179 5.933 3.478-1.083 5.322a.5.5 0 0 0 .106-.138"}],['path',{fill:"#e76f00",d:"M19.172 1.906s2.909 2.91-2.759 7.386c-4.546 3.59-1.037 5.637 0 7.975-2.653-2.394-4.6-4.5-3.294-6.463 1.917-2.879 7.229-4.275 6.056-8.9"}],['path',{fill:"#5382a1",d:"M13.727 29.818c5.042.323 12.786-.179 12.969-2.565 0 0-.353.9-4.167 1.623a41.5 41.5 0 0 1-12.76.2s.645.533 3.959.746"}]],c:[['path',{fill:"#005f91",d:"M10.676 15.973a10.05 10.05 0 0 0 1.175 5.151 5.446 5.446 0 0 0 6.306 2.408 4.28 4.28 0 0 0 3.09-3.6l.109-.61c1.737.251 4.537.658 6.274.906l-.11.44a11.26 11.26 0 0 1-2.7 5.39 9.44 9.44 0 0 1-5.366 2.688 14.6 14.6 0 0 1-8.277-.819 10.15 10.15 0 0 1-5.777-6.24 16.23 16.23 0 0 1 .019-11.45 10.54 10.54 0 0 1 8.963-7.054 13.35 13.35 0 0 1 6.666.555 9.57 9.57 0 0 1 6.167 6.9c.094.352.114.417.114.417-1.932.351-4.319.8-6.238 1.215-.362-1.915-1.265-3.428-3.2-3.9a5.263 5.263 0 0 0-6.616 3.57 10.5 10.5 0 0 0-.385 1.439 12.3 12.3 0 0 0-.214 2.594"}]],cheader:[['path',{fill:"#005f91",d:"M6.97 29V3h5.2v8.52c1.45-1.73 3.61-2.6 6.21-2.6 2.17 0 4.05.72 5.2 2.17 1.01 1.3 1.45 3.18 1.45 6.07V29h-5.2V18.02q0-2.38-.87-3.46c-.58-.73-1.59-1.02-2.74-1.02-1.3 0-2.46.44-3.18 1.3-.58.73-.87 2.03-.87 3.76V29Z"}]],cpp:[['path',{fill:"#984c93",d:"M14.742 24.047a10.24 10.24 0 0 1-4.673.919 7.63 7.63 0 0 1-5.914-2.346A8.88 8.88 0 0 1 2 16.369a9.48 9.48 0 0 1 2.422-6.748 8.22 8.22 0 0 1 6.285-2.588 11.2 11.2 0 0 1 4.035.641v3.761A6.84 6.84 0 0 0 11 10.395a4.81 4.81 0 0 0-3.712 1.535 5.9 5.9 0 0 0-1.413 4.159A5.8 5.8 0 0 0 7.209 20.1a4.57 4.57 0 0 0 3.59 1.493 7.3 7.3 0 0 0 3.943-1.113Zm2.37-9.218v-2.344h2.344v2.344H21.8v2.343h-2.344v2.343h-2.344v-2.343H14.77v-2.344zm8.201 0v-2.344h2.344v2.344H30v2.343h-2.343v2.343h-2.344v-2.343h-2.342v-2.344z"}]],php:[['path',{fill:"#fff",d:"m18.725 18.2.667-3.434a1.75 1.75 0 0 0-.372-1.719 2.93 2.93 0 0 0-2-.525h-1.153l.331-1.7a.22.22 0 0 0-.215-.26h-1.6a.22.22 0 0 0-.215.177l-.709 3.646a2.05 2.05 0 0 0-.477-1.054 2.78 2.78 0 0 0-2.2-.807H7.7a.22.22 0 0 0-.215.177l-1.434 7.38a.22.22 0 0 0 .215.26h1.603a.22.22 0 0 0 .215-.177l.347-1.785h1.2a5.2 5.2 0 0 0 1.568-.2 3.1 3.1 0 0 0 1.15-.689 3.5 3.5 0 0 0 .68-.844l-.287 1.475a.22.22 0 0 0 .215.26h1.6a.22.22 0 0 0 .215-.177l.787-4.051h1.094c.466 0 .6.093.64.133s.1.165.025.569l-.635 3.265a.22.22 0 0 0 .215.26h1.62a.22.22 0 0 0 .207-.18m-7.395-2.834a1.75 1.75 0 0 1-.561 1.092 2.17 2.17 0 0 1-1.315.321h-.712l.515-2.651h.921c.677 0 .949.145 1.059.266a1.18 1.18 0 0 1 .093.972m14.216-2.034a2.78 2.78 0 0 0-2.2-.807h-3.091a.22.22 0 0 0-.215.177l-1.434 7.38a.22.22 0 0 0 .215.26h1.608a.22.22 0 0 0 .215-.177l.347-1.785h1.2a5.2 5.2 0 0 0 1.568-.2 3.1 3.1 0 0 0 1.15-.689 3.43 3.43 0 0 0 1.076-1.927 2.51 2.51 0 0 0-.439-2.232m-1.667 2.034a1.75 1.75 0 0 1-.561 1.092 2.17 2.17 0 0 1-1.318.32h-.71l.515-2.651h.921c.677 0 .949.145 1.059.266a1.18 1.18 0 0 1 .094.973"}],['path',{fill:"#000004",d:"M10.178 13.908a1.65 1.65 0 0 1 1.221.338 1.34 1.34 0 0 1 .145 1.161 1.95 1.95 0 0 1-.642 1.223 2.36 2.36 0 0 1-1.448.37h-.978l.6-3.089Zm-3.917 6.216h1.608l.381-1.962h1.377a5 5 0 0 0 1.5-.191 2.84 2.84 0 0 0 1.07-.642 3.2 3.2 0 0 0 1.01-1.808 2.3 2.3 0 0 0-.385-2.044 2.57 2.57 0 0 0-2.035-.732H7.7Zm8.126-9.342h1.6l-.387 1.962h1.421a2.77 2.77 0 0 1 1.85.468 1.55 1.55 0 0 1 .305 1.516l-.667 3.434H16.89l.635-3.265a.89.89 0 0 0-.08-.76 1.12 1.12 0 0 0-.8-.2H15.37l-.822 4.228h-1.6Zm8.34 3.126a1.65 1.65 0 0 1 1.221.338 1.34 1.34 0 0 1 .145 1.161 1.95 1.95 0 0 1-.642 1.223A2.36 2.36 0 0 1 22 17h-.978l.6-3.089Zm-3.917 6.216h1.608l.381-1.962h1.377a5 5 0 0 0 1.5-.191 2.84 2.84 0 0 0 1.07-.642 3.2 3.2 0 0 0 1.01-1.808 2.3 2.3 0 0 0-.385-2.044 2.57 2.57 0 0 0-2.035-.732h-3.092Z"}],['ellipse',{cx:'16',cy:'16',fill:"#fff",rx:'14',ry:'7.365'}],['ellipse',{cx:'16',cy:'16',fill:"#6280b6",rx:'13.453',ry:'6.818'}]],ruby:[['path',{fill:"#fb7655",d:"M23.693 20.469 7.707 29.961l20.7-1.4L30 7.685Z"}],['path',{fill:"#871101",d:"m28.44 28.542-1.779-12.279-4.846 6.4Z"}],['path',{fill:"#fff",d:"M28.464 28.542 15.43 27.519l-7.654 2.415Z"}],['path',{fill:"#808080",d:"M7.794 29.937 11.05 19.27 3.885 20.8Z"}],['path',{fill:"#fff",d:"m21.813 22.7-3-11.735L10.243 19Z"}],['path',{fill:"#fff",d:"m29.32 11.127-8.1-6.619-2.257 7.3Z"}],['path',{fill:"#fff",d:"m25.53 2.148-4.767 2.634-3.007-2.67Z"}],['path',{fill:"#fff",d:"m2 24.38 2-3.642L2.382 16.4Z"}],['path',{fill:"#fff",d:"m2.274 16.263 1.626 4.61 7.062-1.584 8.062-7.489L21.3 4.569l-3.583-2.53-6.091 2.28C9.706 6.1 5.982 9.635 5.848 9.7s-2.459 4.464-3.574 6.562Z"}],['path',{fill:"#bd0012",d:"M7.981 7.981C12.14 3.858 17.5 1.421 19.559 3.5s-.124 7.121-4.283 11.244-9.455 6.69-11.511 4.614.057-7.258 4.216-11.377"}],['path',{fill:"#8c0c01",d:"m7.794 29.933 3.231-10.7 10.729 3.447c-3.879 3.638-8.194 6.713-13.96 7.254Z"}],['path',{fill:"#7e110b",d:"m19.038 11.774 2.754 10.91c3.24-3.407 6.149-7.07 7.573-11.6z"}],['path',{fill:"#79130d",d:"M29.337 11.139c1.1-3.327 1.357-8.1-3.841-8.985l-4.265 2.355z"}],['path',{fill:"#9e1209",d:"M2 24.332c.153 5.49 4.114 5.572 5.8 5.62l-3.9-9.1z"}],['path',{fill:"#a80d00",d:"M19.053 11.791c2.49 1.531 7.509 4.6 7.61 4.661a17.6 17.6 0 0 0 2.619-5.343z"}],['path',{fill:"#a30c00",d:"m11.021 19.232 4.319 8.332a28 28 0 0 0 6.385-4.88l-10.7-3.452Z"}],['path',{fill:"#8b2114",d:"m3.887 20.861-.612 7.287c1.155 1.577 2.743 1.714 4.409 1.591-1.205-3-3.614-9-3.8-8.878Z"}],['path',{fill:"#b31000",d:"m21.206 4.528 8.58 1.2c-.458-1.94-1.864-3.192-4.261-3.584l-4.319 2.38Z"}]],swift:[['path',{fill:"#f88535",d:"M19.422 4.007s6.217 3.554 7.844 9.2c1.466 5.1.292 7.534.292 7.534a8.9 8.9 0 0 1 1.742 2.8 4.83 4.83 0 0 1 .29 4.453s-.1-2.08-3.2-2.511c-2.841-.4-3.874 2.366-9.3 2.232A18.43 18.43 0 0 1 2 19.354C4.651 20.8 8.124 23.045 12.449 22.7s5.228-1.674 5.228-1.674A67 67 0 0 1 4.891 7.643c3.4 2.845 11.822 8.507 11.626 8.363A76 76 0 0 1 8.092 6.24s12.636 10.389 13.653 10.323c.418-.861 2.579-5.318-2.324-12.557Z"}]],pdf:[['path',{stroke:"#000",d:"M9.064 3.162h11.6a31.5 31.5 0 0 1 7.524 7.538v17.842H9.064Z",transform:"translate(.03 .3)"}],['path',{fill:"#fff",d:"M9.064 3.162h11.6a31.5 31.5 0 0 1 7.524 7.538v17.842H9.064Z"}],['path',{stroke:"#c8c8c8",d:"M9.064 3.162h11.6a31.5 31.5 0 0 1 7.524 7.538v17.842H9.064Z"}],['path',{fill:"#fff",d:"M20.662 3.162a31.8 31.8 0 0 1 7.526 7.538 6.77 6.77 0 0 0-5.332-2.03 6.03 6.03 0 0 0-2.194-5.508"}],['path',{stroke:"#c8c8c8",d:"M20.662 3.162a31.8 31.8 0 0 1 7.526 7.538 6.77 6.77 0 0 0-5.332-2.03 6.03 6.03 0 0 0-2.194-5.508Z"}],['path',{stroke:"#c8c8c8",d:"M5.339 6.496h14.1v2.7h-14.1z"}],['path',{fill:"#f91d0a",d:"M15.819 19.855c.466-.914 1-1.943 1.42-2.977l.168-.408c-.554-2.108-.886-3.8-.589-4.894a.755.755 0 0 1 .763-.458h.254c.484-.007.711.608.737.847a4 4 0 0 1-.141 1.072 2.6 2.6 0 0 0-.161-1.091c-.2-.439-.391-.7-.562-.743a.54.54 0 0 0-.2.407 6 6 0 0 0-.077.939 10.5 10.5 0 0 0 .433 2.729q.08-.235.14-.447c.059-.222.433-1.691.433-1.691s-.094 1.956-.226 2.547q-.042.187-.092.375a8.6 8.6 0 0 0 2.145 3.351 6.7 6.7 0 0 0 1.24.852 17 17 0 0 1 2.517-.189 3.15 3.15 0 0 1 1.938.433.74.74 0 0 1 .213.484 1.5 1.5 0 0 1-.041.282c.01-.051.01-.3-.755-.546a8.9 8.9 0 0 0-3.086-.043c1.566.766 3.093 1.147 3.576.919a1 1 0 0 0 .262-.254 2.7 2.7 0 0 1-.146.484.76.76 0 0 1-.377.258c-.764.2-2.752-.268-4.485-1.258a36.6 36.6 0 0 0-5.768 1.371c-1.675 2.936-2.935 4.284-3.959 3.771l-.377-.189a.44.44 0 0 1-.141-.474c.119-.584.852-1.465 2.324-2.344.158-.1.864-.469.864-.469s-.523.506-.645.605c-1.175.963-2.042 2.174-2.021 2.644v.041c1-.142 2.495-2.174 4.419-5.939m.61.312a78 78 0 0 1-.926 1.682 24.6 24.6 0 0 1 4.975-1.408 8 8 0 0 1-.637-.485 8.5 8.5 0 0 1-2.1-2.729 23 23 0 0 1-1.317 2.94"}],['path',{fill:"#8a0000",d:"M3.75 4.968h17.264v5.803H3.75z"}],['path',{fill:"#5e0000",d:"M21.343 11.119H3.437V4.62h17.906ZM20.7 5.264H4.081v5.209H20.7Z"}],['path',{fill:"#fff9f9",d:"M8.262 5.819h1.256a1.1 1.1 0 0 1 .859.331 1.34 1.34 0 0 1 .3.937 1.35 1.35 0 0 1-.3.942 1.1 1.1 0 0 1-.859.328h-.5v1.349h-.756zm.757.726v1.086h.419a.42.42 0 0 0 .34-.141.6.6 0 0 0 .12-.4.6.6 0 0 0-.12-.4.42.42 0 0 0-.34-.141h-.419m2.949.031v2.369h.271a.85.85 0 0 0 .708-.3 1.38 1.38 0 0 0 .246-.885 1.38 1.38 0 0 0-.244-.88.86.86 0 0 0-.71-.3h-.271m-.757-.758h.8a2.9 2.9 0 0 1 .989.121 1.3 1.3 0 0 1 .562.427 1.8 1.8 0 0 1 .307.607 2.8 2.8 0 0 1 .1.779 2.8 2.8 0 0 1-.1.786 1.8 1.8 0 0 1-.307.607 1.3 1.3 0 0 1-.566.43 3 3 0 0 1-.991.125h-.8V5.819m3.342 0H16.6v.758h-1.29V7.3h1.209v.758H15.31v1.648h-.757V5.819"}]],zip:[['path',{fill:"#c09553",d:"M27.667 27.667V17.333L23 15V2H4.333v28h23.334Zm-4.667 0v-9.111l2.333 1.222v7.889Z"}],['path',{fill:"#4d4d4d",d:"M17.65 25.559h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M17.65 23.26h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M17.65 20.96h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M17.65 18.66h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M17.65 16.36h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M17.65 14.06h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M17.65 11.76h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M17.65 9.461h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M17.65 7.161h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M16.237 26.721h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M16.237 24.421h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M16.237 22.121h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M16.237 19.821h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M16.237 17.522h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M17.65 27.859h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M16.237 15.222h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M16.237 12.922h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M16.237 10.622h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M16.237 8.322h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M16.237 29.018h3.45v.993h-3.45z"}],['path',{fill:"#808080",d:"M20.1 5.911a.554.554 0 0 0-.548-.53h-.009v.557h.092l.206 2.514h-2.252l.211-2.514h.094v-.557h-.044a.55.55 0 0 0-.547.53l-.314 10.569a.513.513 0 0 0 .515.531h2.432a.51.51 0 0 0 .513-.531Zm-1.384 10.5a1.171 1.171 0 1 1 1.171-1.171 1.17 1.17 0 0 1-1.171 1.168Z"}],['path',{fill:"#808080",d:"M18.096 3.802h1.24v3.054h-1.24z"}],['path',{fill:"#808080",d:"M21.4 4.56a2.55 2.55 0 0 0-2.549-2.549h-.276a2.55 2.55 0 0 0-2.436 3.3v.006a8 8 0 0 1 .261 2.561 1.8 1.8 0 0 0 .641 1.271l.109-3.441a.593.593 0 0 1 .6-.551h.135v-1.57h1.653v1.57h.1a.6.6 0 0 1 .605.551l.121 3.462a1.8 1.8 0 0 0 .666-1.292V7.72a7.7 7.7 0 0 1 .236-2.359 2.5 2.5 0 0 0 .134-.801"}]],npm:[['path',{fill:"#c12127",d:"M2 2h28v28H2"}],['path',{fill:"#fff",d:"M7.25 7.25h17.5v17.5h-3.5v-14H16v14H7.25"}]],node:[['path',{fill:"#83cd29",d:"M16 30a2.15 2.15 0 0 1-1.076-.288L11.5 27.685c-.511-.286-.262-.387-.093-.446a6.8 6.8 0 0 0 1.549-.7.26.26 0 0 1 .255.019l2.631 1.563a.34.34 0 0 0 .318 0l10.26-5.922a.32.32 0 0 0 .157-.278V10.075a.33.33 0 0 0-.159-.283l-10.26-5.917a.32.32 0 0 0-.317 0L5.587 9.794a.33.33 0 0 0-.162.281v11.841a.32.32 0 0 0 .161.274L8.4 23.814c1.525.762 2.459-.136 2.459-1.038V11.085a.3.3 0 0 1 .3-.3h1.3a.3.3 0 0 1 .3.3v11.692c0 2.035-1.108 3.2-3.038 3.2a4.4 4.4 0 0 1-2.363-.642l-2.697-1.547a2.17 2.17 0 0 1-1.076-1.872V10.075A2.16 2.16 0 0 1 4.661 8.2l10.261-5.924a2.25 2.25 0 0 1 2.156 0L27.338 8.2a2.17 2.17 0 0 1 1.077 1.87v11.846a2.17 2.17 0 0 1-1.077 1.872l-10.26 5.924A2.15 2.15 0 0 1 16 30"}],['path',{fill:"#83cd29",d:"M14.054 17.953a.3.3 0 0 1 .3-.3h1.327a.3.3 0 0 1 .295.251c.2 1.351.8 2.032 3.513 2.032 2.161 0 3.082-.489 3.082-1.636 0-.661-.261-1.152-3.62-1.481-2.808-.278-4.544-.9-4.544-3.144 0-2.07 1.745-3.305 4.67-3.305 3.287 0 4.914 1.141 5.12 3.589a.3.3 0 0 1-.295.323h-1.336a.3.3 0 0 1-.288-.232c-.319-1.421-1.1-1.875-3.2-1.875-2.36 0-2.634.822-2.634 1.438 0 .746.324.964 3.51 1.385 3.153.417 4.651 1.007 4.651 3.223 0 2.236-1.864 3.516-5.115 3.516-4.495.006-5.436-2.055-5.436-3.784"}]],eslint:[['path',{fill:"#4b32c3",d:"m29.832 16.7-6.354 10.717A1.26 1.26 0 0 1 22.36 28H9.647a1.26 1.26 0 0 1-1.118-.59l-6.356-10.7a1.26 1.26 0 0 1 0-1.272L8.527 4.676A1.34 1.34 0 0 1 9.647 4h12.709a1.34 1.34 0 0 1 1.118.678l6.354 10.786a1.2 1.2 0 0 1 0 1.238Zm-5.262 4.2v-9.614L16 6.466l-8.56 4.82V20.9L16 25.719Z"}],['path',{fill:"#8080f2",d:"m21.802 19.188-5.747 3.235-5.742-3.235v-6.47l5.742-3.236 5.747 3.236z"}]],prettier:[['path',{stroke:"#56b3b4",d:"M2.45 2.45h16.3M2.45 7.87h9.48m10.8 0h1.35m-16.3 2.71h1.35M13.19 16h10.8m-21.7 2.71h5.42m-5.42 8.13H5"}],['path',{stroke:"#ea5e5e",d:"M2.45 5.16h4.06m12.2 5.42h6.77M2.48 16h1.35m6.77 2.71h5.42m-13.5 10.8h6.77"}],['path',{stroke:"#f7b93e",d:"M9.23 5.16h13.5m-20.3 5.42h2.71m13.5 2.71h6.77M6.41 16h4.06m-4.06 5.42h12.2m-10.8 5.42h1.35"}],['path',{stroke:"#bf85bf",d:"M14.6 7.87h5.42m-17.6 5.42h6.77m9.48 5.42h4.06m-20.3 2.71h1.35m-1.35 2.71H9.2"}],['path',{stroke:"#4d616e",d:"M21.4 2.45h8.13m-4.06 2.71h4.06m-2.71 2.71h2.71m-17.6 2.71h4.06m12.2 0h1.35m-17.6 2.71H16m12.2 0h1.35M26.84 16h2.71m-4.06 2.71h4.06m-8.13 2.71h2.71m2.71 0h2.71m-17.6 2.71h2.71m2.71 0h12.2m-17.6 2.71h5.42m2.71 0h1.35m2.71 0h5.42m-17.6 2.71h8.13m2.71 0h6.77"}]],pnpm:[['path',{fill:"#f9ad00",d:"M30 10.75h-8.749V2H30Zm-9.626 0h-8.75V2h8.75Zm-9.625 0H2V2h8.749ZM30 20.375h-8.749v-8.75H30Z"}],['path',{fill:"#fff",d:"M20.374 20.375h-8.75v-8.75h8.75Zm0 9.625h-8.75v-8.75h8.75ZM30 30h-8.749v-8.75H30Zm-19.251 0H2v-8.75h8.749Z"}]],yarn:[['path',{fill:"#2188b6",d:"M28.208 24.409a10.5 10.5 0 0 0-3.959 1.822 23.7 23.7 0 0 1-5.835 2.642 1.63 1.63 0 0 1-.983.55 62 62 0 0 1-6.447.577c-1.163.009-1.876-.3-2.074-.776a1.573 1.573 0 0 1 .866-2.074 4 4 0 0 1-.514-.379c-.171-.171-.352-.514-.406-.388-.225.55-.343 1.894-.947 2.5-.83.839-2.4.559-3.328.072-1.019-.541.072-1.813.072-1.813a.73.73 0 0 1-.992-.343 4.85 4.85 0 0 1-.667-2.949 5.37 5.37 0 0 1 1.749-2.895 9.3 9.3 0 0 1 .658-4.4 10.45 10.45 0 0 1 3.165-3.661S6.628 10.747 7.35 8.817c.469-1.262.658-1.253.812-1.308a3.6 3.6 0 0 0 1.452-.857 5.27 5.27 0 0 1 4.41-1.7S15.2 1.4 16.277 2.09a18.4 18.4 0 0 1 1.533 2.886s1.281-.748 1.425-.469a11.33 11.33 0 0 1 .523 6.132 14 14 0 0 1-2.6 5.411c-.135.225 1.551.938 2.615 3.887.983 2.7.108 4.96.262 5.212.027.045.036.063.036.063s1.127.09 3.391-1.308a8.5 8.5 0 0 1 4.277-1.604 1.081 1.081 0 0 1 .469 2.11Z"}]],claude:[['path',{fill:"#d97757",d:"m7.5 20.61 5.5-3.08.1-.27-.1-.15h-.27l-.92-.06a234 234 0 0 1-8.51-.34l-.67-.14-.62-.82.06-.41.56-.38.8.07c3.08.2 6.15.4 9.21.72h.46l.06-.19-.16-.1-.12-.12-2.74-1.86c-2.04-1.3-3.55-2.43-5.38-3.68l-.43-.54-.18-1.18.76-.84 1.03.07.26.07c2.03 1.6 4.1 3.14 6.17 4.66l.43.36.17-.12.02-.09-.2-.32c-1.43-2.6-2.55-4.62-4-6.96l-.2-.72c-.08-.3-.13-.55-.13-.85l.87-1.18.49-.16 1.16.16.49.42c1.4 3.31 2.76 5.93 4.23 8.83l.29.97.1.3h.19v-.17c.65-3.42 0-6.57 1.22-9.53l.87-.57.68.33.56.8-.08.51c-.37 2.62-.92 5.22-1.4 7.82h.24l.29-.29a69 69 0 0 1 4.91-5.94l.64-.5h1.2l.89 1.32-.4 1.36a53.5 53.5 0 0 0-4.66 6.47l.09.13.22-.02c2.4-.57 4.84-.99 7.27-1.4l.97.45.1.46-.37.94c-3 .72-6 1.34-9 2.05l-.05.04.06.07c2.7.26 5.62.3 7.99.47l.92.61.55.75-.1.56-1.4.73c-2.93-.7-5.19-1.22-7.91-1.9h-.22v.13c2.18 2.12 4.6 4.27 6.54 6.07l.15.68-.38.53-.4-.06c-2.04-1.43-3.9-3.09-5.8-4.7h-.15v.2l.52.76c1.14 1.79 2.64 3.25 2.87 5.37l-.2.41-.7.25-.78-.14a73 73 0 0 1-4.58-7.04l-.17.09-.78 8.46-.37.43-.85.33-.71-.54-.38-.87a114 114 0 0 0 1.53-7.97l.2-.73-.01-.05-.16.02a77 77 0 0 1-6.23 7.88l-.48.2-.84-.44.08-.77.47-.69c2.07-2.57 3.54-4.66 5.54-7v-.19h-.07l-7.4 4.8-1.31.17-.57-.53.07-.87.27-.28 2.23-1.53z"}]],default_file:[['path',{fill:"#c5c5c5",d:"M20.414 2H5v28h22V8.586ZM7 28V4h12v6h6v18Z"}]]};

    function iconForPath(path) {
      const base = (path.split('/').pop() ?? '').toLowerCase();
      if (base === 'package.json' || base === 'npm-shrinkwrap.json') return 'npm';
      if (base === 'package-lock.json') return 'json';
      if (base.startsWith('pnpm-lock')) return 'pnpm';
      if (base === 'yarn.lock') return 'yarn';
      if (base === 'dockerfile' || base.endsWith('.dockerfile')) return 'docker';
      if (base.startsWith('readme')) return 'markdown';
      if (base.startsWith('license') || base.startsWith('copying')) return 'text';
      if (base === '.eslintrc' || base.startsWith('.eslintrc') || base.startsWith('eslint.config')) return 'eslint';
      if (base === '.prettierrc' || base.startsWith('.prettierrc') || base.startsWith('prettier.config')) return 'prettier';
      if (base.startsWith('.env')) return 'dotenv';
      if (base === '.gitignore' || base === '.gitattributes' || base === '.gitmodules') return 'git';
      if (base.startsWith('claude.')) return 'claude';
      const dot = base.lastIndexOf('.');
      if (dot <= 0) return 'default_file';
      const ext = base.slice(dot + 1);
      switch (ext) {
        case 'ts': case 'tsx': case 'mts': case 'cts': return 'typescript';
        case 'js': case 'jsx': case 'mjs': case 'cjs': return 'js';
        case 'json': case 'jsonc': case 'json5': case 'webmanifest': return 'json';
        case 'md': case 'markdown': case 'mdx': return 'markdown';
        case 'yaml': case 'yml': return 'yaml';
        case 'py': case 'pyi': case 'python': return 'python';
        case 'go': return 'go';
        case 'rs': return 'rust';
        case 'sh': case 'bash': case 'zsh': return 'shell';
        case 'html': case 'htm': case 'svelte': case 'ejs': return 'html';
        case 'css': return 'css';
        case 'scss': case 'sass': case 'less': return 'sass';
        case 'vue': return 'vue';
        case 'svg': return 'svg';
        case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'ico': case 'bmp': case 'avif': return 'image';
        case 'txt': case 'log': case 'text': return 'text';
        case 'csv': case 'tsv': return 'csv';
        case 'sql': case 'sqlite': case 'db': return 'sql';
        case 'xml': case 'plist': case 'xhtml': return 'xml';
        case 'toml': return 'toml';
        case 'java': case 'class': case 'jar': return 'java';
        case 'c': return 'c';
        case 'h': return 'cheader';
        case 'cc': case 'cpp': case 'cxx': case 'hpp': case 'hh': case 'hxx': return 'cpp';
        case 'php': return 'php';
        case 'rb': case 'ruby': case 'gemspec': return 'ruby';
        case 'swift': return 'swift';
        case 'pdf': return 'pdf';
        case 'zip': case 'gz': case 'tar': case 'tgz': case '7z': case 'rar': return 'zip';
        case 'node': return 'node';
        case 'git': return 'git';
        default: return 'default_file';
      }
    }

    function fileIconGlyph(path, untracked) {
      const name = iconForPath(path);
      const shapes = FILE_ICONS[name] ?? FILE_ICONS.default_file;
      return h('svg', {
        viewBox: '0 0 32 32', width: 16, height: 16, className: 'jb-fileicon' + (untracked ? ' jb-fileicon-gray' : ''), 'aria-hidden': true,
      }, shapes.map(([tag, attrs], index) => h(tag, { key: index, ...attrs })));
    }


    // ------------------------------------------------------------- utils
    function fmtDate(iso) {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const now = new Date();
      if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      }
      const sameYear = d.getFullYear() === now.getFullYear();
      return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function fmtDateTime(iso) {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    async function api(path, options = {}) {
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      const response = await fetch(path, {
        method: options.method ?? 'GET',
        signal: options.signal,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body,
      });
      let data = null;
      try { data = await response.json(); } catch { /* non-JSON */ }
      if (!response.ok) throw Object.assign(new Error(data && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`), { code: data?.code });
      return data;
    }

    // ------------------------------------------------------------- icons
    const LU = {
      s: { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
      branch: [h('path', { d: 'M15 6a9 9 0 0 0-9 9V3' }), h('circle', { cx: 18, cy: 6, r: 3 }), h('circle', { cx: 6, cy: 18, r: 3 })],
      folder: [h('path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' })],
      refresh: [h('path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }), h('path', { d: 'M21 3v5h-5' }), h('path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }), h('path', { d: 'M8 16H3v5' })],
      chevron: [h('path', { d: 'm9 18 6-6-6-6' })],
      search: [h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'm21 21-4.3-4.3' })],
    };
    const lucideSvg = (paths, size) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, ...LU.s }, ...paths);
    function branchGlyph(size) { return lucideSvg(LU.branch, size ?? 15); }
    function toolGlyph(tool) {
      const path = d => h('path', { d });
      const icons = {
        find: LU.search,
        changes: LU.branch,
        log: [path('M3 12a9 9 0 1 0 3-6.7L3 8'), path('M3 3v5h5M12 7v5l3 2')],
        // Two stacked cards: a foreground card and the sheet behind it.
        cards: [h('rect', { x: 8, y: 3, width: 12, height: 12, rx: 2 }), path('M5 8v9a3 3 0 0 0 3 3h9')],
        debug: [path('M8 7 6 3m10 4 2-4M3 13h4m10 0h4M3 7l4 3m10 0 4-3M3 19l4-3m10 0 4 3'), h('rect', { x: 7, y: 6, width: 10, height: 15, rx: 5 }), path('M12 6v15M7 11h10')],
        terminal: [h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), path('m7 9 3 3-3 3m6 0h4')],
      };
      return lucideSvg(icons[tool], 18);
    }

    function folderGlyph(size) { return lucideSvg(LU.folder, size ?? 15); }
    function refreshGlyph(size) { return lucideSvg(LU.refresh, size ?? 15); }
    function chevronGlyph(size) { return lucideSvg(LU.chevron, size ?? 12); }
    function searchGlyph(size) { return lucideSvg(LU.search, size ?? 14); }

    // ------------------------------------------------------------- data
    function buildTree(entries) {
      const root = { name: '', children: [], files: [] };
      for (const entry of entries) {
        const parts = entry.path.split('/');
        let node = root;
        for (let i = 0; i < parts.length - 1; i++) {
          let child = node.children.find((c) => c.name === parts[i]);
          if (!child) { child = { name: parts[i], children: [], files: [] }; node.children.push(child); }
          node = child;
        }
        node.files.push(entry);
      }
      const sortNode = (node) => {
        node.children.sort((a, b) => a.name.localeCompare(b.name));
        node.files.sort((a, b) => a.path.localeCompare(b.path));
        for (const child of node.children) sortNode(child);
      };
      sortNode(root);
      return root;
    }

    /** Parse a unified diff into numbered lines (old/new line numbers). */
    function parseDiff(text, untracked) {
      const lines = [];
      if (untracked) {
        const content = text.replace(/\n$/, '');
        const parts = content.split('\n');
        for (let i = 0; i < parts.length; i++) lines.push({ kind: 'add', old: null, new: i + 1, text: parts[i] });
        return lines;
      }
      let oldN = 0;
      let newN = 0;
      for (const raw of text.split('\n')) {
        if (raw.startsWith('@@')) {
          const match = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
          if (match) { oldN = Number(match[1]); newN = Number(match[3]); }
          lines.push({ kind: 'hunk', old: null, new: null, text: raw });
        } else if (raw.startsWith('+++') || raw.startsWith('---')) {
          lines.push({ kind: 'file', old: null, new: null, text: raw });
        } else if (raw.startsWith('+')) {
          lines.push({ kind: 'add', old: null, new: newN++, text: raw });
        } else if (raw.startsWith('-')) {
          lines.push({ kind: 'del', old: oldN++, new: null, text: raw });
        } else if (raw.startsWith('\\')) {
          lines.push({ kind: 'meta', old: null, new: null, text: raw });
        } else {
          lines.push({ kind: 'ctx', old: oldN++, new: newN++, text: raw });
        }
      }
      return lines;
    }

    /** Lane-based commit graph for the Log tab. */
    function buildGraph(commits) {
      let lanes = [];
      const rows = [];
      for (const commit of commits) {
        const parents = commit.parents ?? [];
        let ci = lanes.indexOf(commit.hash);
        if (ci === -1) ci = lanes.length;
        const next = lanes.slice();
        next[ci] = parents[0] ?? null;
        const merges = [];
        for (let j = 1; j < parents.length; j++) {
          let slot = -1;
          for (let k = ci + 1; k < next.length; k++) if (next[k] === null) { slot = k; break; }
          if (slot === -1) slot = next.length;
          next[slot] = parents[j];
          merges.push(slot);
        }
        while (next.length > 0 && next[next.length - 1] === null) next.pop();
        rows.push({ commit, lane: ci, merges, next });
        lanes = next;
      }
      let maxLanes = 0;
      for (const row of rows) maxLanes = Math.max(maxLanes, row.next.length, row.lane + 1);
      return { rows, maxLanes };
    }

    function graphRowSvg(row, maxLanes, branchName) {
      const LANE_W = 10;
      const PAD = 4;
      const H = 24;
      const R = 3.4;
      const W = maxLanes * LANE_W + PAD * 2;
      const cx = (lane) => PAD + lane * LANE_W + LANE_W / 2;
      const y = H / 2;
      const parts = [];
      for (let j = 0; j < row.next.length; j++) {
        if (row.next[j] !== null) {
          parts.push(h('line', { key: `v${j}`, x1: cx(j), y1: 1, x2: cx(j), y2: H - 1, stroke: GRAPH_COLORS[j % GRAPH_COLORS.length], strokeWidth: 1.5 }));
        }
      }
      for (const m of row.merges) {
        const xm = cx(m);
        const xc = cx(row.lane);
        if (Math.abs(xm - xc) > 0.5) {
          const color = GRAPH_COLORS[m % GRAPH_COLORS.length];
          parts.push(h('path', {
            key: `c${m}`,
            d: `M ${xm} ${y - 7} C ${xm} ${y - 7}, ${xm} ${y + 0.5}, ${xc - R} ${y + 0.5}`,
            stroke: color, strokeWidth: 1.5, fill: 'none',
          }));
        }
      }
      parts.push(h('circle', { key: 'dot', cx: cx(row.lane), cy: y, r: R, fill: GRAPH_COLORS[row.lane % GRAPH_COLORS.length] }));
      return h('div', { className: 'jb-col-graph', style: { position: 'relative' } },
        h('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': true }, parts),
        branchName !== null ? h('span', { className: 'jb-branchchip-log' }, branchName) : null);
    }

    // ------------------------------------------------------------- pieces
    function DiffLines({ lines, selectable, codeSet, onToggle }) {
      return h('div', { className: 'jb-diffbody' }, lines.map((line, index) => {
        const id = String(index);
        const selected = selectable && codeSet.some((item) => item.id === id);
        return h('div', {
          key: index, className: `jb-dline jb-dline-${line.kind}` + (selected ? ' jb-dline-selected' : ''),
          'data-new-line': line.new ?? undefined,
          onClick: selectable ? () => onToggle({ id, text: line.text }) : undefined,
          style: selectable ? { cursor: 'pointer' } : undefined,
          title: selectable ? (selected ? '×' : '+') : undefined,
        },
          h('span', { className: 'jb-dline-num' }, line.old === null ? '' : String(line.old)),
          h('span', { className: 'jb-dline-num2' }, line.new === null ? '' : String(line.new)),
          h('span', { className: 'jb-dline-text' }, line.text === '' ? '\u00a0' : line.text));
      }));
    }

    /** Inline composer for one of the two AI actions: title/note, textarea, selected-code preview, send/cancel, sent/error states. */
    function ReviewComposer({ t, intent, sending, sent, error, code, onSubmit, onClearCode, onClose }) {
      const [value, setValue] = useState('');
      const prevSent = useRef(false);
      useEffect(() => {
        if (sent && !prevSent.current) setValue('');
        prevSent.current = sent;
      }, [sent]);
      const language = intent === 'explain' ? 'explain' : 'task';
      const submit = () => { if (value.trim() !== '' && !sending) onSubmit(value.trim()); };
      return h('div', { className: 'jb-reviewbar', 'data-intent': language },
        h('div', { className: 'jb-review-head' },
          h('span', { className: 'jb-review-title' }, t('review.title.' + language)),
          h('span', { className: 'jb-review-note' }, t('review.note.' + language))),
        h('textarea', {
          className: 'jb-review-input', value, placeholder: t('review.placeholder.' + language),
          onChange: (event) => setValue(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); }
          },
        }),
        code.length > 0
          ? h('div', { className: 'jb-review-code' },
            h('div', { className: 'jb-review-code-head' },
              h('span', null, t('review.code.added', { n: String(code.length) })),
              h('span', { className: 'jb-spacer' }),
              h('button', { type: 'button', className: 'jb-review-code-clear', onClick: onClearCode }, t('review.code.clear'))),
            h('pre', { className: 'jb-review-code-body' }, [...code].sort((a, b) => Number(a.id) - Number(b.id)).map((item) => item.text).join('\n')))
          : h('div', { className: 'jb-review-hint' }, t('review.code.hint')),
        h('div', { className: 'jb-review-row' },
          error !== null ? h('span', { className: 'jb-review-err' }, t('review.error', { message: error })) : null,
          sent ? h('span', { className: 'jb-review-sent' }, t('review.sent')) : null,
          h('button', { type: 'button', className: 'jb-review-btn jb-review-btn-ghost', onClick: onClose, disabled: sending }, t('review.cancel')),
          h('button', { type: 'button', className: 'jb-review-btn', onClick: submit, disabled: sending || value.trim() === '' }, t('review.send'))));
    }

    /** The two AI entry points; the primary action assigns work, the ghost action explains and sediments memory cards. */
    function reviewActions(t, disabled, onReview) {
      return [
        h('button', { type: 'button', className: 'jb-review-btn', disabled, onClick: () => onReview('task') }, t('review.button.task')),
        h('button', { type: 'button', className: 'jb-review-btn jb-review-btn-ghost', disabled, onClick: () => onReview('explain') }, t('review.button.explain')),
      ];
    }

    function DiffView({ path, tag, stats, diff, t, review, codeSet, onToggleCode, onReview, onReviewSend, onReviewClose, onClearCode, onReadSource }) {
      if (diff === null) return h('div', { className: 'jb-diffempty' }, t('diff.select'));
      if (diff.binary) return h('div', { className: 'jb-diffempty' }, t('diff.binary'));
      const lines = diff.text === undefined ? [] : parseDiff(diff.text, diff.untracked === true);
      if (lines.length === 0) return h('div', { className: 'jb-diffempty' }, t('diff.empty'));
      return h('div', { className: 'jb-diffwrap', tabIndex: onReadSource ? 0 : undefined,
        onKeyDown: event => { if (event.key === 'F4' && onReadSource) { event.preventDefault(); onReadSource(0); } },
        onDoubleClick: event => {
          if (!onReadSource || review.open || event.target.closest('button')) return;
          const line = event.target.closest('[data-new-line]')?.dataset.newLine;
          onReadSource(line === undefined ? 0 : Number(line) - 1);
        } },
        h('div', { className: 'jb-diffhead' },
          h('span', { className: 'jb-diffpath', title: path }, path),
          h('span', { className: 'jb-difftag' }, tag),
          stats !== null ? h('span', { className: 'jb-diffstats' }, `+${stats.ins} −${stats.del}`) : null,
          h('span', { className: 'jb-spacer' }),
          ...reviewActions(t, undefined, onReview)),
        review.open ? h(ReviewComposer, { t, intent: review.intent, sending: review.sending, sent: review.sent, error: review.error, code: codeSet, onSubmit: onReviewSend, onClearCode, onClose: onReviewClose }) : null,
        h(DiffLines, { lines, selectable: review.open, codeSet, onToggle: onToggleCode }));
    }

    function ChangeTree({ tree, t, rootLabel, rootCount, selectedPath, onSelect, collapsed, toggle }) {
      const rows = [];
      const fileRow = (entry, depth) => h('div', {
        key: 'f' + entry.path, className: 'jb-node', 'data-selected': selectedPath === entry.path, 'data-status': entry.letter,
        style: { paddingLeft: 6 + depth * 16 }, title: t(entry.key) + ' — ' + entry.displayPath,
        onClick: () => onSelect(entry),
      },
        fileIconGlyph(entry.path, entry.untracked),
        h('span', { className: 'jb-filename', title: entry.displayPath }, entry.displayPath),
        (entry.ins > 0 || entry.del > 0) ? h('span', { className: 'jb-stats' }, `+${entry.ins} −${entry.del}`) : null);
      const renderNode = (node, depth, path) => {
        const key = path + node.name;
        const open = !collapsed.has(key);
        rows.push(h('div', { key: 'd' + key, className: 'jb-node', 'data-open': open, onClick: () => toggle(key), style: { paddingLeft: 6 + depth * 16 } },
          h('span', { className: 'jb-chevron' }, chevronGlyph()),
          h('span', { className: 'jb-folder' }, folderGlyph()),
          h('span', { className: 'jb-dirname' }, node.name)));
        if (open) {
          for (const child of node.children) renderNode(child, depth + 1, key + '/');
          for (const entry of node.files) rows.push(fileRow(entry, depth + 1));
        }
      };
      for (const child of tree.children) renderNode(child, 0, '');
      for (const entry of tree.files) rows.push(fileRow(entry, 1));
      return h('div', null,
        h('div', { className: 'jb-group-title' }, rootLabel, h('span', { className: 'jb-count' }, `(${rootCount})`)),
        rows);
    }

    function CommitDetail({ detail, t, review, codeSet, onToggleCode, onReview, onReviewSend, onReviewClose, onClearCode }) {
      if (detail === null) return null;
      if (detail.found === false) {
        return h('div', { className: 'jb-logdetail' },
          h('div', { className: 'jb-logdetail-head' }, h('span', { className: 'jb-logdetail-subject' }, t('log.detail'))),
          h('div', { className: 'jb-empty' }, detail.error ?? t('diff.empty')));
      }
      const lines = detail.diff === undefined || detail.diff === '' ? [] : parseDiff(detail.diff, false);
      return h('div', { className: 'jb-logdetail' },
        h('div', { className: 'jb-logdetail-head' },
          h('span', { className: 'jb-logdetail-subject', title: detail.subject }, detail.subject),
          h('span', { className: 'jb-loghash', title: detail.hash }, detail.short),
          h('span', { className: 'jb-spacer' }),
          ...reviewActions(t, undefined, onReview)),
        review.open ? h(ReviewComposer, { t, intent: review.intent, sending: review.sending, sent: review.sent, error: review.error, code: codeSet, onSubmit: onReviewSend, onClearCode, onClose: onReviewClose }) : null,
        h('div', { className: 'jb-logdetail-meta' },
          `${detail.author}${detail.email ? ` <${detail.email}>` : ''} · ${fmtDateTime(detail.date)}${detail.parents.length > 1 ? ` · ${t('log.parents', { n: String(detail.parents.length) })}` : ''}`),
        detail.files.length > 0
          ? h('div', { className: 'jb-detail-files' },
            h('div', { className: 'jb-detail-fileshead' }, t('log.files', { n: String(detail.files.length) })),
            detail.files.map((file) => h('div', { key: file.path, className: 'jb-dfile', title: file.path },
              h('span', { className: 'jb-dfile-stats' }, `+${file.ins} −${file.del}`),
              h('span', { className: 'jb-dfile-path' }, file.path))))
          : null,
        lines.length > 0 ? h(DiffLines, { lines, selectable: review.open, codeSet, onToggle: onToggleCode }) : h('div', { className: 'jb-diffempty' }, t('diff.empty')));
    }

    /** Memory cards sedimented by explain conversations: filter the folder, then read one card inline. */
    function CardsPanel({ cwd, active, t, onOpen }) {
      const [list, setList] = useState({ loading: false, error: null, data: null });
      const [filter, setFilter] = useState('');
      const [revision, setRevision] = useState(0);
      const [selection, setSelection] = useState(null);
      const listSequence = useRef(0), detailSequence = useRef(0), scrollRef = useRef(null);
      useEffect(() => {
        if (!active || cwd === null) return undefined;
        const controller = new AbortController();
        const sequence = ++listSequence.current;
        setList((old) => ({ ...old, loading: true, error: null }));
        api(`/api/git.cards?${new URLSearchParams({ cwd })}`, { signal: controller.signal })
          .then((data) => { if (!controller.signal.aborted && sequence === listSequence.current) setList({ loading: false, error: null, data }); })
          .catch((error) => {
            if (!controller.signal.aborted && error.name !== 'AbortError' && sequence === listSequence.current) setList({ loading: false, error: error.message, data: null });
          });
        return () => controller.abort();
      }, [active, cwd, revision]);
      useEffect(() => () => { listSequence.current += 1; detailSequence.current += 1; }, []);
      const openCard = (card) => {
        const sequence = ++detailSequence.current;
        setSelection({ card, loading: true, error: null, body: null });
        api(`/api/git.card?${new URLSearchParams({ cwd, path: card.path }).toString()}`)
          .then((data) => {
            if (sequence !== detailSequence.current) return;
            setSelection({ card: { ...card, ...data }, loading: false, error: null, body: typeof data?.body === 'string' ? data.body : '' });
          })
          .catch((error) => {
            if (sequence === detailSequence.current) setSelection((old) => old ? { ...old, loading: false, error: error.message, body: null } : old);
          });
      };
      const back = () => { detailSequence.current += 1; setSelection(null); };
      const data = list.data;
      const cards = useMemo(() => (Array.isArray(data?.cards) ? data.cards.filter((card) => card && typeof card.path === 'string') : [])
        .sort((a, b) => String(a.title ?? a.path).localeCompare(String(b.title ?? b.path)) || String(a.path).localeCompare(String(b.path))), [data]);
      const query = filter.trim().toLowerCase();
      const words = query.split(/\s+/);
      const visible = query === '' ? cards : cards.filter((card) => {
        const terms = [card.title, card.summary, card.source, card.path, ...(Array.isArray(card.tags) ? card.tags : [])]
          .filter(value => typeof value === 'string').join('\n').toLowerCase();
        return words.every(term => terms.includes(term));
      });
      const folder = String(data?.cardsDir ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
      const prefix = folder ? folder + '/' : '';
      const groups = new Map();
      for (const card of visible) {
        const relative = card.path.startsWith(prefix) ? card.path.slice(prefix.length) : card.path;
        const group = typeof card.group === 'string' ? card.group : relative.split('/').slice(0, -1).join('/');
        const members = groups.get(group) ?? [];
        members.push(card);
        groups.set(group, members);
      }
      const skipped = Number(data?.skipped) > 0 ? Number(data.skipped) : 0;
      const truncated = data?.truncated === true ? cards.length : Number(data?.truncated);
      const truncatedCount = Number.isSafeInteger(truncated) && truncated > 0 ? truncated : 0;
      if (selection !== null) {
        const card = selection.card ?? {};
        const title = typeof card.title === 'string' && card.title !== '' ? card.title : String(card.path ?? '');
        const tags = Array.isArray(card.tags) ? card.tags.filter((tag) => typeof tag === 'string' && tag !== '') : [];
        return h('div', { className: 'jb-cards' },
          h('div', { className: 'jb-cards-detail' },
            h('div', { className: 'jb-cards-detail-bar' },
              h('button', { type: 'button', className: 'jb-review-btn jb-review-btn-ghost', onClick: back }, t('cards.back')),
              h('span', { className: 'jb-cards-detail-title', title: card.path ?? title }, title),
              tags.length > 0 ? h('span', { className: 'jb-card-tags' }, ...tags.map((tag) => h('span', { key: tag, className: 'jb-card-tag' }, tag))) : null),
            selection.loading
              ? h('div', { className: 'jb-cards-empty', role: 'status' }, t('cards.loading'))
              : selection.error !== null
                ? h('div', { className: 'jb-cards-empty', role: 'alert' }, t('cards.detailError', { message: selection.error }))
                : h('div', { className: 'jb-cards-reader' }, h(MarkdownReader, {
                  source: { text: selection.body ?? '', path: card.path ?? '' },
                  target: { documentScroll: 0, focusSource: false }, scrollRef, t, blocked: false, onOpen, onNavigate: () => {},
                }))));
      }
      const cardRow = card => h('button', {
        key: card.path, type: 'button', className: 'jb-card-row', 'data-card-path': card.path, title: card.path,
        'aria-label': t('cards.open') + ': ' + (card.title || card.path), onClick: () => openCard(card),
      },
      h('span', { className: 'jb-card-title' }, card.title || card.path),
      Array.isArray(card.tags) && card.tags.length > 0 ? h('span', { className: 'jb-card-tags' },
        ...card.tags.filter((tag) => typeof tag === 'string' && tag !== '').map((tag) => h('span', { key: tag, className: 'jb-card-tag' }, tag))) : null,
      typeof card.summary === 'string' && card.summary !== '' ? h('span', { className: 'jb-card-summary' }, card.summary) : null,
      typeof card.source === 'string' && card.source !== '' ? h('span', { className: 'jb-card-source', title: card.source }, card.source) : null);
      const groupRows = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([group, members]) => h('details', {
        key: `${group}:${query !== ''}`, className: 'jb-card-group', open: true,
      },
      h('summary', null, group === 'general' ? t('cards.general') : group || t('cards.uncategorized'), h('small', null, String(members.length))),
      h('div', { className: 'jb-cards-list' }, ...members.map(cardRow))));
      return h('div', { className: 'jb-cards' },
        h('div', { className: 'jb-cards-bar' },
          h('div', { className: 'jb-cards-filter' }, searchGlyph(),
            h('input', { type: 'search', value: filter, placeholder: t('cards.filter'), 'aria-label': t('cards.filter'), onChange: (event) => setFilter(event.target.value) })),
          h('button', { type: 'button', className: 'jb-tb-btn', title: t('cards.refresh'), 'aria-label': t('cards.refresh'),
            onClick: () => setRevision((value) => value + 1) }, refreshGlyph()),
          typeof data?.cardsDir === 'string' && data.cardsDir !== '' ? h('span', { className: 'jb-cards-dir', title: data.cardsDir }, t('cards.dir', { dir: data.cardsDir })) : null),
        list.loading ? h('div', { className: 'jb-cards-empty', role: 'status' }, t('cards.loading')) : null,
        list.error !== null ? h('div', { className: 'jb-cards-empty', role: 'alert' }, t('cards.error', { message: list.error })) : null,
        skipped > 0 ? h('div', { className: 'jb-cards-notice', role: 'status' }, t('cards.skipped', { n: String(skipped) })) : null,
        truncatedCount > 0 ? h('div', { className: 'jb-cards-notice', role: 'status' }, t('cards.truncated', { n: String(truncatedCount) })) : null,
        h('div', { className: 'jb-cards-body' },
          data !== null && !list.loading && list.error === null && visible.length === 0
            ? h('div', { className: 'jb-cards-empty' }, query === '' ? t('cards.empty') : t('cards.noMatch')) : null,
          groupRows.length ? h('div', { className: 'jb-cards-list' }, ...groupRows) : null));
    }

    /** Render only expanded directories; a path filter bounds its visible results. */
    function WorkspaceTree({ files, changes, selectedPath, revealRevision, onSelect, onMenu, filter, t }) {
      const root = useRef(null), revealed = useRef(0);
      const [expanded, setExpanded] = useState(() => new Set());
      useEffect(() => {
        if (!selectedPath) return;
        setExpanded(old => {
          const next = new Set(old); const segments = selectedPath.split('/');
          for (let end = 1; end < segments.length; end++) next.add(segments.slice(0, end).join('/') + '/');
          return next;
        });
      }, [selectedPath, revealRevision]);
      useLayoutEffect(() => {
        if (!revealRevision || revealed.current === revealRevision) return;
        const row = [...root.current.querySelectorAll('[data-file-path]')].find(row => row.dataset.filePath === selectedPath);
        if (row) { row.focus(); row.scrollIntoView({ block: 'nearest' }); revealed.current = revealRevision; }
      }, [expanded, selectedPath, revealRevision, filter]);
      const directoryKeys = useMemo(() => [...new Set(files.flatMap(path => path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/') + '/')))], [files]);
      const expandDirectory = (path, open) => setExpanded(old => {
        const next = new Set(old);
        for (const key of directoryKeys) if (key.startsWith(path)) { if (open) next.add(key); else next.delete(key); }
        return next;
      });
      const context = (entry, event) => {
        event.preventDefault(); event.stopPropagation();
        const box = event.currentTarget.getBoundingClientRect();
        onMenu(entry, event.type === 'keydown' ? { clientX: box.left + 12, clientY: box.bottom } : event);
      };
      const contextKey = entry => event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) context(entry, event); };
      const changeMap = useMemo(() => new Map(changes.map(entry => [entry.path, entry])), [changes]);
      const query = filter.trim().toLowerCase();
      const matches = useMemo(() => files.filter(path => path.toLowerCase().includes(query)), [files, query]);
      const entries = useMemo(() => matches.map(path => ({ path })), [matches]);
      const tree = useMemo(() => buildTree(entries), [entries]);
      const fileRow = (path, depth, fullPath = false) => {
        const change = changeMap.get(path);
        return h('button', { key: path, type: 'button', className: 'jb-node jb-filebutton',
          'data-selected': path === selectedPath, 'data-status': change?.letter, 'data-file-path': path,
          title: path + (change ? ` · ${t(change.key)}` : ''), style: { paddingLeft: 8 + depth * 14 }, onClick: () => onSelect(path),
          onContextMenu: event => context({ path, directory: false }, event), onKeyDown: contextKey({ path, directory: false }) },
          fileIconGlyph(path, change?.untracked),
          h('span', { className: 'jb-filename' }, fullPath ? path : path.split('/').at(-1)),
          change ? h('span', { className: 'jb-stats' }, change.letter) : null);
      };
      const nodeRows = (node, prefix = '', depth = 0) => [
        ...node.children.map(child => {
          const path = prefix + child.name + '/';
          const open = expanded.has(path);
          return h('div', { key: path },
            h('button', { type: 'button', className: 'jb-node jb-filebutton', 'data-open': open, 'aria-expanded': open,
              onContextMenu: event => context({ path: path.slice(0, -1), directory: true, expand: () => expandDirectory(path, true), collapse: () => expandDirectory(path, false) }, event),
              onKeyDown: contextKey({ path: path.slice(0, -1), directory: true, expand: () => expandDirectory(path, true), collapse: () => expandDirectory(path, false) }),
              style: { paddingLeft: 8 + depth * 14 }, onClick: () => setExpanded(old => {
                const next = new Set(old); if (next.has(path)) next.delete(path); else next.add(path); return next;
              }) }, h('span', { className: 'jb-chevron' }, chevronGlyph()), folderGlyph(), h('span', { className: 'jb-filename' }, child.name)),
            open ? nodeRows(child, path, depth + 1) : null);
        }),
        ...node.files.map(entry => fileRow(entry.path, depth)),
      ];
      return h('div', { ref: root },
        query ? matches.slice(0, 300).map(path => fileRow(path, 0, true)) : nodeRows(tree),
        matches.length === 0 ? h('div', { className: 'jb-tree-hint' }, t('files.empty')) : null,
        query && matches.length > 300 ? h('div', { className: 'jb-tree-hint' }, t('files.more', { shown: '300', total: String(matches.length) })) : null);
    }

    /** Dismiss portal content without leaking listeners into other panes or the conversation. */
    function usePopupDismiss(ref, close) {
      const previous = useRef(document.activeElement);
      useEffect(() => {
        const element = ref.current;
        const outside = event => { if (!element?.contains(event.target)) close(); };
        const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', escape, true);
        return () => {
          document.removeEventListener('pointerdown', outside, true);
          document.removeEventListener('keydown', escape, true);
          if (element?.contains(document.activeElement) || document.activeElement === document.body) previous.current?.focus();
        };
      }, [close]);
    }

    /** Keyboard-accessible context menu, portalled and clamped to the actual viewport. */
    function EditorMenu({ menu, onClose }) {
      const ref = useRef(null);
      usePopupDismiss(ref, onClose);
      useLayoutEffect(() => {
        const element = ref.current; const rect = element.getBoundingClientRect();
        element.style.left = Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)) + 'px';
        element.style.top = Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)) + 'px';
        element.querySelector('[role=menuitem]:not(:disabled)')?.focus();
      }, [menu]);
      return createPortal(h('div', { ref, className: 'jb-editor-popup', role: 'menu', 'aria-label': menu.label ?? menu.title,
        style: { left: menu.x, top: menu.y },
        onKeyDown: event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const items = [...ref.current.querySelectorAll('[role=menuitem]:not(:disabled)')];
          const index = items.indexOf(document.activeElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        } },
        menu.title ? h('div', { className: 'jb-editor-popup-title' }, menu.title) : null,
        menu.items.map(item => h('button', { key: item.id, type: 'button', role: 'menuitem', disabled: item.disabled,
          onClick: () => { onClose(); item.run(); } }, h('span', null, item.label), item.shortcut ? h('kbd', null, item.shortcut) : null))), document.body);
    }

    /** An Enter-submitted line/column prompt; no toolbar or navigation buttons. */
    function GoToLine({ editor, t, onClose }) {
      const ref = useRef(null); const input = useRef(null);
      const [error, setError] = useState(false);
      usePopupDismiss(ref, onClose);
      useEffect(() => { input.current.focus(); input.current.select(); }, []);
      const current = editor.position();
      const go = () => {
        const match = /^(\d+)(?::(\d+))?$/.exec(input.current.value.trim());
        const line = match ? Number(match[1]) : 0, column = match?.[2] ? Number(match[2]) : 1;
        const length = editor.lineLength(line);
        if (length === null || line < 1 || column < 1 || column > length + 1) { setError(true); return; }
        editor.reveal({ line: line - 1, character: column - 1 }); onClose(); editor.focus();
      };
      return createPortal(h('form', { ref, role: 'dialog', 'aria-label': t('files.goLine'), className: 'jb-editor-popup jb-goto',
        onSubmit: event => { event.preventDefault(); go(); } },
        h('label', null, t('files.goLine'), h('input', { ref: input, name: 'line', inputMode: 'numeric', defaultValue: String(current.line + 1), 'aria-invalid': error, 'aria-label': t('files.goLine'),
          onKeyDownCapture: event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); go(); } } })),
        h('small', { role: error ? 'alert' : undefined }, error ? t('files.invalidLine') : t('files.linePrompt'))), document.body);
    }

    /** Clipboard denial leaves a selected, read-only value for manual copying. */
    function CopyPathDialog({ value, t, onClose }) {
      const ref = useRef(null), input = useRef(null);
      usePopupDismiss(ref, onClose);
      useLayoutEffect(() => { input.current.focus(); input.current.select(); }, []);
      return createPortal(h('div', { ref, role: 'dialog', 'aria-label': t('tree.manualCopy'), className: 'jb-editor-popup jb-goto' },
        h('label', null, t('tree.manualCopy'), h('input', { ref: input, readOnly: true, value, 'aria-label': t('tree.manualCopy') })),
        h('small', null, t('tree.copyHint')),
        h('button', { type: 'button', className: 'jb-btn', onClick: onClose }, t('tree.close'))), document.body);
    }

    const ClassGraphWindow = createClassGraphUI(React, api);
    const { useDebugger, DebugPane, EvaluationDialog, DebugHover, controlItems: debugControlItems } = createDebugUI(React, api, { createPortal, usePopupDismiss });

    /** An explicit local port/PID prompt uses the editor's Enter/Escape interaction. */
    function AttachPrompt({ debug, t, onClose }) {
      const ref = useRef(null), input = useRef(null);
      const [language, setLanguage] = useState(debug.attach.language), [kind, setKind] = useState('port'), [error, setError] = useState(false);
      usePopupDismiss(ref, onClose);
      useEffect(() => { input.current.focus(); }, []);
      const submit = () => {
        const text = input.current.value.trim(), value = Number(text);
        if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 1 || (kind === 'port' && value > 65535)) { setError(true); return; }
        debug.submitAttach({ language, kind, value });
      };
      return createPortal(h('form', { ref, role: 'dialog', 'aria-label': t('debug.attach'), className: 'jb-editor-popup jb-goto',
        onSubmit: event => { event.preventDefault(); submit(); },
        onKeyDownCapture: event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); submit(); } } },
        h('label', null, t('debug.language'), h('select', { value: language, onChange: event => { setLanguage(event.target.value); setKind('port'); setError(false); } },
          ...[['python', 'Python'], ['go', 'Go'], ['javascript', 'JavaScript / TypeScript']].map(([value, title]) => h('option', { key: value, value }, title)))),
        language === 'go' ? h('label', null, t('debug.kind'), h('select', { value: kind, onChange: event => { setKind(event.target.value); setError(false); } },
          ...['port', 'pid'].map(value => h('option', { key: value, value }, t('debug.' + value))))) : null,
        h('label', null, t('debug.' + kind), h('input', { ref: input, name: 'target', inputMode: 'numeric', 'aria-label': t('debug.' + kind), 'aria-invalid': error })),
        h('small', null, t(language === 'python' ? 'debug.pythonPort' : language === 'go' ? 'debug.goPort' : 'debug.nodePort')),
        h('small', { role: error ? 'alert' : undefined }, error ? t('debug.invalidAttach') : t('debug.attachPrompt'))), document.body);
    }

    /** A single editor owns caret, selection, scrolling and contextual navigation for its source. */
    function SourceEditor(props) {
      const { source, target, t, definitions, debug, blocked } = props;
      const parent = useRef(null); const editor = useRef(null); const callbacks = useRef(props);
      const documentRef = useRef(null), modeRef = useRef(null), mounted = useRef(true);
      const [hover, setHover] = useState(null), [inspectRequest, setInspectRequest] = useState(0);
      const [documentView, setDocumentView] = useState(null);
      const markdown = /\.(?:md|markdown|mdown)$/i.test(source.path);
      const mode = markdown ? (documentView?.path === source.path && documentView.target === target ? documentView.mode : target.documentMode ?? 'preview') : 'source';
      modeRef.current = mode;
      const inspectionKey = !blocked && mode === 'source' && !debug.busy && !debug.evaluation && debug.session?.state === 'paused' && debug.selectedFrameId != null
        ? `${debug.cwd}:${debug.session.id}:${debug.session.pauseId}:${debug.selectedFrameId}:${debug.variablesVersion}` : null;
      const currentInspection = useRef(null);
      currentInspection.current = inspectionKey;
      const jumpToType = at => {
        const { debug, source, busy, blocked, onDefinition } = callbacks.current;
        const key = currentInspection.current;
        if (!key || busy || blocked || debug.session.frames.find(frame => frame.id === debug.selectedFrameId)?.path !== source.path) return;
        editor.current?.closeInspection();
        editor.current?.focus();
        onDefinition(at.line, at.character, () => mounted.current && currentInspection.current === key
          && callbacks.current.source.path === source.path && callbacks.current.source.version === source.version);
      };
      const applied = useRef(null);
      callbacks.current = props;
      const [position, setPosition] = useState({ line: target.line ?? 0, character: target.character ?? 0 });
      const [menu, setMenu] = useState(null); const [goLine, setGoLine] = useState(false);
      const closeMenu = useCallback(() => setMenu(null), []);
      const closeGo = useCallback(() => setGoLine(false), []);
      const closeAttach = useCallback(() => callbacks.current.debug.closeAttach(), []);
      const showMenu = (anchor, at) => {
        const { debug, t, source } = callbacks.current;
        setMenu({ ...anchor, items: [
        { id: 'class-relations', label: t('classes.title'), disabled: source.external, run: () => callbacks.current.onClasses({ path: callbacks.current.source.path, line: at.line }) },
        { id: 'debug-inspect', label: t('debug.inspect'), disabled: callbacks.current.blocked || debug.busy || debug.session?.state !== 'paused' || debug.selectedFrameId == null, run: () => setInspectRequest(value => value + 1) },
        { id: 'debug-start', label: t(debug.session?.state === 'paused' ? 'debug.continue' : 'debug.launch'), shortcut: 'F5', disabled: source.external || debug.busy || (debug.session?.id && !['paused', 'ended'].includes(debug.session.state)), run: () => debug.run() },
        { id: 'debug-attach', label: t('debug.attach'), disabled: source.external || debug.busy || (debug.session?.id && debug.session.state !== 'ended'), run: () => debug.start('attach') },
        ...debugControlItems(debug, t).filter(item => item.id !== 'debug-continue').map(item => item.id === 'debug-evaluate' ? { ...item, run: () => debug.openEvaluation(editor.current.selectedText()) } : item),
        { id: 'debug-breakpoint', label: t('debug.breakpoint'), shortcut: 'F9', disabled: source.external, run: () => debug.toggle(at.line + 1) },
        { id: 'definition', label: t('files.definition'), shortcut: 'F12', disabled: callbacks.current.busy, run: () => callbacks.current.onDefinition(at.line, at.character) },
        { id: 'find', label: t('tree.findFile'), shortcut: '⌘F / Ctrl F', run: () => editor.current.find() },
        { id: 'line', label: t('files.goLine'), shortcut: '⌘L / Ctrl G', run: () => setGoLine(true) },
        { id: 'diff', label: t('files.diff'), disabled: source.external, run: () => callbacks.current.onShowDiff() },
        { id: 'back', label: t('files.back'), disabled: !callbacks.current.canBack, run: () => callbacks.current.onNavigate(-1, editor.current.position()) },
        { id: 'forward', label: t('files.forward'), disabled: !callbacks.current.canForward, run: () => callbacks.current.onNavigate(1, editor.current.position()) },
        ] });
      };
      useLayoutEffect(() => {
        mounted.current = true;
        const instance = createSourceEditor(parent.current, {
          text: source.text, path: source.path, version: source.version, position: target, label: t('files.source'), colors: C,
          searchPhrases: { 'current match': t('find.current'), 'on line': t('find.onLine'), Find: t('find.label'), next: t('find.next'), previous: t('find.previous'), all: t('find.all'), 'match case': t('find.case'), regexp: t('find.regexp'), 'by word': t('find.word'), close: t('find.close') },
          foldPhrases: { 'Fold line': t('files.fold'), 'Unfold line': t('files.unfold'), 'folded code': t('files.foldedCode'), unfold: t('files.unfold'), 'Folded lines': t('files.foldedLines'), 'Unfolded lines': t('files.unfoldedLines'), to: t('files.rangeTo') },
          takeFocus: document.activeElement === document.body || (parent.current.closest('.jb-changes')?.contains(document.activeElement) && document.activeElement.closest('.jb-filebutton') !== null),
          onHoverMount: value => { if (mounted.current) setHover(value); }, onHoverUnmount: dom => { if (mounted.current) setHover(value => value?.dom === dom ? null : value); },
          onDefinition: at => { if (!callbacks.current.busy && !callbacks.current.blocked) callbacks.current.onDefinition(at.line, at.character); },
          onTypeDefinition: jumpToType, inspectLabel: t('debug.inspect'), typeLabel: t('debug.typeDefinition'),
          onBack: at => callbacks.current.onNavigate(-1, at), onForward: at => callbacks.current.onNavigate(1, at),
          onToggleBreakpoint: line => { if (!callbacks.current.blocked && !callbacks.current.source.external) callbacks.current.debug.toggle(line); }, breakpointLabel: t('debug.breakpoint'),
          onDebug: action => { if (!callbacks.current.blocked && !(callbacks.current.source.external && action === 'run')) action === 'evaluate' ? callbacks.current.debug.openEvaluation(editor.current.selectedText()) : action === 'run' ? callbacks.current.debug.run() : callbacks.current.debug.action(action); },
          onGoLine: () => { if (!callbacks.current.blocked) setGoLine(true); }, onContextMenu: (anchor, at) => { if (!callbacks.current.blocked) showMenu(anchor, at); }, onPosition: setPosition,
        });
        editor.current = instance; applied.current = source;
        callbacks.current.onReader({ ...instance,
          snapshot: () => ({ ...instance.snapshot(), ...(/\.(?:md|markdown|mdown)$/i.test(callbacks.current.source.path) ? { documentMode: modeRef.current, documentScroll: documentRef.current?.scrollTop ?? 0 } : {}) }),
          focus: () => modeRef.current === 'preview' ? documentRef.current?.focus() : instance.focus(),
        });
        return () => { mounted.current = false; callbacks.current.onReader(null); editor.current = null; instance.destroy(); };
      }, []);
      useLayoutEffect(() => {
        if (applied.current.path !== source.path || applied.current.text !== source.text) {
          editor.current.setSource(source, target); applied.current = source;
        }
      }, [source.path, source.text]);
      useLayoutEffect(() => { if (!blocked) { editor.current?.reveal(target); if (mode === 'source') { editor.current?.measure(); if (target.focusSource) editor.current?.focus(); if (target.find) editor.current?.find(); } } }, [target, blocked, mode]);
      useLayoutEffect(() => { editor.current?.setInspection(inspectionKey); }, [inspectionKey]);
      useEffect(() => {
        editor.current?.setInlineValues(null, []);
        const frame = debug.session?.frames?.find(frame => frame.id === debug.selectedFrameId);
        if (!inspectionKey || frame?.path !== source.path) return;
        const controller = new AbortController();
        const request = body => api('/api/git.debug.action', { method: 'POST', signal: controller.signal,
          body: { cwd: debug.cwd, id: debug.session.id, pauseId: debug.session.pauseId, ...body } });
        (async () => {
          const { scopes } = frame.id === debug.session.frames[0]?.id ? { scopes: debug.session.scopes }
            : await request({ action: 'scopes', frameId: frame.id });
          const variables = [];
          for (const scope of scopes ?? []) {
            if (scope.expensive || !scope.variablesReference) continue;
            const data = await request({ action: 'variables', reference: scope.variablesReference });
            variables.push(...(data.variables ?? []));
          }
          if (!controller.signal.aborted) editor.current?.setInlineValues(frame.line, variables);
        })().catch(error => {
          // Optional annotations leave query errors to the existing variable pane.
          if (!controller.signal.aborted) editor.current?.setInlineValues(null, []);
        });
        return () => controller.abort();
      }, [inspectionKey, source.path, source.text]);
      useEffect(() => { if (inspectRequest) editor.current?.inspect(); }, [inspectRequest]);
      useEffect(() => { if (blocked) { setMenu(null); setGoLine(false); } }, [blocked]);
      useEffect(() => {
        const paused = debug.session?.state === 'paused';
        const current = paused ? debug.session.frames?.[0] : null;
        const selected = paused ? debug.session.frames?.find(frame => frame.id === debug.selectedFrameId) : null;
        editor.current?.setDebug({ breakpoints: (debug.breakpoints[source.path] ?? []).map(line => ({ line, verified: debug.session?.breakpoints?.some(point => point.path === source.path && point.line === line && point.verified) ?? false })),
          currentLine: current && current.path === source.path ? current.line : null,
          selectedLine: selected && selected.path === source.path && selected.id !== current?.id ? selected.line : null });
      }, [debug.breakpoints, debug.session, debug.selectedFrameId, source.path, source.text]);
      useEffect(() => { if (debug.choices) setMenu({ ...editor.current.anchor(), title: t('debug.choose'), items: debug.choices.map(row => ({ id: row.name, label: row.name, run: () => debug.choose(row.name) })) }); }, [debug.choices]);
      useEffect(() => {
        if (definitions.length <= 1 || !editor.current) return;
        setMenu({ ...editor.current.anchor(), title: t('files.results'), items: definitions.map((item, index) => ({
          id: String(index), label: (item.displayPath ?? item.path) + ':' + (item.line + 1), run: () => callbacks.current.onChooseDefinition(item),
        })) });
      }, [definitions]);
      return h(React.Fragment, null,
        markdown ? h('div', { className: 'jb-document-toolbar', role: 'group', 'aria-label': t('document.mode') }, ...['preview', 'source'].map(value => h('button', { key: value, type: 'button', 'aria-pressed': mode === value, disabled: blocked, onClick: () => setDocumentView({ path: source.path, target, mode: value }) }, t('document.' + value)))) : null,
        h('div', { ref: parent, className: 'jb-sourcebody', hidden: mode === 'preview', inert: blocked || mode === 'preview' || undefined, 'aria-description': t('files.hint') }),
        markdown ? h('div', { className: 'jb-document-seat', hidden: mode !== 'preview' }, h(MarkdownReader, { source, target, scrollRef: documentRef, t, blocked: blocked || mode !== 'preview', onOpen: props.onOpenDocument, onNavigate: delta => props.onNavigate(delta) })) : null,
        h('div', { className: 'jb-editor-status' },
          mode === 'source' ? h('span', null, t('files.position', { line: String(position.line + 1), column: String(position.character + 1) })) : null,
          h('span', null, t(source.external ? 'files.library' : mode === 'preview' ? 'document.readOnly' : 'files.readOnly'))),
        menu ? h(EditorMenu, { menu, onClose: closeMenu }) : null,
        hover && hover.key === inspectionKey ? createPortal(h(DebugHover, { debug, expression: hover.expression, variable: hover.variable, t,
          onTypeDefinition: debug.session.frames.find(frame => frame.id === debug.selectedFrameId)?.path === source.path ? () => jumpToType(hover.at) : undefined,
          onClose: (focus = false) => { editor.current?.closeInspection(); if (focus) editor.current?.focus(); } }), hover.dom) : null,
        debug.attach ? h(AttachPrompt, { debug, t, onClose: closeAttach }) : null,
        goLine && editor.current ? h(GoToLine, { editor: editor.current, t, onClose: closeGo }) : null);
    }

    /** Images remain isolated img documents; SVG markup never enters the application DOM. */
    function ImageReader(props) {
      const { source, t, blocked, onNavigate } = props;
      const [zoom, setZoom] = useState(null), [dimensions, setDimensions] = useState(null), [failed, setFailed] = useState(false), [mode, setMode] = useState('preview');
      const stage = useRef(null);
      const scale = factor => setZoom(value => Math.max(.1, Math.min(8, (value ?? 1) * factor)));
      useLayoutEffect(() => { if (props.target.focusSource && !blocked && mode === 'preview') stage.current?.focus({ preventScroll: true }); }, [blocked, mode]);
      return h('div', { className: 'jb-image-reader' },
        h('div', { className: 'jb-document-toolbar', role: 'group', 'aria-label': t('image.preview') },
          ...(source.text !== undefined ? ['preview', 'source'].map(value => h('button', { key: value, type: 'button', 'aria-pressed': mode === value, disabled: blocked, onClick: () => setMode(value) }, t(value === 'preview' ? 'image.preview' : 'document.source'))) : []),
          ...['fit', 'actual', 'zoomOut', 'zoomIn'].map(action => h('button', { key: action, type: 'button', disabled: blocked || mode !== 'preview',
            'aria-pressed': action === 'fit' ? zoom === null : action === 'actual' ? zoom === 1 : undefined,
            onClick: () => action === 'fit' ? setZoom(null) : action === 'actual' ? setZoom(1) : scale(action === 'zoomIn' ? 1.25 : .8) }, t('image.' + action))),
          h('span', { className: 'jb-image-meta' }, zoom === null ? '' : Math.round(zoom * 100) + '%')),
        mode === 'source' ? h(SourceEditor, props) : h(React.Fragment, null,
          failed ? h('div', { className: 'jb-diffempty', role: 'alert' }, t('image.failed')) : h('div', { ref: stage, tabIndex: 0, className: 'jb-image-stage', 'data-fit': zoom === null, 'aria-label': t('image.preview'), inert: blocked || undefined,
            onKeyDown: event => { if ((event.metaKey || event.ctrlKey) && ['[', ']'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onNavigate(event.key === '[' ? -1 : 1); } } },
          h('div', { className: 'jb-image-canvas' }, h('img', { src: source.dataUrl, alt: source.path, draggable: false,
            style: zoom !== null && dimensions ? { width: dimensions.width * zoom, height: dimensions.height * zoom } : undefined,
            onLoad: event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }), onError: () => setFailed(true) }))),
          h('div', { className: 'jb-editor-status', role: 'status' },
            h('span', null, dimensions && !failed ? t('image.dimensions', { width: String(dimensions.width), height: String(dimensions.height) }) : ''),
            h('span', null, source.mime + ' · ' + new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(source.size / 1024) + ' KiB'))));
    }

    /** Persistent file tabs with keyboard activation and a shared close menu. */
    function SourceTabs({ paths, activePath, labels, panelId, t, onSelect, onClose, onMenu, onFindInFiles }) {
      const ref = useRef(null);
      const activeIndex = paths.indexOf(activePath);
      useLayoutEffect(() => {
        ref.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }, [paths, activePath]);
      const close = path => onClose('one', path);
      const openMenu = (path, event) => {
        event.preventDefault(); event.stopPropagation();
        const tab = event.currentTarget.querySelector('[role=tab]');
        const rect = tab.getBoundingClientRect();
        const pointer = event.type === 'contextmenu' && (event.clientX !== 0 || event.clientY !== 0);
        onMenu({ x: pointer ? event.clientX : rect.left, y: pointer ? event.clientY : rect.bottom,
          label: t('files.tabMenu'), items: [
            { id: 'close', label: t('files.tabClose'), run: () => close(path) },
            { id: 'others', label: t('files.tabCloseOthers'), disabled: paths.length < 2, run: () => onClose('others', path) },
            { id: 'all', label: t('files.tabCloseAll'), run: () => onClose('all') },
          ] });
      };
      return h('div', { ref, role: 'tablist', 'aria-label': t('files.openTabs'), className: 'jb-source-tabs',
        onKeyDown: event => {
          const index = Number(event.target.closest('[data-tab-index]')?.dataset.tabIndex);
          if (!Number.isInteger(index)) return;
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? paths.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + paths.length) % paths.length;
            onSelect(paths[next], false); ref.current.querySelectorAll('[role=tab]')[next]?.focus();
          } else if (event.key === 'Delete') { event.preventDefault(); event.stopPropagation(); close(paths[index]); }
        } }, ...paths.map((path, index) => {
          const basename = path.split('/').at(-1);
          const displayPath = labels.get(path) ?? path;
          const label = paths.some(other => other !== path && other.split('/').at(-1) === basename) ? displayPath : basename;
          return h('div', { key: path, className: 'jb-source-tab', 'data-active': path === activePath, 'data-tab-index': index, role: 'presentation',
            onContextMenu: event => openMenu(path, event),
            onKeyDown: event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(path, event); },
            onKeyDownCapture: event => { if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); onFindInFiles(''); } },
            onAuxClick: event => { if (event.button === 1) { event.preventDefault(); event.stopPropagation(); close(path); } } },
            h('button', { type: 'button', role: 'tab', id: `${panelId}-tab-${index}`, 'aria-controls': panelId, 'aria-haspopup': 'menu', 'aria-selected': path === activePath, 'aria-label': displayPath, tabIndex: index === activeIndex ? 0 : -1, title: displayPath,
              onClick: () => onSelect(path, true) }, fileIconGlyph(path, false), h('span', null, label), labels.has(path) ? h('small', null, t('files.libraryShort')) : null),
            h('button', { type: 'button', className: 'jb-source-tab-close', tabIndex: path === activePath ? 0 : -1, 'aria-label': t('files.closeTab', { path: displayPath }), title: t('files.closeTab', { path: displayPath }), onClick: () => close(path) }, '×'));
        }));
    }

    /** Own source/diff requests and definition history independently of the conversation. */
    function CodeBrowser({ cwd, changes, initialTarget, debugHost, onShowDebug, onFindInFiles, onExplain, desktopPaths, t }) {
      const [files, setFiles] = useState(null);
      const [filter, setFilter] = useState('');
      const filterInput = useRef(null), alive = useRef(true), copySequence = useRef(0);
      const [filterFocus, setFilterFocus] = useState(0), [revealRevision, setRevealRevision] = useState(0);
      const [copyNotice, setCopyNotice] = useState(null), [manualCopy, setManualCopy] = useState(null);
      const [canOpenLocal, setCanOpenLocal] = useState(false);
      const [localOpenError, setLocalOpenError] = useState(false);
      useEffect(() => {
        if (typeof desktopPaths?.canOpenWorkspacePath !== 'function' || typeof desktopPaths.openWorkspacePath !== 'function') return;
        let current = true;
        Promise.resolve().then(() => desktopPaths.canOpenWorkspacePath()).then(
          result => { if (current) setCanOpenLocal(result?.ok === true && result.value === true); },
          () => { if (current) setCanOpenLocal(false); },
        );
        return () => { current = false; };
      }, [desktopPaths]);
      const closeCopy = useCallback(() => setManualCopy(null), []);
      useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
      useLayoutEffect(() => { if (filterFocus) { filterInput.current.focus(); filterInput.current.setSelectionRange?.(filter.length, filter.length); } }, [filterFocus]);
      const [treeError, setTreeError] = useState(null);
      const [history, setHistory] = useState(() => ({ items: initialTarget ? [initialTarget] : [], index: initialTarget ? 0 : -1 }));
      const [openPaths, setOpenPaths] = useState(() => initialTarget ? [initialTarget.path] : []);
      const [libraryLabels, setLibraryLabels] = useState(() => new Map());
      const positions = useRef(new Map()), reader = useRef(null), detailRef = useRef(null), closingTabs = useRef(false);
      useLayoutEffect(() => {
        if (!closingTabs.current) return;
        closingTabs.current = false;
        const detail = detailRef.current;
        (detail?.querySelector('.jb-source-tabs [aria-selected=true]') ?? detail)?.focus();
      }, [openPaths]);
      const panelId = React.useId();
      const target = history.items[history.index] ?? null;
      const [view, setView] = useState('source');
      const [loaded, setLoaded] = useState(null);
      const content = loaded?.content;
      const contentMatches = loaded?.path === target?.path && loaded?.view === view;
      const shownTarget = contentMatches ? target : loaded?.target;
      const shownView = loaded?.view ?? view;
      const [readRevision, setReadRevision] = useState(0);
      const [error, setError] = useState(null);
      const [loading, setLoading] = useState(false);
      const [navigation, setNavigation] = useState({ busy: false, targets: [], message: null });
      const [menu, setMenu] = useState(null);
      const closeMenu = useCallback(() => setMenu(null), []);
      const [classSeed, setClassSeed] = useState(null);
      const [classDock, setClassDock] = useState('right');
      const navigationRef = useRef(null);
      const diffRef = useRef(null);
      const initialRef = useRef(initialTarget);
      const remember = () => {
        if (loaded?.view === 'source' && reader.current) {
          const position = reader.current.snapshot(); positions.current.set(loaded.path, position);
          return { path: loaded.path, ...position };
        }
      };
      const retain = path => setOpenPaths(paths => paths.includes(path) ? paths : [...paths, path]);
      useEffect(() => {
        if (view === 'diff' && content && document.activeElement === document.body) diffRef.current?.focus();
      }, [view, content]);
      const visit = (destination, origin, mode = 'source') => {
        const remembered = remember(); retain(destination.path);
        destination = { folding: positions.current.get(destination.path)?.folding, ...destination };
        navigationRef.current?.abort();
        if (error && destination.path === target?.path) setReadRevision(value => value + 1);
        setView(mode);
        setHistory(old => {
          const items = old.items.slice(0, old.index + 1);
          if (remembered?.path === items[old.index]?.path) items[old.index] = { ...items[old.index], ...remembered };
          if (origin) items[old.index] = { ...items[old.index], ...origin };
          const current = items[old.index];
          if (current && current.path === destination.path && current.line === destination.line && current.character === destination.character && mode === view) {
            items[old.index] = destination; return { items, index: old.index };
          }
          return { items: [...items, destination], index: old.index + 1 };
        });
      };
      const navigate = (delta, origin) => {
        if (history.index + delta < 0 || history.index + delta >= history.items.length) return;
        const remembered = remember(); retain(history.items[history.index + delta].path);
        navigationRef.current?.abort(); setView('source');
        setHistory(old => {
          const items = [...old.items];
          if (remembered?.path === items[old.index]?.path) items[old.index] = { ...items[old.index], ...remembered };
          if (origin) items[old.index] = { ...items[old.index], ...origin };
          return { items, index: old.index + delta };
        });
      };
      const openFile = path => {
        if (path === target?.path && !error) setReadRevision(value => value + 1);
        if (path === loaded?.path) remember();
        visit({ path, line: 0, character: 0, ...positions.current.get(path), focusSource: true });
      };
      const selectTab = (path, focusSource) => {
        if (path === target?.path && view === 'source') { if (focusSource && !loading) reader.current?.focus(); return; }
        visit({ path, line: 0, character: 0, ...positions.current.get(path), focusSource });
      };
      const closeTabs = (action, path) => {
        if (action !== 'all' && !openPaths.includes(path)) return;
        const remaining = action === 'all' ? [] : action === 'others' ? [path] : openPaths.filter(item => item !== path);
        if (remaining.length === openPaths.length) return;
        closingTabs.current = true;
        setOpenPaths(remaining);
        if (!remaining.length) {
          navigationRef.current?.abort(); setHistory({ items: [], index: -1 }); setLoaded(null); setLoading(false); setError(null); setView('source');
        } else if (!remaining.includes(target?.path)) {
          const next = remaining[Math.max(0, openPaths.indexOf(target?.path) - 1)] ?? remaining[0];
          visit({ path: next, line: 0, character: 0, ...positions.current.get(next) });
        }
        if (loaded && !remaining.includes(loaded.path)) setLoaded(null);
        for (const closed of openPaths) if (!remaining.includes(closed)) positions.current.delete(closed);
      };
      const copy = value => {
        const sequence = ++copySequence.current;
        setCopyNotice(null);
        const fallback = () => { if (alive.current && sequence === copySequence.current) setManualCopy(value); };
        try {
          if (!navigator.clipboard?.writeText) { fallback(); return; }
          Promise.resolve(navigator.clipboard.writeText(value)).then(() => {
            if (alive.current && sequence === copySequence.current) setCopyNotice(t('tree.copied', { value }));
          }, fallback);
        } catch (error) { fallback(); }
      };
      const fileMenu = (entry, event) => {
        setCopyNotice(null);
        const { path, directory } = entry;
        const separator = cwd.includes('\\') ? '\\' : '/';
        const absolute = cwd.replace(/[\\/]+$/, '') + separator + path.replaceAll('/', separator);
        setMenu({ x: event.clientX, y: event.clientY, title: path, items: [
          ...(directory ? [
            { id: 'expand', label: t('tree.expand'), run: entry.expand },
            { id: 'collapse', label: t('tree.collapse'), run: entry.collapse },
            { id: 'find-name', label: t('tree.findName'), run: () => { setFilter(path + '/'); setFilterFocus(value => value + 1); } },
            { id: 'find-directory', label: t('tree.findDirectory'), shortcut: '⌘⇧F / Ctrl Shift F', run: () => onFindInFiles(path) },
          ] : [
            { id: 'source', label: t('files.read'), run: () => openFile(path) },
            { id: 'explain', label: t('review.button.explain'), run: () => onExplain(path) },
            { id: 'find-file', label: t('tree.findFile'), shortcut: '⌘F / Ctrl F', disabled: /\.(?:png|jpe?g|gif|webp|bmp|ico|icns|avif)$/i.test(path), run: () => visit({ path, line: 0, character: 0, documentMode: 'source', focusSource: true, find: true }) },
            { id: 'diff', label: t('files.diff'), run: () => visit({ path, line: 0, character: 0 }, null, 'diff') },
          ]),
          ...(canOpenLocal ? [{ id: 'open-local', label: t(directory ? 'tree.openLocal' : 'tree.revealLocal'), run: async () => {
            setLocalOpenError(false);
            try {
              const result = await desktopPaths.openWorkspacePath(directory ? { path: absolute } : { path: absolute, action: 'reveal' });
              if (alive.current) setLocalOpenError(result?.ok !== true);
            } catch (_error) { if (alive.current) setLocalOpenError(true); }
          } }] : []),
          { id: 'copy-name', label: t('tree.copyName'), run: () => copy(path.split('/').at(-1)) },
          { id: 'copy-relative', label: t('tree.copyRelative'), run: () => copy(path) },
          { id: 'copy-absolute', label: t('tree.copyAbsolute'), run: () => copy(absolute) },
        ] });
      };
      useEffect(() => {
        if (initialTarget && initialRef.current !== initialTarget) visit(initialTarget);
        initialRef.current = initialTarget;
      }, [initialTarget]);
      useEffect(() => {
        const controller = new AbortController();
        api(`/api/git.tree?${new URLSearchParams({ cwd })}`, { signal: controller.signal })
          .then(data => { if (!controller.signal.aborted) setFiles(data.files); })
          .catch(error => { if (!controller.signal.aborted) setTreeError(error.message); });
        return () => controller.abort();
      }, [cwd, changes]);
      useEffect(() => { setNavigation({ busy: false, targets: [], message: target?.notice ?? null }); }, [target]);
      useEffect(() => {
        const controller = new AbortController();
        navigationRef.current?.abort();
        setError(null);
        if (!target) return () => controller.abort();
        setLoading(true);
        const entry = changes.find(entry => entry.path === target.path);
        const params = new URLSearchParams({ cwd, path: target.path });
        if (view === 'diff' && entry?.untracked) params.set('untracked', '1');
        else if (view === 'diff' && entry?.staged && entry?.unstagedToo) params.set('both', '1');
        else if (view === 'diff' && entry?.staged) params.set('staged', '1');
        const untrackedDiff = view === 'diff' && entry?.untracked;
        api(`/api/git.${view === 'source' || untrackedDiff ? 'source' : 'diff'}?${params}`, { signal: controller.signal })
          .then(data => { if (!controller.signal.aborted) {
            if (data.external) setLibraryLabels(old => new Map(old).set(target.path, data.displayPath));
            setLoaded({ path: target.path, view, target, content: untrackedDiff ? { ...data, untracked: true, ...(data.kind === 'image' ? { binary: true } : {}) } : data });
          } })
          .catch(error => {
            if (controller.signal.aborted) return;
            const key = { LIBRARY_SOURCE_EXPIRED: 'files.libraryExpired', IMAGE_TOO_LARGE: 'image.tooLarge', IMAGE_INVALID: 'image.invalid', IMAGE_ICNS_UNSUPPORTED: 'image.icnsUnsupported', SOURCE_TOO_LARGE: 'files.tooLarge', SOURCE_BINARY: 'files.binary', SOURCE_NOT_FILE: 'files.notFile', SOURCE_ENCODING: 'files.encoding', SOURCE_OUTSIDE_WORKSPACE: 'files.outside' }[error.code];
            setError(key ? t(key) : t('error.load', { message: error.message }));
          })
          .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => { controller.abort(); navigationRef.current?.abort(); };
      }, [cwd, target?.path, view, changes, readRevision]);
      const controller = useDebugger(cwd, t, at => { visit(at); onShowDebug(); }, () => reader.current?.selectedText?.() ?? '');
      const debug = { ...controller, run: (...args) => { onShowDebug(); return controller.run(...args); },
        start: (...args) => { onShowDebug(); return controller.start(...args); },
        openEvaluation: (...args) => { onShowDebug(); return controller.openEvaluation(...args); } };
      const debugRef = useRef(debug); debugRef.current = debug;
      const closeEvaluation = useCallback(() => debugRef.current.closeEvaluation(), []);
      const paneLayout = usePaneLayout(t);
      debug.cwd = cwd; debug.path = content?.external ? undefined : target?.path; debug.setPath(debug.path); debug.sourcePending = content?.external || loading || (Boolean(loaded) && !contentMatches);
      debug.report = error => setError(error.message);
      const define = async (line, character, typeContext) => {
        if (loading || !contentMatches) return;
        navigationRef.current?.abort();
        const controller = new AbortController(); navigationRef.current = controller;
        setNavigation({ busy: true, targets: [], message: null });
        try {
          const params = new URLSearchParams({ cwd, path: target.path, version: content.version, line: String(line), character: String(character) });
          if (typeContext) params.set('kind', 'type');
          const result = await api(`/api/git.definition?${params}`, { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (typeContext && !typeContext()) { setNavigation({ busy: false, targets: [], message: null }); return; }
          const message = result.external > 0 ? t('files.external', { n: String(result.external) }) : result.targets.length === 0 ? t(typeContext ? 'debug.typeMissing' : 'files.none') : null;
          setNavigation({ busy: false, targets: result.targets, message, origin: { ...target, line, character } });
          if (result.targets.length === 1) {
            visit({ ...result.targets[0], notice: message, focusSource: true }, { ...target, line, character });
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          if (typeContext && !typeContext()) { setNavigation({ busy: false, targets: [], message: null }); return; }
          const key = error.code === 'NAVIGATION_UNAVAILABLE' ? 'files.unavailable' : error.code === 'SOURCE_CHANGED' ? 'files.changed'
            : error.code === 'LANGUAGE_SERVER_MISSING' ? 'files.serverMissing' : error.code === 'LANGUAGE_SERVER_TIMEOUT' ? 'files.serverTimeout'
              : typeof error.code === 'string' && error.code.startsWith('LANGUAGE_SERVER_') ? 'files.serverFailed' : 'files.failed';
          setNavigation({ busy: false, targets: [], message: t(key, { message: error.message }) });
        }
      };
      return h('div', { ref: paneLayout.root, className: 'jb-changes jb-code-browser', style: paneLayout.style,
        onAuxClick: event => { if (event.button === 3 || event.button === 4) { event.preventDefault(); event.stopPropagation(); } },
        onKeyDown: event => {
          if (view !== 'diff') return;
          if (event.key === 'F4') { event.preventDefault(); event.stopPropagation(); setView('source'); }
          if ((event.metaKey || event.ctrlKey) && ['[', ']'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); navigate(event.key === '[' ? -1 : 1); }
        } },
        h('div', { ref: paneLayout.workspace, className: 'jb-code-workspace' }, h('div', { className: 'jb-tree' },
          h('div', { className: 'jb-tree-toolbar' },
            h('div', { className: 'jb-filter' }, searchGlyph(), h('input', { ref: filterInput, type: 'search', value: filter, 'aria-label': t('tree.findName'), placeholder: t('filter.placeholder'), onChange: event => setFilter(event.target.value) })),
            h('button', { type: 'button', className: 'jb-tb-btn', title: t('classes.title'), 'aria-label': t('classes.title'), disabled: content?.external, onClick: () => setClassSeed({ path: target?.path, line: reader.current?.position?.().line ?? target?.line ?? 0 }) }, lucideSvg([h('rect', { x: 8, y: 2, width: 8, height: 6, rx: 1 }), h('path', { d: 'M12 8v5M5 13v3m14-3v3' }), h('rect', { x: 2, y: 16, width: 6, height: 6, rx: 1 }), h('rect', { x: 16, y: 16, width: 6, height: 6, rx: 1 })], 16)),
            h('button', { type: 'button', className: 'jb-tb-btn', title: t('tree.locate'), 'aria-label': t('tree.locate'), disabled: !target || !files?.includes(target.path), onClick: () => { setFilter(''); setRevealRevision(value => value + 1); } }, lucideSvg([h('circle', { cx: 12, cy: 12, r: 6 }), h('path', { d: 'M12 2v6m0 8v6M2 12h6m8 0h6' })], 16)),
            h('button', { type: 'button', className: 'jb-tb-btn', title: t('tree.findDirectory'), 'aria-label': t('tree.findDirectory'), onClick: () => onFindInFiles('') }, searchGlyph(16))),
          treeError ? h('div', { className: 'jb-notice' }, treeError) : files === null ? h('div', { className: 'jb-tree-hint' }, t('loading')) : h(WorkspaceTree, { files, changes, selectedPath: target?.path, onSelect: openFile, onMenu: fileMenu, filter, revealRevision, t })),
        h(PaneDivider, { layout: paneLayout, t }),
        h('div', { className: 'jb-reader-layout' }, h('div', { className: 'jb-reader-workspace', 'data-class-dock': classDock },
        h('div', { ref: detailRef, tabIndex: -1, className: 'jb-detail', 'aria-busy': loading },
          h(SourceTabs, { paths: openPaths, activePath: target?.path, labels: libraryLabels, panelId, t, onSelect: selectTab, onClose: closeTabs, onMenu: setMenu, onFindInFiles }),
          h('div', { className: 'jb-editor-title' }, (loaded?.path ?? target?.path) ? fileIconGlyph(loaded?.path ?? target.path, false) : null,
            h('span', { className: 'jb-diffpath', title: content?.displayPath ?? loaded?.path ?? target?.path }, content?.displayPath ?? loaded?.path ?? target?.path),
            shownView === 'diff' ? h('span', null, t('files.diff')) : null),
          loaded && (loading || error) ? h('div', { className: 'jb-source-notice', role: error ? 'alert' : 'status' }, error ? t('files.openFailed', { path: target.displayPath ?? libraryLabels.get(target.path) ?? target.path, message: error }) : t('files.opening', { path: target.displayPath ?? libraryLabels.get(target.path) ?? target.path }))
            : navigation.busy || navigation.message ? h('div', { className: 'jb-source-notice', role: 'status' }, navigation.busy ? t('loading') : navigation.message) : null,
          h('div', { className: 'jb-source-panel', role: 'tabpanel', id: panelId, 'aria-labelledby': target ? `${panelId}-tab-${openPaths.indexOf(target.path)}` : undefined },
          !content ? h('div', { className: 'jb-diffempty', role: error ? 'alert' : undefined }, error ?? t(loading ? 'loading' : 'files.pick'))
                : shownView === 'source' ? h(content.kind === 'image' ? ImageReader : SourceEditor, { ...(content.kind === 'image' ? { key: content.path + ':' + content.version } : {}), source: content, target: shownTarget, onClasses: setClassSeed, onDefinition: define, t, debug, busy: navigation.busy, blocked: loading || !contentMatches,
                  onReader: instance => { reader.current = instance; }, canBack: history.index > 0, canForward: history.index + 1 < history.items.length, onNavigate: navigate, onShowDiff: () => { if (!content.external) { remember(); setView('diff'); } },
                  onOpenDocument: destination => visit(destination),
                  definitions: navigation.targets, onChooseDefinition: item => visit({ ...item, focusSource: true }, navigation.origin) })
                  : content.binary ? h('div', { className: 'jb-diffempty' }, t('diff.binary'))
                    : content.text === '' ? h('div', { className: 'jb-diffempty' }, t('diff.empty'))
                      : h('div', { ref: diffRef, className: 'jb-diffwrap', tabIndex: 0,
                        onContextMenu: event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, items: [{ id: 'source', label: t('files.read'), shortcut: 'F4', run: () => setView('source') }] }); },
                        onDoubleClick: event => {
                          const line = event.target.closest('[data-new-line]')?.dataset.newLine;
                          if (line !== undefined) setHistory(old => ({ ...old, items: old.items.map((item, index) => index === old.index ? { ...item, line: Number(line) - 1, character: 0 } : item) }));
                          setView('source');
                        } }, h(DiffLines, { lines: parseDiff(content.text, content.untracked === true), selectable: false, codeSet: [], onToggle: () => {} })))),
        classSeed ? h(PaneDivider, { layout: paneLayout, t, pane: 'classes' }) : null,
        classSeed ? h(ClassGraphWindow, { cwd, seed: classSeed, currentPath: target?.path ?? null, files, external: target?.path?.startsWith('dsh-library://') === true, dock: classDock, onDock: setClassDock, onOpen: destination => visit(destination), onClose: () => { setClassSeed(null); reader.current?.focus(); }, t }) : null))),
        debugHost ? createPortal(h(DebugPane, { debug, t, onMenu: (anchor, frame) => setMenu({ ...anchor, title: frame.name + ' · ' + (frame.path ? frame.path + ':' + frame.line : t('debug.external')), items: [
          { id: 'source', label: t('files.read'), shortcut: 'Enter / F4', disabled: !frame.path, run: () => debug.selectFrame(frame.id, true) },
          ...debugControlItems(debug, t),
        ] }) }), debugHost) : null,
        debug.evaluation && debug.session?.state === 'paused' && debug.selectedFrameId != null ? h(EvaluationDialog, { key: `${cwd}:${debug.session.id}:${debug.session.pauseId}:${debug.selectedFrameId}`, debug, t, onClose: closeEvaluation }) : null,
        manualCopy !== null ? h(CopyPathDialog, { value: manualCopy, t, onClose: closeCopy }) : null,
        localOpenError ? h('div', { className: 'jb-layout-notice', role: 'alert' }, t('tree.openLocalFailed')) : null,
        copyNotice ? h('div', { className: 'jb-layout-notice', role: 'status' }, copyNotice) : null,
        paneLayout.error ? h('div', { className: 'jb-layout-notice', role: 'alert' }, paneLayout.error) : null,
        menu ? h(EditorMenu, { menu, onClose: closeMenu }) : null);
    }

    // ------------------------------------------------------------- panel
    function WorkbenchPanel(props) {
      const { useWorkspaces, useSessions, t, openSession, sessionId, getLocale } = props;
      const workspaces = useWorkspaces((state) => state.items);
      const sessions = useSessions((state) => state.byId ?? {});
      const [overrideId, setOverrideId] = useState(null);
      const sessionRows = useMemo(() => Object.values(sessions), [sessions]);
      const currentSession = useMemo(() => (
        sessionId !== undefined ? sessions[sessionId] ?? null : (sessionRows.find((s) => (s.retainedBy?.mainView ?? 0) > 0)
        ?? [...sessionRows].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
        ?? null)
      ), [sessionRows, sessions, sessionId]);
      const boundWorkspace = useMemo(() => {
        const cwd = currentSession?.cwd;
        if (cwd === undefined || cwd === null || cwd === '') return null;
        return workspaces.find((w) => w.path === cwd)
          ?? workspaces.find((w) => cwd.startsWith(w.path + '/'))
          ?? null;
      }, [currentSession, workspaces]);
      useEffect(() => { setOverrideId(null); }, [currentSession?.id]);
      const targetWorkspaceId = overrideId ?? boundWorkspace?.workspaceId ?? (sessionId === undefined ? workspaces[0]?.workspaceId : null) ?? null;
      const workspace = workspaces.find((item) => item.workspaceId === targetWorkspaceId) ?? null;
      const cwd = workspace ? workspace.path : null;

      const tools = useBottomTools(currentSession?.id ?? null, t);
      const tab = tools.active;
      const [debugHost, setDebugHost] = useState(null);
      const showDebug = useCallback(() => tools.show('debug'), [tools.show]);
      const toolsId = React.useId();
      const [sourceTarget, setSourceTarget] = useState(null);
      const [searchScope, setSearchScope] = useState(''), [findRequest, setFindRequest] = useState(0);
      const openFind = useCallback(scope => { setSearchScope(scope); setFindRequest(value => value + 1); tools.show('find'); }, [tools.show]);
      const [status, setStatus] = useState(null);
      const [statusError, setStatusError] = useState(null);
      const [statusLoading, setStatusLoading] = useState(false);
      const [log, setLog] = useState(null);
      const [logError, setLogError] = useState(null);
      const [filter, setFilter] = useState('');
      const [selected, setSelected] = useState(null);
      const [diff, setDiff] = useState(null);
      const [diffLoading, setDiffLoading] = useState(false);
      const [logSelected, setLogSelected] = useState(null);
      const [detail, setDetail] = useState(null);
      const [detailLoading, setDetailLoading] = useState(false);
      const [reviewOpen, setReviewOpen] = useState(false);
      const [reviewIntent, setReviewIntent] = useState('task');
      const [reviewTarget, setReviewTarget] = useState(null);
      const [reviewSending, setReviewSending] = useState(false);
      const [reviewSent, setReviewSent] = useState(false);
      const [reviewError, setReviewError] = useState(null);
      const [reviewCode, setReviewCode] = useState([]);
      const [collapsed, setCollapsed] = useState(() => new Set());
      const abortRef = useRef(null);

      const toggleCollapse = useCallback((key) => {
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key); else next.add(key);
          return next;
        });
      }, []);

      const reload = useCallback(async (opts = {}) => {
        if (cwd === null) return;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setStatusLoading(true);
        setStatusError(null);
        try {
          const data = await api(`/api/git.status?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal });
          setStatus(data);
          setSelected(null);
          setDiff(null);
          if (opts.loadLog !== false) {
            try {
              const logData = await api(`/api/git.log?cwd=${encodeURIComponent(cwd)}&limit=60`, { signal: controller.signal });
              setLog(logData.commits ?? []);
              setLogError(null);
            } catch (error) {
              if (error.name !== 'AbortError') setLogError(error.message);
            }
          }
        } catch (error) {
          if (error.name !== 'AbortError') setStatusError(error.message);
        } finally {
          if (controller.signal.aborted === false) setStatusLoading(false);
        }
      }, [cwd]);

      useEffect(() => {
        setStatus(null);
        setLog(null);
        setDiff(null);
        setSelected(null);
        setDetail(null);
        setLogSelected(null); setSearchScope('');
        setSourceTarget(props.previewRequest?.workspaceId === targetWorkspaceId ? props.previewRequest.target : null);
        if (cwd !== null) reload();
      }, [cwd, reload]);

      useEffect(() => {
        if (!props.previewRequest) return;
        setOverrideId(props.previewRequest.workspaceId);
        setSourceTarget(props.previewRequest.target);
      }, [props.previewRequest]);

      useEffect(() => () => abortRef.current?.abort(), []);

      const loadDiff = useCallback(async (entry) => {
        if (cwd === null) return;
        setSelected(entry);
        setDiff(null);
        setDiffLoading(true);
        setReviewOpen(false);
        setReviewError(null);
        try {
          const params = new URLSearchParams({ cwd });
          params.set('path', entry.path);
          if (entry.untracked) params.set('untracked', '1');
          else if (entry.staged && entry.unstagedToo) params.set('both', '1');
          else if (entry.staged) params.set('staged', '1');
          const data = await api(`/api/git.diff?${params.toString()}`);
          setDiff(data);
        } catch (error) {
          setDiff({ error: error.message });
        } finally {
          setDiffLoading(false);
        }
      }, [cwd]);

      const loadCommit = useCallback(async (hash) => {
        if (cwd === null) return;
        setLogSelected(hash);
        setDetail(null);
        setDetailLoading(true);
        setReviewOpen(false);
        setReviewError(null);
        try {
          const data = await api(`/api/git.commit?cwd=${encodeURIComponent(cwd)}&hash=${encodeURIComponent(hash)}`);
          setDetail(data);
        } catch (error) {
          setDetail({ found: false, error: error.message });
        } finally {
          setDetailLoading(false);
        }
      }, [cwd]);

      const diffTagFor = (entry) => t(entry.untracked ? 'diff.untracked' : entry.staged && entry.unstagedToo ? 'diff.both' : entry.staged ? 'diff.staged' : 'diff.unstaged');

      const openReview = useCallback((intent, target) => {
        setReviewIntent(intent === 'explain' ? 'explain' : 'task');
        setReviewTarget(target);
        setReviewSent(false);
        setReviewError(null);
        setReviewCode([]);
        setReviewOpen(true);
      }, []);

      const closeReview = useCallback(() => {
        setReviewOpen(false);
        setReviewError(null);
      }, []);

      const toggleReviewCode = useCallback((line) => {
        setReviewCode((prev) => (prev.some((item) => item.id === line.id) ? prev.filter((item) => item.id !== line.id) : [...prev, line]));
      }, []);

      const clearReviewCode = useCallback(() => setReviewCode([]), []);

      /** Open a workspace file a memory card links to, keeping document-mode and anchor targets. */
      const openCardsDestination = useCallback((destination) => {
        const path = typeof destination === 'string' ? destination : destination?.path;
        if (typeof path !== 'string' || path === '') return;
        setSourceTarget({
          path,
          line: Number.isSafeInteger(destination?.line) && destination.line >= 0 ? destination.line : 0,
          character: Number.isSafeInteger(destination?.character) && destination.character >= 0 ? destination.character : 0,
          ...(typeof destination?.documentMode === 'string' ? { documentMode: destination.documentMode } : {}),
          ...(typeof destination?.documentAnchor === 'string' ? { documentAnchor: destination.documentAnchor } : {}),
          focusSource: true,
        });
      }, []);

      const localeId = () => {
        try {
          const active = getLocale?.();
          return typeof active === 'string' && active.toLowerCase().startsWith('zh') ? 'zh' : 'en';
        } catch (error) { return 'en'; }
      };

      /**
       * Dispatch one AI action into a NEW default DeepSeek conversation. The Host
       * composes the first message; the client only sends the user's text, the
       * selected diff-line texts, the current-view target, and the active locale.
       * The panel then opens the returned conversation.
       */
      const sendReview = useCallback(async (text) => {
        if (cwd === null || reviewTarget === null) return;
        setReviewSending(true);
        setReviewError(null);
        try {
          const body = { cwd, intent: reviewIntent, text, locale: localeId() };
          if (reviewCode.length > 0) body.code = [...reviewCode].sort((a, b) => Number(a.id) - Number(b.id)).map((item) => item.text);
          if (reviewTarget.kind === 'diff' && reviewTarget.entry) body.target = { tag: diffTagFor(reviewTarget.entry), path: reviewTarget.entry.path };
          else if (reviewTarget.kind === 'commit' && reviewTarget.detail) body.target = { tag: t('log.detail'), path: reviewTarget.detail.hash };
          else if (reviewTarget.path) body.target = { tag: t('files.read'), path: reviewTarget.path };
          const data = await api('/api/git.dispatch', { method: 'POST', body });
          if (data.ok === true) {
            setReviewSent(true);
            openSession(data.sessionId);
          } else {
            setReviewError(t('review.admission'));
            if (data.sessionId) openSession(data.sessionId);
          }
        } catch (error) {
          setReviewError(error.message);
        } finally {
          setReviewSending(false);
        }
      }, [cwd, reviewTarget, reviewIntent, reviewCode, t, openSession, getLocale]);

      const query = filter.trim().toLowerCase();
      const filtered = (status?.changes ?? []).filter((entry) =>
        query === '' || entry.path.toLowerCase().includes(query) || entry.displayPath.toLowerCase().includes(query));
      const staged = filtered.filter((entry) => entry.staged);
      const unstaged = filtered.filter((entry) => !entry.staged && !entry.untracked);
      const untracked = filtered.filter((entry) => entry.untracked);
      const treeStaged = useMemo(() => buildTree(staged), [staged]);
      const treeUnstaged = useMemo(() => buildTree(unstaged), [unstaged]);
      const treeUntracked = useMemo(() => buildTree(untracked), [untracked]);

      const toolbar = h('div', { className: 'jb-toolbar' },
        workspaces.length > 0
          ? h('span', { className: 'jb-selectwrap' },
            h('span', { className: 'jb-tool-icon', style: { color: C.textDim } }, folderGlyph()),
            h('select', {
              className: 'jb-select', value: targetWorkspaceId ?? '', disabled: statusLoading,
              onChange: (event) => setOverrideId(event.target.value),
              title: t('repo.select'),
            }, workspaces.map((item) => h('option', { key: item.workspaceId, value: item.workspaceId },
              item.title === item.path ? item.title : `${item.title} — ${item.path}`))))
          : null,
        status?.isRepo
          ? h('span', { className: 'jb-branchinfo' },
            h('span', { className: 'jb-branchchip', title: status.branch ?? t('repo.detached') }, branchGlyph(13), status.branch ?? t('repo.detached')),
            status.head ? h('span', { className: 'jb-headchip' }, status.head) : null,
            (status.ahead > 0 || status.behind > 0)
              ? h('span', { className: 'jb-headchip' }, t('repo.ahead', { ahead: String(status.ahead), behind: String(status.behind) }))
              : null)
          : null,
        h('span', { className: 'jb-spacer' }),
        ...reviewActions(t, cwd === null || reviewSending, (intent) => openReview(intent, { kind: 'workspace' })),
        h('button', { type: 'button', className: 'jb-tb-btn', title: t('panel'), disabled: statusLoading || cwd === null, onClick: () => reload() }, refreshGlyph()));

      const toolLabels = { find: t('search.title'), changes: t('tabs.changes'), log: t('tabs.log'), cards: t('cards.title'), debug: t('debug.title'), terminal: t('terminal.title') };
      const toolBar = h('div', { className: 'jb-tools-bar', role: 'toolbar', 'aria-label': t('tools.title') },
        ...Object.entries(toolLabels).map(([tool, label]) => h('button', {
          key: tool, type: 'button', className: 'jb-tool-toggle', 'data-tool': tool,
          'aria-label': label, title: label, 'aria-pressed': tab === tool, 'aria-controls': toolsId + '-' + tool,
          disabled: tool === 'terminal' ? !props.terminalAvailable || !currentSession?.id : tool === 'cards' ? cwd === null : !status?.isRepo || Boolean(statusError),
          onClick: () => tools.toggle(tool),
        }, toolGlyph(tool))));

      let notice;
      if (status === null && statusLoading) {
        notice = h('div', { className: 'jb-empty' }, t('loading'));
      } else if (statusError !== null) {
        notice = h('div', { className: 'jb-empty' }, t('error.load', { message: statusError }));
      } else if (status === null || !status.isRepo) {
        notice = h('div', { className: 'jb-empty' }, t('repo.notGit'));
      }
      let changesContent = null, logContent = null;
      if (status?.isRepo) {
        const selectedEntry = selected;
        const diffTag = selectedEntry === null ? '' : t(selectedEntry.untracked ? 'diff.untracked' : selectedEntry.staged && selectedEntry.unstagedToo ? 'diff.both' : selectedEntry.staged ? 'diff.staged' : 'diff.unstaged');
        changesContent = h('div', { className: 'jb-changes' },
          h('div', { className: 'jb-tree' },
            h('div', { className: 'jb-filter' },
              searchGlyph(),
              h('input', { type: 'search', value: filter, placeholder: t('filter.placeholder'), onChange: (event) => setFilter(event.target.value) })),
            staged.length > 0
              ? h(ChangeTree, { tree: treeStaged, t, rootLabel: t('group.staged'), rootCount: staged.length, selectedPath: selectedEntry?.path, onSelect: loadDiff, collapsed, toggle: toggleCollapse })
              : null,
            unstaged.length > 0
              ? h(ChangeTree, { tree: treeUnstaged, t, rootLabel: t('group.changes'), rootCount: unstaged.length, selectedPath: selectedEntry?.path, onSelect: loadDiff, collapsed, toggle: toggleCollapse })
              : null,
            untracked.length > 0
              ? h(ChangeTree, { tree: treeUntracked, t, rootLabel: t('group.unversioned'), rootCount: untracked.length, selectedPath: selectedEntry?.path, onSelect: loadDiff, collapsed, toggle: toggleCollapse })
              : null,
            status.total > status.shown
              ? h('div', { className: 'jb-tree-hint' }, t('changes.limited', { shown: String(status.shown), total: String(status.total) }))
              : null),
          h('div', { className: 'jb-detail' },
            diffLoading
              ? h('div', { className: 'jb-diffempty' }, t('loading'))
              : diff !== null && diff.error !== undefined
                ? h('div', { className: 'jb-diffempty' }, t('error.load', { message: diff.error }))
                : h(DiffView, {
                  path: selectedEntry?.displayPath ?? '', tag: diffTag,
                  stats: selectedEntry && !selectedEntry.untracked ? { ins: selectedEntry.ins, del: selectedEntry.del } : null,
                  diff, t, onReadSource: line => { setSourceTarget({ path: selectedEntry.path, line, character: 0, focusSource: true }); },
                  review: { open: reviewOpen && reviewTarget?.kind === 'diff', intent: reviewIntent, sending: reviewSending, sent: reviewSent, error: reviewError },
                  codeSet: reviewCode,
                  onToggleCode: toggleReviewCode,
                  onReview: (intent) => openReview(intent, { kind: 'diff', entry: selectedEntry }),
                  onReviewSend: sendReview,
                  onReviewClose: closeReview,
                  onClearCode: clearReviewCode,
                })));
        const graph = log === null ? null : buildGraph(log);
        logContent = h('div', { className: 'jb-log' },
          logError !== null
            ? h('div', { className: 'jb-notice jb-notice-error' }, logError)
            : null,
          h('div', { className: 'jb-loghead' },
            h('span', { className: 'jb-col-graph' }, ''),
            h('span', { className: 'jb-col-msg' }, t('log.message')),
            h('span', { className: 'jb-col-author' }, t('log.author')),
            h('span', { className: 'jb-col-date' }, t('log.date')),
            h('span', { className: 'jb-col-hash' }, t('log.hash'))),
          log === null
            ? h('div', { className: 'jb-empty' }, t('loading'))
            : log.length === 0
              ? h('div', { className: 'jb-empty' }, t('log.empty'))
              : h('div', { className: 'jb-logbody' }, graph.rows.map((row, index) => {
                const commit = row.commit;
                const isHead = index === 0 && status.branch !== null;
                return h('div', { key: commit.hash, className: 'jb-logrow', 'data-selected': logSelected === commit.hash, onClick: () => loadCommit(commit.hash) },
                  graphRowSvg(row, graph.maxLanes, isHead ? status.branch : null),
                  h('span', { className: 'jb-col-msg', title: commit.subject }, commit.subject),
                  h('span', { className: 'jb-col-author', title: commit.email }, commit.author),
                  h('span', { className: 'jb-col-date' }, fmtDate(commit.date)),
                  h('span', { className: 'jb-col-hash', title: commit.hash }, commit.short));
              })),
          detailLoading
            ? h('div', { className: 'jb-logdetail' }, h('div', { className: 'jb-empty' }, t('loading')))
            : h(CommitDetail, {
              detail, t,
              review: { open: reviewOpen && reviewTarget?.kind === 'commit', intent: reviewIntent, sending: reviewSending, sent: reviewSent, error: reviewError },
              codeSet: reviewCode,
              onToggleCode: toggleReviewCode,
              onReview: (intent) => openReview(intent, { kind: 'commit', detail }),
              onReviewSend: sendReview,
              onReviewClose: closeReview,
              onClearCode: clearReviewCode,
            }));
      }

      return h('div', { className: 'jb-root' },
        h('style', null, css),
        toolbar,
        reviewOpen && reviewTarget?.kind === 'workspace' ? h(ReviewComposer, { t, intent: reviewIntent, sending: reviewSending, sent: reviewSent, error: reviewError, code: reviewCode, onSubmit: sendReview, onClearCode: clearReviewCode, onClose: closeReview }) : null,
        h('div', { className: 'jb-content' },
          status?.isRepo && !statusError ? h('div', { className: 'jb-browser-seat' },
            h(CodeBrowser, { key: cwd, cwd, changes: status.changes, initialTarget: sourceTarget, debugHost, onShowDebug: showDebug, onFindInFiles: openFind,
              onExplain: path => openReview('explain', { kind: 'workspace', path }), desktopPaths: props.desktopPaths, t })) : notice),
        h('div', { className: 'jb-tools-window', hidden: tab === null, style: { height: tools.height } },
          h('div', { className: 'jb-tools-divider', ...tools.divider }),
          h('div', { className: 'jb-tools-header' }, h('span', null, toolLabels[tab]),
            h('button', { type: 'button', className: 'jb-tb-btn', title: t('tools.hide'), 'aria-label': t('tools.hide'), onClick: tools.hide }, '−')),
          ...['find', 'changes', 'log', 'cards', 'debug', 'terminal'].map(tool => h('div', {
            key: tool, id: toolsId + '-' + tool, className: 'jb-tool-panel', 'data-tool': tool,
            hidden: tab !== tool, role: 'region', 'aria-label': toolLabels[tool], ref: tool === 'debug' ? setDebugHost : undefined,
          }, tool === 'find' ? (cwd ? h(WorkspaceSearch, { key: cwd, cwd, scope: searchScope, request: findRequest, active: tab === 'find', onOpen: setSourceTarget, t }) : notice) : tool === 'changes' ? changesContent : tool === 'log' ? logContent
            : tool === 'cards' ? h(CardsPanel, { key: cwd ?? 'none', cwd, active: tab === 'cards', t, onOpen: openCardsDestination })
            : tool === 'terminal'
              ? h(TerminalDock, { key: currentSession?.id ?? 'none', sessionId: currentSession?.id, cwd: currentSession?.cwd,
                available: Boolean(props.terminalAvailable && currentSession?.id && cwd === currentSession.cwd), active: tab === 'terminal', onClose: tools.hide,
                create: props.createTerminal, release: props.releaseTerminal, t }) : null)),
          tools.error ? h('div', { className: 'jb-tools-notice', role: 'alert' }, tools.error) : null),
        toolBar);
    }

    // ------------------------------------------------------------- icon
    /** Localized titles also replace labels captured by previously opened tabs. */
    function WorkbenchTabTitle({ t }) {
      return t('panel');
    }

    /** Fixed-palette artwork matching the official guide canvas and blue palette. */
    function WorkbenchIcon({ size = 36, className }) {
      return h('svg', { viewBox: '0 0 36 36', width: size, height: size, className, 'aria-hidden': true, fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
        h('path', { d: 'M8 13H13V27H10C8.89543 27 8 26.1046 8 25V13Z', fill: '#7FB7FC', fillOpacity: 0.55 }),
        h('rect', { x: 7, y: 8, width: 22, height: 20, rx: 2, stroke: '#679EFE', strokeWidth: 2 }),
        h('path', { d: 'M7 13H29M13 13V28', stroke: '#679EFE', strokeWidth: 2 }),
        h('path', { d: 'M18 18L15.5 20.5L18 23M23 18L25.5 20.5L23 23', stroke: '#679EFE', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }));
    }

    // ------------------------------------------------------------- apply
    function DocumentPreviewBridge({ resource, info, sessionId, useSessions, useWorkspaces, t, openOriginal, isCurrentSession }) {
      const sessions = useSessions(state => state.byId ?? {});
      const workspaces = useWorkspaces(state => state.items);
      const cwd = sessions[resource.sessionId]?.cwd;
      const { tab } = info;
      const [error, setError] = useState(null), [retry, setRetry] = useState(0);
      const originalKind = resource.kind === 'review' ? 'changes-review' : 'text';
      const fallback = () => {
        if (!isCurrentSession(sessionId)) return;
        openOriginal(tab.navigation.address, originalKind, tab.navigation.params, tab.id);
        tab.actions.close();
      };
      useEffect(() => {
        if (!tab.visible || tab.signal.aborted) return;
        const controller = new AbortController();
        const abort = () => controller.abort();
        tab.signal.addEventListener('abort', abort, { once: true });
        setError(null);
        const index = tab.navigation.params?.index ?? 0;
        if (resource.sessionId !== sessionId || !Number.isSafeInteger(index) || index < 0) fallback();
        else resolveDocumentPreview(resource, index, cwd, workspaces, path => api(path, { signal: controller.signal }), tab.navigation.params?.line)
          .then(request => {
            if (controller.signal.aborted || !isCurrentSession(sessionId)) return;
            if (!request) { fallback(); return; }
            tab.actions.openTab(PANEL_ID, { replaceTab: true, params: { documentPreview: request } });
            tab.actions.close();
          })
          .catch(error => { if (!controller.signal.aborted) setError(error.message); });
        return () => { controller.abort(); tab.signal.removeEventListener('abort', abort); };
      }, [tab.visible, tab.navigation.revision, tab.navigation.address, cwd, workspaces, retry]);
      return h('div', { className: 'jb-root' }, h('style', null, css),
        h('div', { className: 'jb-empty', role: error ? 'alert' : 'status' }, error ? [
          h('span', { key: 'error' }, t('error.load', { message: error })),
          h('button', { key: 'retry', className: 'jb-btn', onClick: () => setRetry(value => value + 1) }, t('preview.retry')),
          h('button', { key: 'original', className: 'jb-btn', onClick: fallback }, t('preview.original')),
        ] : t('loading')));
    }

    const inject = { slots: { required: true }, locale: { required: true }, uiWorkspace: { required: true }, sidebarRightTabs: { required: true }, sidebarRight: { required: true }, webTerminals: { required: false }, remote: { required: false }, 'remote.session': { required: false } };
    function apply(ctx) {
      const openSession = (id) => ctx.uiWorkspace.openSession(id);
      const terminals = ctx.get?.('webTerminals') ?? ctx.webTerminals;
      const desktopPaths = ctx.remote?.session;
      const activeTerminals = new Set();
      const releaseTerminal = entry => { if (!activeTerminals.delete(entry)) return; terminals.close(entry.sessionId, entry.key, entry.key); };
      ctx.effect(() => () => { for (const entry of [...activeTerminals]) releaseTerminal(entry); }, 'workbench: embedded terminals');
      const createTerminal = sessionId => {
        const key = 'dsh-workbench-terminal:' + window.crypto.randomUUID();
        const entry = { sessionId, key, model: terminals.view(sessionId, key, key) };
        activeTerminals.add(entry); return entry;
      };
      // The dispatch payload carries the active locale id ('zh' | 'en'); read it lazily at send time.
      const getLocale = () => {
        try { return ctx.locale.getLocale?.()?.active ?? 'en'; }
        catch (error) { return 'en'; }
      };
      const Panel = (props) => h(WorkbenchPanel, { ...props, openSession, getLocale, desktopPaths, terminalAvailable: Boolean(terminals && typeof require.async === 'function'), createTerminal, releaseTerminal });
      const SidebarPanel = props => {
        const info = props.useTabInfo?.();
        const navigation = info?.tab.navigation;
        const request = useMemo(() => navigation?.params?.documentPreview, [navigation?.revision, navigation?.params]);
        const resource = navigation && parsePreviewAddress(navigation.address);
        return resource ? h(DocumentPreviewBridge, { ...props, resource, info,
          isCurrentSession: sessionId => ctx.sidebarRight.mounted.getSnapshot() === sessionId,
          openOriginal: (address, kind, params, replaceTab) => ctx.sidebarRight.openResource(address, { kind, params, replaceTab }) })
          : h(WorkbenchPanel, { ...props, openSession, getLocale, desktopPaths, previewRequest: request, terminalAvailable: Boolean(terminals && typeof require.async === 'function'), createTerminal, releaseTerminal });
      };
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'workbench: dictionaries');
      const t = ctx.locale.bind(NS);
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main', key: PANEL_ID, locale: NS,
      }, Panel));
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID, kind: PANEL_ID, title: () => t('panel'),
        keepMounted: true,
        patterns: previewPatterns,
        canOpen: address => parsePreviewAddress(address) !== null,
        guide: [{ id: PANEL_ID, order: 40, title: () => t('panel'), description: () => t('guide.description'), icon: WorkbenchIcon }],
      }), 'workbench: right sidebar type');
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS,
      }, SidebarPanel)), 'workbench: right sidebar body');
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NS,
      }, WorkbenchTabTitle)), 'workbench: right sidebar title');
    }
    return { inject, apply };
  },
});
