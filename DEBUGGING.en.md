# Debug configuration

English | [中文](DEBUGGING.md)

The development workbench supports local Python, Go, and Node.js JavaScript/TypeScript debugging. Source browsing and Git operations remain read-only; launched programs execute normally, including their filesystem, network, and database effects. Use your prepared development configuration.

## Adapters

Install [debugpy](https://github.com/microsoft/debugpy), [Delve](https://github.com/go-delve/delve), and the [standalone vscode-js-debug DAP release](https://github.com/microsoft/vscode-js-debug/releases) as needed. Adapters and machine paths are excluded from the plugin package. Choose a Python interpreter with debugpy installed, and a Delve-compatible Go toolchain. Compile TS to JS with source maps beforehand; the plugin does not run build tasks.

```sh
npm run setup:debuggers -- \
  --python /absolute/path/to/venv/bin/python \
  --dlv /absolute/path/to/dlv \
  --js-debug /absolute/path/to/js-debug/src/dapDebugServer.js
```

Any option can be supplied independently. The script validates files and writes `.tools/debug-adapters.json`, preserving Python virtual-environment executable paths and leaving global settings unchanged. Reload the plugin. When extracting the standalone JS adapter inside an ESM project, add `package.json` containing `{"private":true,"type":"commonjs"}` to its root so the parent project does not interpret its CJS bundles as ESM.

Alternatively set `debugAdapters.python`, `.go`, or `.javascript` in plugin settings, with `command`, `args`, `env`, and `transport` (`stdio` or `tcp`). TCP adapters must bind `127.0.0.1:0` and announce `127.0.0.1:<port>` on stdout; the plugin connects to that dynamic port. Managed subprocesses run without a shell. Explicit settings override the private file; `useInstalledDebugAdapters: false` disables that file. `debugTimeoutMs` defaults to 30000 and `debugOutputChars` to 65536; large Go projects can require a longer timeout.

## Debug the current file

Without a launch configuration, press F5 in source to debug the current file; `.dsh/debug.json` is optional. Python runs the script using the workspace `.venv` interpreter when present, otherwise the adapter interpreter. Go builds the containing package, using test mode for `_test.go`. JS/MJS/CJS run under the host Node executable. The working directory defaults to the workspace root.

TS/MTS/CTS require existing JavaScript and source maps. Discovery checks adjacent output, then explicit `rootDir` and `outDir` in the nearest `tsconfig.json`; it does not resolve inherited configurations, build, or install dependencies. Use a project configuration for complex output paths, arguments, environment variables, other Python environments, or a different working directory. Existing launch configurations take priority; invalid configurations remain visible errors.

Choose attach from the source context menu. Without an attach configuration, a prompt accepts a language and local debugger port, or a Go process ID. Enter attaches and Escape cancels. Discovery never scans or attaches to other programs automatically. The debugger must already listen on the selected port; an ordinary service port or an unrelated process ID does not enable debugging.

## Custom workspace configuration

To customize launch or attach arguments, create the optional `.dsh/debug.json` in a registered workspace. JSON comments are accepted. Each entry in `configurations` requires a unique `name`, a `language` (`python`, `go`, `javascript`, or `typescript`), a `request` (`launch` or `attach`), and adapter `arguments`. Only `${workspaceFolder}` is substituted; command variables, tasks, automatic builds, and configuration scripts are unsupported.

```json
{
  "configurations": [
    {
      "name": "Python", "language": "python", "request": "launch",
      "arguments": {"program": "${workspaceFolder}/main.py", "cwd": "${workspaceFolder}"}
    },
    {
      "name": "Attach Python", "language": "python", "request": "attach",
      "arguments": {"connect": {"host": "127.0.0.1", "port": 5678}}
    },
    {
      "name": "Go", "language": "go", "request": "launch",
      "arguments": {"mode": "debug", "program": "${workspaceFolder}", "cwd": "${workspaceFolder}"}
    },
    {
      "name": "Attach Go", "language": "go", "request": "attach",
      "arguments": {"mode": "local", "processId": 12345}
    },
    {
      "name": "Node", "language": "javascript", "request": "launch",
      "arguments": {"type": "pwa-node", "program": "${workspaceFolder}/main.js", "cwd": "${workspaceFolder}"}
    },
    {
      "name": "Attach Node", "language": "javascript", "request": "attach",
      "arguments": {"type": "pwa-node", "address": "127.0.0.1", "port": 9229}
    },
    {
      "name": "TS", "language": "typescript", "request": "launch",
      "arguments": {"type": "pwa-node", "program": "${workspaceFolder}/dist/main.js", "cwd": "${workspaceFolder}", "sourceMaps": true, "outFiles": ["${workspaceFolder}/dist/**/*.js"]}
    }
  ]
}
```

Python attaches to the port from `debugpy.listen()` or `python -m debugpy --listen 127.0.0.1:5678 ...`. Node attaches through js-debug to an inspector started with `node --inspect=127.0.0.1:9229 ...`; an inspector port is not a DAP port. Go PID attachment requires operating-system debugging permissions. Existing Delve DAP servers can use `mode: "remote"` and `connect: { "host": "127.0.0.1", "port": ... }`; configure Delve multi-client mode if it must remain alive after disconnect. Direct Python/Go DAP connections accept loopback addresses only.

TS launch pauses at entry by default, allowing original-source maps to become available. Continue with F5 to hit `.ts` breakpoints and step in original TS. `stopOnEntry` may be explicitly configured. Breakpoint lines must exist in workspace source; adapters report whether blank or non-executable lines can bind.

## Interaction and ownership

Opening source shows a debugger toolbar grouped into execution (start/resume, end, pause), stepping (over, into, out), and attach. Step Over uses an arrow passing over a call and executes the line without entering the called function. Step Into uses a downward arrow and enters the function; Step Out uses an upward arrow and finishes the current function before returning to its caller. The semantics follow [JetBrains stepping](https://www.jetbrains.com/help/idea/stepping-through-the-program.html). Icon hover hints include action names, shortcuts, and stepping descriptions. Unavailable actions are disabled. The toolbar remains before launch and after exit; output remains until the next launch. Groups wrap in narrow panes. A normal exit shows Ended; a step request racing with exit synchronizes the ended state.

Click the gutter or press F9 to toggle a breakpoint. Hollow markers are unverified, filled markers are adapter-confirmed, and an arrow plus line background marks execution. F5 starts/continues, F8 steps over, F7 steps into, Shift+F8 steps out, Alt+F5 pauses, and Shift+F5 ends debugging. The source context menu provides these actions and attach; multiple matching configurations appear in a chooser.

The debugger defaults to the right. Use the Dock selector in its heading to move it to the bottom; browser storage retains this client preference across reopening. The bottom layout places stack, variables, and output side by side, wrapping in narrow panes. Dock changes preserve the source caret and viewport, selected frame, and variable expansion without executing debugger commands.

The paused view shows stack frames, variables, and output under separate section headings. Frames appear as single-line selectable rows. Click or use Up/Down to preview a frame's source and variables; Home/End select the first/last frame. Enter/F4 or double-click moves focus to source. The execution arrow stays on the actual top frame; selection changes the reading position without moving execution. The selected filename and line appear below the list; expand Full path to read and copy the path. Variable names, types, and values have separate columns, with strings, numbers, and constants using host code colors. The first variable scope opens automatically; children load on expansion.

F5/F7/F8/Shift+F8/Alt+F5/Shift+F5 also work while the stack or variables have focus. Right-click a frame or press Shift+F10 for source navigation, resume, step, pause, and end actions. Output/status updates preserve frame selection and variable expansion; the next pause selects the execution frame again. Late variable responses after selection changes or resuming cannot overwrite the current selection. External frames can show variables without reading external source.

### Remove breakpoints and evaluate expressions

The toolbar trash icon and source context menu offer Remove all breakpoints. Before launch, this clears every file’s panel breakpoints. During an active session, it also sends clearing requests to every connected adapter and removes markers after confirmation. A failure reports unverified adapter state and retains local markers for reapplication.

While paused, select a stack frame and use the toolbar calculator, the Evaluate expression context action, or Alt+F8. Selected source text prefills the input; Enter or Evaluate expression submits, Shift+Enter adds a line, and Esc closes. Results show types and values, with expandable object children. Changing frames or entering another pause clears old results; continuing or ending the session closes evaluation.

Evaluation uses adapter [DAP evaluate](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Evaluate) in the current paused frame. Available Python, Go, and JS/TS expressions depend on their adapters; TS uses runtime values. Typing and selecting never evaluate automatically; explicit submission may call functions, modify variables, or cause other side effects. Failure, timeout, or a changed pause cannot guarantee that the expression did not execute; the UI reports this and never retries automatically. Closing the dialog does not undo a submitted evaluation. Expressions are limited to 8192 characters; object children load at most 100 entries per request.

Each workspace admits one active session. Conditional breakpoints, test pickers, browser debugging, and automatic subprocess attachment are unsupported. Breakpoints remain in panel memory and reset after closing/reopening it.

Launch owns its created program: ending or unloading requests termination and awaits managed-process exit. Attach sends `terminateDebuggee: false` and preserves the existing program. Closing the pane or changing chats does not end debugging; returning to the workspace discovers its active session. End sessions explicitly before unloading. Adapter and OS behavior still governs disconnection/termination; failures appear in the debug view.

## Verification

`npm test` covers input validation, ownership, concurrent starts, gutter/keyboard interactions, navigation, and themes. After configuring real adapters, `npm run test:debug` exercises dedicated programs in temporary workspaces, leaving the current project unexecuted. Set `DSH_DEBUG_GO=/absolute/path/to/go` when Go is outside PATH. These environment-dependent cases live in `test/debug.e2e.mjs`, outside the default suite.
