# Workbench user guide

[Project overview](README.en.md) | [中文](USAGE.md)

## Use

Expand a conversation's right sidebar and choose **Development workbench** from Start or More tools. The tab follows its own conversation's project; the repository selector can inspect other registered workspaces. Previously opened Git tabs also show the workbench name in the current language without clearing the layout.

| Area or tool | Actions and results |
| --- | --- |
| Files | The directory tree includes tracked and untracked files, excludes Git-ignored files, and annotates Git status. Expand directories or filter paths; select a file to read its current workspace source. |
| Source reader | The read-only editor has continuous scrolling, syntax highlighting, line numbers, a caret and text selection, without paging or a navigation toolbar. |
| Git diff | Right-click a file or its source and choose Diff. Double-click a diff line or press F4 to read the corresponding current source. |
| Changes | Groups staged, worktree and untracked files, with line statistics and unified diffs. Double-click a diff line or press F4 to open current source. |
| Log | Shows the commit graph, author, date and hash. Select a commit for file statistics and its full diff. |

Five persistent bottom icons open Find, Changes, History, Debugger, and Terminal; hovering reveals their names. Switch tools in the same window, or click the selected icon or header minus to collapse it. Code stays visible, and switching retains the caret, Git selection, stack frame, expanded variables, and terminal output. Drag the top edge to adjust the shared tool height; the file-tree divider independently adjusts width or height in narrow layouts. Arrow keys resize a focused divider, Shift uses larger steps, and Home/End select its limits. Double-click or Enter resets the size. Cancelling or Escape restores the previous size; committed sizes are saved.

Right-click a file or directory (Shift+F10 from the keyboard) to copy its name, workspace-relative path, or absolute path. If clipboard access is unavailable, selected read-only text is offered for manual copying. Directories also support recursive expansion/collapse, filename filtering, and scoped content search. The tree’s locate icon clears the filter, expands ancestors and scrolls to the current file; its magnifier opens project content search. Files under the workspace root’s `.dsh` directory remain visible in the tree when Git ignores them, including personal memory cards. When the desktop file manager is available, the context menu can open a directory or reveal the selected file in Finder or Explorer.

Use ⌘F/Ctrl+F or the file menu to find within a file, without replacement; F3/Shift+F3 selects the next/previous match. Open project content search from the bottom Find icon, directory menu, or ⌘⇧F/Ctrl+Shift+F inside the workbench, then press Enter to submit. Search accepts literal text and a case toggle, shows one result per matching line, and opens current source at that position. It searches Git-tracked and nonignored new files, skipping binary, non-UTF-8, over-512-KiB and out-of-workspace files. Defaults return up to 200 lines, inspect 500 candidate files, and allow 2 MiB of Git output. Adjust these budgets through plugin configuration: `searchMaxResults` (1–2000), `searchMaxFiles` (1–10000), and `searchMaxOutputBytes` (1024–16777216). Result limits prompt a narrower query; exceeding the output budget fails visibly. Search never modifies files or Git state.

Plain clicks place the caret or select text without querying definitions. A caret on a name highlights that word and matching case-sensitive whole words in the visible source, preserving syntax colors and outlining the current word. Selecting a whole word highlights its other matches; partial words or a caret on a blank line clear the marks. Matches use text, including the same words in strings and comments, and update when scrolling or changing files. Definition navigation locates and highlights the destination line; multiple destinations appear in a floating chooser. Switching Files/Changes/Log retains reading state, and Back restores the call-site caret. Narrow sidebars stack the tree above the reader.

Source keeps open-file tabs. The tree, definitions, and stack frames open or select their file, reusing the tab for the same path. Selecting a tab restores its caret and scroll position; changed files restore only the valid caret position. Right-click a file tab or press Shift+F10 on it to close it, close the other tabs, or close all tabs. Closing the other tabs keeps the file whose menu you opened. You can also close with the close icon, middle-click, or Delete on a tab; switch with Left/Right and Home/End. Tabs scroll horizontally in narrow panes; duplicate basenames show their paths. Tabs and positions stay in panel memory without caching source text. Closing a tab does not end debugging, and Back/Forward can reopen a file from navigation history.

Use arrows beside line numbers to fold or unfold syntax-recognized code blocks; clicking the ellipsis also unfolds them. Python, Go, Java, JavaScript and TypeScript fold functions, classes and nested blocks according to their grammars, without guessing indentation for unknown files. Switching files retains folds for the same content version; changed content clears old folds. Definition jumps, line navigation and debugging expand blocks containing a hidden destination. Folds remain in the current panel’s memory only.

Markdown (`.md`/`.markdown`/`.mdown`) opens in a reading preview with heading hierarchy, emphasis, lists, tasks, quotes, tables, inline code, and language-highlighted fenced blocks. The document view can switch to source with line numbers and original markup. A leading YAML header appears in the preview as a title, tags, and metadata fields. View changes reuse the editor; file tabs and Back/Forward retain reading positions. Relative links open workspace files, including heading anchors and `#Lline` destinations; HTTP(S) links open a new window. Raw HTML is omitted, and images show their descriptions without automatic resource requests.

When enabled, the plugin opens conversation links to Markdown, Python, Go, Java, JavaScript, and TypeScript in the workbench. A source link with a line number lands on that line. A Markdown row in a changed-files card, or its header when the first file is Markdown, opens the current document on disk. Existing workbench file tabs are reused; the card still says “Preview in sidebar”. Code change cards, unsupported formats, deleted documents, non-Git projects, and files outside registered workspaces keep the original Harness preview. A failed summary read offers Retry and the original preview. Reading shows the current file rather than the turn’s historical snapshot; use the workbench Git diff to inspect document changes line by line. Disabling the plugin restores the host’s default viewer for newly opened files.

JSON, YAML, TOML, INI/properties/`.env`, shell, and Makefile receive basic syntax highlighting. Markdown source distinguishes headings, emphasis, links, and code markers. Preview and source follow the host light/dark theme; wide code blocks and tables scroll within their own regions.

Same-file definition jumps, frame selection, and stepping reuse the current source and editor without rereading the file. A target that stays inside the visible area keeps its scroll position; a target outside it or flush against a vertical edge is centered so the code around it is readable. Cross-file navigation reuses the editor and retains the previous source and title while loading or after failure, identifying the requested path. Source actions are blocked until loading succeeds; ending debugging remains available. Reselecting a file or refreshing the repository rereads its contents, and definition queries still check the disk version. Loading and query notices do not shift code.

| Action | Gesture or shortcut while source has focus |
| --- | --- |
| Definition | ⌘/Ctrl+click a symbol, or F12 |
| Back / Forward | ⌘[ / ⌘]; Ctrl+Alt+Left / Right on Windows/Linux; mouse back/forward buttons also work |
| Go to line/column | ⌘L on macOS, Ctrl+G on Windows/Linux. Enter `line[:column]` and press Enter |
| Fold / Unfold current block | ⌘⌥[ / ⌘⌥] on macOS; Ctrl+Shift+[ / ] on Windows/Linux |
| Fold / Unfold all | Ctrl+Alt+[ / ]; Control+Option+[ / ] on macOS |
| More actions | Right-click, or Shift+F10 |
| Dismiss menus and line prompts | Escape or an outside click |

⌘B/Ctrl+B also navigates when the host forwards it. Harness Desktop binds this combination to its global sidebar and handles it before the editor. The plugin preserves global keybindings and uses F12 and modifier-click by default.

Two actions are available in the toolbar, change diff, and commit detail. Assign a task creates a new conversation and hands a fix or feature change to the default DeepSeek conversation, without extra skills or workflows. Explain it to me also creates a default DeepSeek conversation, explains the selected code or question in plain language, and writes reviewable memory cards into the workspace. Only a path or commit hash is attached by default; code is included only for manually selected diff lines. If admission is uncertain, the created conversation is retained: check its messages before sending again.

## Bottom terminal

Click Terminal at the bottom of the workbench to start a shell in the current session workspace. The screen loads on demand and supports interactive input, shell completion, Ctrl+C, ANSI colors, and scrollback through the official Harness terminal controller. The terminal uses the shared tool-window height. Switching tools or collapsing the window keeps its process running. Closing the terminal, closing its owning workbench, or unloading the plugin requests process termination; switching to another session never creates a shell automatically. New terminals are available only for the current session workspace, not an overridden repository. Commands run as the execution-environment user independently of Agent file-access modes; output is not automatically sent to the model. Enable the official terminal controller and use a Harness version supporting lazy client chunks. Retry failed connections; close an exited shell before starting another.

## Memory cards

Explain it to me assigns each new explanation conversation one Markdown path under the workspace `cardsDir` folder (default `.dsh/cards`) and asks it to update the same card for follow-ups. The YAML header records `title`, `tags`, `kind`, and `source` when known. The card starts with a recap of the original question, keeps the full explanation and worked example, and ends with a recall question. Choose Explain it to me from a file’s tree menu to link the source. New cards use the nearest two source directories, `root` for root files, or `general` without a source. The Memory cards tool groups by archive folder and uses source metadata to group older cards in the root. Search by title, summary, tag, source, or path. Cards are ordinary files and can be committed like any other source. Set `cardsDir` in plugin settings to use another folder. Listings skip links that resolve outside the card directory or workspace.

## Image and icon previews

Click PNG/APNG, JPEG, GIF, WebP, BMP, AVIF, ICO, SVG, or ICNS files to preview them in file tabs. Images fit the pane by default, with actual-size and zoom controls; the status bar shows pixel dimensions and file size. A theme-aware checkerboard shows transparency. SVG offers read-only source up to 512 KiB and renders only as an isolated image, never as markup inserted into the workbench page. ICNS selects its largest embedded PNG; legacy bitmap and JPEG 2000 encodings are unsupported. Images must be regular files inside the workspace. Set `imagePreviewMaxBytes` in plugin settings to 1024–33554432 bytes; the default is 8388608 (8 MiB). Decode failures, damaged containers, and oversized files show a message. Other binary files have no preview, and Git diffs keep their binary-file message. Inline Markdown images retain their description-only behavior.

## Five-language support and configuration

All five languages support syntax highlighting, read-only source, project-local cross-file function/type definitions, and the same shortcuts and context menus. Configured Harness `ctx.lsp` providers take priority; otherwise the plugin uses the following local services.

The plugin follows Harness light/dark themes and theme color variables across the file tree, source, diffs, selections, and popup menus; switching themes preserves the current file and caret. Text selections use the host document-selection color, retaining it on focus and blur instead of reverting to the editor’s default light palette. Syntax highlighting reuses the host code-block palette for keywords, functions/methods, type declarations and annotations, properties, decorators, strings, numbers, and comments. Language syntax trees determine highlighting; names inside strings and comments retain their category, while expressions inside Python f-strings and JS template strings receive their own colors. Highlighting does not use LSP semantic tokens or infer a plain variable's type from its name.

| Language | Navigation engine | Requirements |
| --- | --- | --- |
| JavaScript / TypeScript | TypeScript compiler language service | Installed with npm dependencies; handles `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts` and the nearest `tsconfig.json`/`jsconfig.json` |
| Python | Pyright | Installed with npm dependencies; handles `.py`/`.pyi` and project Python/Pyright configuration |
| Go | gopls | Install gopls and a compatible Go toolchain; project `go.mod`/`go.work` and dependencies must resolve |
| Java | Eclipse JDT LS | Install JDT LS and its required JDK; the verified combination here is JDT LS 1.50.0 with Java 21 |

See the [gopls documentation](https://go.dev/gopls/) for installation and toolchain requirements, and the [JDT LS documentation](https://github.com/eclipse-jdtls/eclipse.jdt.ls) for distributions and runtime requirements. Record installed absolute paths from the plugin directory:

```sh
npm run setup:languages -- \
  --gopls /absolute/path/to/gopls \
  --jdtls-home /absolute/path/to/jdt-language-server \
  --java-home /absolute/path/to/jdk-21
```

This command downloads nothing and changes no global PATH, JAVA_HOME or IDE settings. It writes validated commands to Git-ignored `.tools/servers.json`; reload the workbench plugin afterward. Use only `--gopls` to configure Go alone; Java's two directory arguments must be supplied together. Python, JS and TS need no setup command. Machine paths and Java server files under `.tools` are excluded from the plugin package.

Alternatively, configure `languageServers.go`, `languageServers.java`, and `languageServers.python` in the workbench plugin settings. Explicit settings override the private setup file. Each server accepts:

| Field | Meaning |
| --- | --- |
| `command` | Required absolute executable or PATH command, launched without a shell |
| `args` / `env` | Arguments and extra environment, defaulting to an empty array/object |
| `settings` | LSP configuration object; configure Python environments through Pyright settings such as `python.pythonPath` |
| `initializationOptions` | Initialization options, defaulting to an empty object |
| `waitForJavaReady` | Inherits the language preset by default; JDT LS waits for `ServiceReady`, other servers do not |

Top-level `navigationTimeoutMs` defaults to 120000 and covers cold startup and queueing; `serverKillGraceMs` defaults to 1500. `useInstalledServers` defaults to true; disable it to use only explicit settings and built-in presets. The Go and Java preset commands are `gopls` and `jdtls`; Python runs the bundled Pyright through managed Node.

## Navigation behavior and limits

- Stdio servers start lazily per workspace/language and remain alive. Each instance serializes queries and opens/closes the current source per request. Cancelling an active query terminates that instance; the next request starts a fresh one. Cancelling only a queue waiter leaves earlier queries running. Plugin unload rejects new work, cancels queries, waits for process exit, and removes temporary Java index directories.
- Java indexes use a separate temporary directory. Automatic builds and Eclipse metadata at the source root are disabled; the setup script also supplies the corresponding JVM property. Servers still import projects and resolve dependencies. Maven import can create empty `target/classes` and `target/test-classes` output directories, depending on the server version and project configuration.
- The client refuses server-requested workspace edits and executes no server-supplied commands. Built-in navigation requires a local filesystem; remote filesystems need a Harness LSP provider in the same execution environment.
- Queries use current source. Historical diffs, old revisions and deleted files cannot be queried as current source. Regular Python/Go/Java/JS/TS source or declaration files outside the workspace, returned by the language service, open in read-only tabs marked “Library” and support further definitions and history. `.pyi` and `.d.ts` are type declarations rather than implementation bodies. Reads use the Harness filesystem and temporary references scoped to the original workspace, never arbitrary absolute-path requests. Retargeted paths are rejected. `navigationMaxLibrarySources` defaults to 256 (range 1–4096); least-recently-used references are evicted and plugin reload clears them. Navigate from project source again after expiration. JAR virtual addresses, native binaries and missing source remain unavailable; nothing is downloaded or decompiled automatically.
- Source must be regular UTF-8 text of at most 512 KiB. Positions are zero-based UTF-16. Changes before or during a query invalidate the old position; reopen the file before navigating again.
- JS/TS follows the host filesystem’s case rules and uses a separate compiler thread per query, with awaited termination on completion, failure or cancellation. Missing servers, protocol failures and timeouts are reported while source remains readable. Unconfigured project dependencies and virtual environments can prevent some import resolution.

## Breakpoint debugging

After installing adapters, press F5 to debug the current Python, Go, or JS entry file; TS requires generated JS and source maps. Attach from the context menu using a local debugger port or Go process ID. Debugging shares the bottom tool window with Changes, History, and Terminal. Starting debugging or reaching a new breakpoint stop selects it automatically; switching tools does not end debugging. `.dsh/debug.json` is optional for custom project arguments. See [Debug configuration](DEBUGGING.en.md) for details, shortcuts, and process ownership. Programs execute only after an explicit launch or attach action.

## Implementation and verification

`index.js` registers seven read-only GET routes inside Connection authentication: `/api/git.status`, `.diff`, `.log`, `.commit`, `.tree`, `.source`, `.definition`, plus the `.dispatch` conversation POST route and the `.cards`/`.card` memory-card GET routes. Debugging adds `.debug.configurations` and `.debug.status` GET routes and a `.debug.action` POST route for explicit program execution. Requests accept registered workspaces only; ordinary source reads and definition destinations check canonical workspace containment, while library source returned by the language service uses temporary references scoped to the original workspace. `navigation.js` owns paths, file limits, freshness and provider selection; `typescript-worker.js` calls the compiler language service. `language-config.js` validates launch settings, while `language-servers.js` runs Go/Java/Python servers through managed subprocesses and vscode-jsonrpc. `client.source.js` registers the right tab through `sidebarRightTabs` and retains the legacy `main` registration. `source-editor.js` owns the CodeMirror read-only editor and destroys its instance on unmount. `build-client.mjs` bundles the client modules and editor dependencies into `client.js`, using the host React/React DOM without network dependencies. Rebuild after editing client source.

```sh
npm ci
node --check index.js
node --check navigation.js
node --check typescript-worker.js
node --check client.source.js
node --check source-editor.js
npm test
npm run test:languages  # requires configured real gopls and JDT LS
npm pack --dry-run
```

Tests cover real Git file enumeration, real compiler and Pyright cross-file/type/shadowing/UTF-16/JavaScript navigation, path and file restrictions, LSP results, stale source, protocol errors, refused server edits, cancellation and disposal draining, and DOM caret/read-only selection/modifier-click/menu/line navigation/source/diff/history interactions. The Chinese output snapshot is `test/fixtures/navigation.expected.json`. Desktop verification covers the right-side file tree, real source reading, F12 cross-file definitions, and ⌘[ back to the call site. Narrow layouts use container queries; acceptance at actual narrow widths is still pending.

The editor uses [CodeMirror](https://codemirror.net/) (MIT). Controls use Lucide icons (ISC); file-type icons originate from vscode-icons (MIT).

## Python class relationships

The pane identifies the active file’s language first, or the project file types when no file is open. Python (`.py`/`.pyi`) class relationships are in Beta. Unsupported types, including JavaScript and TypeScript, show a language-specific notice without scanning Python; select a Python file in mixed-language projects.

Use the class-tree icon in the file tree toolbar or the Python source context menu to open a diagram beside the code. It splits to the right by default or can dock below; when the reading area's width is at most 660 pixels, the right preference automatically stacks below the code. Drag the divider to resize; arrow keys make small adjustments, Shift increases the step, Home/End select the minimum/maximum, and double-click or Enter restores the default. Width and height are stored separately on this device. Layout changes and smaller windows clamp the actual size while retaining code space; cancelled drags are not saved. The diagram stays within the workbench height and does not cover source. Navigation, resizing and closing retain the editor. The initial 80% zoom preserves readable labels; “Fit diagram to pane” scales the overview to available space, while manual zoom keeps its scale on resize. Short panes hide auxiliary descriptions, leaving the canvas independently scrollable and pannable.

“Hierarchy” and “Diagram” reuse the same index; switching neither rescans nor recreates the editor, and the view preference is stored on this device. The hierarchy expands concrete classes beneath bases/protocols and labels factory associations separately. Classes expand to methods; repeated nodes from multiple inheritance or cycles become reference leaves. Use arrows to move, left/right to collapse/expand, Home/End, and double-click or Enter/F4 to open source. Click methods to navigate; tooltips show full signatures and paths. The tree displays at most 300 rows; collapse branches to reveal more. The class containing the caret takes priority; outside a class, related public declarations in the current file are preferred, while factory files focus their annotated protocol. Select a class to focus its connected graph, double-click or press Enter/F4 on its name to open source, and click a method to jump to its definition. Compact UML compartments show class/abstract/Protocol icons, method parameters and return annotations; inheritance uses solid lines, declared Protocol bases use dashed lines, factory return associations use dotted lines with open arrowheads, and abstract methods are italic. Expand factory evidence to see the function and return location; click it to read the source. Search classes, zoom and drag empty canvas space to pan. The pane stays open while reading source; Esc inside it closes it. Refresh rebuilds the index, and source jumps reject files changed since scanning.

The bundled Python grammar parser reads existing `.py`/`.pyi` syntax trees through the workspace filesystem. It does not import or run project code, invoke a language server, or require annotations, registration, decorators, or extra project configuration. It resolves declared bases, nested classes, import aliases, relative imports and simple reexports; abstract-method labels and override markers use declared methods and static C3 order. Ordinary module-level functions with an existing Protocol return annotation and a direct, resolvable class constructor return produce factory associations, including branch-local and relative imports. These record source assembly intent, do not guarantee compatible method signatures, and never participate in inheritance or abstract-method calculations. Unannotated factories, indirect variable or wrapper returns, generators, async or decorated factories are not inferred; shadowed local names are not guessed. Class decorators can alter runtime behavior. Dynamic base expressions, ambiguous/rebound names, external bases and unknown imports remain unresolved. Other implicit Protocol implementations and classes local to functions are not inferred. Valid bare `yield` is accepted; incomplete or unsupported syntax skips the entire file and is reported.

The index covers Git-visible tracked and untracked files, excluding ignored paths. Plugin scan settings are `classGraphMaxFiles` (default 500, range 1–10000), `classGraphMaxClasses` (800, 1–2000), `classGraphMaxBytes` (4194304, 1024–33554432), and `classGraphExcludedDirectories` (defaults: `.venv`, `venv`, `__pycache__`, `node_modules`). Individual source files retain the 512 KiB reader limit; the canvas shows at most 100 connected classes. Scan and display limits, skipped files and unresolved bases appear explicitly; the diagram represents source declarations rather than a runtime object graph.
