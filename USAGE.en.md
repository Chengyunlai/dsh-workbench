# Workbench user guide

[Project overview](README.en.md) | [中文](USAGE.md)

## Use

Expand a conversation's right sidebar and choose **Development workbench** from Start or More tools. The tab follows its own conversation's project; the repository selector can inspect other registered workspaces.

| View | Actions and results |
| --- | --- |
| Files | The directory tree includes tracked and untracked files, excludes Git-ignored files, and annotates Git status. Expand directories or filter paths; select a file to read its current workspace source. |
| Source reader | The read-only editor has continuous scrolling, syntax highlighting, line numbers, a caret and text selection, without paging or a navigation toolbar. |
| Git diff | Right-click a file or its source and choose Diff. Double-click a diff line or press F4 to read the corresponding current source. |
| Changes | Groups staged, worktree and untracked files, with line statistics and unified diffs. Double-click a diff line or press F4 to open current source. |
| Log | Shows the commit graph, author, date and hash. Select a commit for file statistics and its full diff. |

Drag the dividers between the file tree, reader, and debugger to resize their panes; the reader uses the remaining space. Right docking adjusts width; bottom docking and narrow stacked layouts adjust height, with independent stored sizes. Focus a divider and use arrow keys for fine changes, Shift for larger steps, and Home/End for its allowed minimum/maximum. Double-click or Enter resets that direction to its default. Cancelled drags or Esc restore the previous size; reopening restores committed adjustments.

Plain clicks place the caret or select text without querying definitions. A caret on a name highlights that word and matching case-sensitive whole words in the visible source, preserving syntax colors and outlining the current word. Selecting a whole word highlights its other matches; partial words or a caret on a blank line clear the marks. Matches use text, including the same words in strings and comments, and update when scrolling or changing files. Definition navigation locates and highlights the destination line; multiple destinations appear in a floating chooser. Switching Files/Changes/Log retains reading state, and Back restores the call-site caret. Narrow sidebars stack the tree above the reader.

Source keeps open-file tabs. The tree, definitions, and stack frames open or select their file, reusing the tab for the same path. Selecting a tab restores its caret and scroll position; changed files restore only the valid caret position. Close using the close icon, middle-click, or Delete; switch with Left/Right and Home/End. Tabs scroll horizontally in narrow panes; duplicate basenames show their paths. Tabs and positions stay in panel memory without caching source text. Closing a tab does not end debugging, and Back/Forward can reopen a file from navigation history.

Markdown (`.md`/`.markdown`/`.mdown`) opens in a reading preview with heading hierarchy, emphasis, lists, tasks, quotes, tables, inline code, and language-highlighted fenced blocks. The document view can switch to source with line numbers and original markup. View changes reuse the editor; file tabs and Back/Forward retain reading positions. Relative links open workspace files, including heading anchors and `#Lline` destinations; HTTP(S) links open a new window. Raw HTML is omitted, and images show their descriptions without automatic resource requests.

JSON, YAML, TOML, INI/properties/`.env`, shell, and Makefile receive basic syntax highlighting. Markdown source distinguishes headings, emphasis, links, and code markers. Preview and source follow the host light/dark theme; wide code blocks and tables scroll within their own regions.

Same-file definition jumps, frame selection, and stepping reuse the current source and editor without rereading the file. Visible targets keep their scroll position; offscreen targets scroll only as far as needed. Cross-file navigation reuses the editor and retains the previous source and title while loading or after failure, identifying the requested path. Source actions are blocked until loading succeeds; ending debugging remains available. Reselecting a file or refreshing the repository rereads its contents, and definition queries still check the disk version. Loading and query notices do not shift code.

| Action | Gesture or shortcut while source has focus |
| --- | --- |
| Definition | ⌘/Ctrl+click a symbol, or F12 |
| Back / Forward | ⌘[ / ⌘]; Ctrl+Alt+Left / Right on Windows/Linux; mouse back/forward buttons also work |
| Go to line/column | ⌘L on macOS, Ctrl+G on Windows/Linux. Enter `line[:column]` and press Enter |
| More actions | Right-click, or Shift+F10 |
| Dismiss menus and line prompts | Escape or an outside click |

⌘B/Ctrl+B also navigates when the host forwards it. Harness Desktop binds this combination to its global sidebar and handles it before the editor. The plugin preserves global keybindings and uses F12 and modifier-click by default.

Suggest to AI in the toolbar, change diff or commit detail creates a new project conversation. Only a path or commit hash is attached by default; code is included only for manually selected diff lines. If admission is uncertain, the created conversation is retained: check its messages before sending again.

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
- Queries use current workspace source. Historical diffs, old revisions and deleted files cannot be queried as current source. Outside-workspace definitions are counted and reported, never read automatically; dependency declarations inside the workspace can be opened.
- Source must be regular UTF-8 text of at most 512 KiB. Positions are zero-based UTF-16. Changes before or during a query invalidate the old position; reopen the file before navigating again.
- JS/TS uses a separate compiler thread per query, with awaited termination on completion, failure or cancellation. Missing servers, protocol failures and timeouts are reported while source remains readable. Unconfigured project dependencies and virtual environments can prevent some import resolution.

## Breakpoint debugging

After installing adapters, press F5 to debug the current Python, Go, or JS entry file; TS requires generated JS and source maps. Attach from the context menu using a local debugger port or Go process ID. The debugger defaults to the right; its Dock selector moves it to the bottom and remembers the choice. `.dsh/debug.json` is optional for custom project arguments. See [Debug configuration](DEBUGGING.en.md) for details, shortcuts, and process ownership. Programs execute only after an explicit launch or attach action.

## Implementation and verification

`index.js` registers seven read-only GET routes inside Connection authentication: `/api/git.status`, `.diff`, `.log`, `.commit`, `.tree`, `.source`, `.definition`, plus the `.review` conversation POST route. Debugging adds `.debug.configurations` and `.debug.status` GET routes and a `.debug.action` POST route for explicit program execution. Requests accept registered workspaces only; the new source route and definition destinations check canonical workspace containment. `navigation.js` owns paths, file limits, freshness and provider selection; `typescript-worker.js` calls the compiler language service. `language-config.js` validates launch settings, while `language-servers.js` runs Go/Java/Python servers through managed subprocesses and vscode-jsonrpc. `client.source.js` registers the right tab through `sidebarRightTabs` and retains the legacy `main` registration. `source-editor.js` owns the CodeMirror read-only editor and destroys its instance on unmount. `build-client.mjs` bundles the client modules and editor dependencies into `client.js`, using the host React/React DOM without network dependencies. Rebuild after editing client source.

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
