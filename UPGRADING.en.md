# Upgrade the development workbench

## 1.4.4

Conversation links to Python, Go, Java, JavaScript, and TypeScript open in the workbench at the requested line. The file tree context menu can open a directory or reveal a file in the system file manager. Reload or restart Harness after updating.

## 1.4.3

The workbench tree can open Git-ignored files under the workspace root’s `.dsh` directory, including personal memory cards. Reload or restart Harness after updating the plugin.

## 1.4.2

While paused, click an inline variable name or value to inspect values and object fields in the selected stack frame. Click a type name to open the source type definition resolved by the language service. Breakpoint lines have a translucent red tint. For npm installations, update to `1.4.2` in Harness plugin details, then reload or restart.

## 1.4.1

This release updates the English and Chinese README with a quick start, memory card workflow, language support, and debugging requirements. The updated introduction is available on GitHub and npm.

## 1.4.0

Select `1.4.0` in Harness plugin details, then reload or restart. Python class relationships offer a hierarchy tree and a docked diagram, with language availability following the active file. Supported library sources returned by language services open in read-only tabs. File tabs have a close menu, and the Markdown preview displays YAML metadata separately.

Explain it to me assigns one card to each new conversation, starting with a question recap and keeping the full explanation and a recall question. New cards use source-based folders. The bottom tool groups cards by folder and can group older cards using their source field. Existing cards need no migration. See [Memory cards](USAGE.en.md#memory-cards).

## 1.3.0

Update `@yunlai/dsh-workbench` to `1.3.0` in Harness plugin details, then reload or restart. This release adds Python class relationships from existing syntax trees, compact UML nodes with method signatures, and source navigation. It does not execute or import project code or require additional project declarations. It also improves navigation centering, paused-frame inline values and pointer interaction with debug hovers. Existing project configuration and layouts need no migration; see [class relationships](USAGE.en.md#python-class-relationships) and [debug inspection](DEBUGGING.en.md#hover-variable-inspection).

## 1.2.0

For npm installations, select `1.2.0` in Harness plugin details and reload or restart when prompted. While paused, hover variables and dotted members to inspect values and types in the selected frame, with expandable objects. Stepping, resuming, or changing files or frames closes old popups. Hover inspection sends no expression evaluation requests, and slow variable reads do not block execution controls. Existing launch/attach configuration and layout need no migration; see [debug configuration](DEBUGGING.en.md#hover-variable-inspection).

## 1.1.0

For npm installations, select `1.1.0` in the Harness plugin details and reload or restart as prompted. This version adds workbench reading previews for conversation Markdown, shared bottom tool windows, and read-only tree menus, path copying, current-file location, and file/directory content search. Previously opened Git tabs display the development workbench title. Project-file and Git inspection remain read-only; terminals and debugging run with their respective execution permissions.

No manual project-file migration or layout-data cleanup is required. Changes, History, Debugger and Terminal share the bottom window, with a new Find entry. Previous debugger dock preferences are unused, and file-tree sizes are retained. Earlier package-name migration and switching from local installations are documented below.

## Change

The package changes from `@local/dsh-git-control` (interim name `@local/dsh-workbench`) to `@yunlai/dsh-workbench`, and its bundle entry changes from `git-control` to `workbench`. Older configuration must update package references. Sidebar and layout preferences retain their internal keys; do not clear user data.

## Migration

1. Update the local plugin checkout and its dependencies with `npm ci --omit=dev`. Its directory does not need renaming.

2. In the active Harness profile package.json, replace `@local/dsh-git-control` or `@local/dsh-workbench` with `@yunlai/dsh-workbench` in dependencies keys and `dsh.profile.bundles`. Keep the existing `link:` path, then install profile dependencies to refresh the lockfile and links.

3. For manually registered Cordis entries, change `name` to `@yunlai/dsh-workbench`. Retarget overrides of the old `git-control` entry to `workbench`, retaining their `config`. Do not insert a second entry when the bundle already registers it.

4. Reload Harness and verify that plugin details show `@yunlai/dsh-workbench` and exactly one Development workbench. Existing panel layout and preferences remain restorable.

## Switch to online installation

For installations from a local directory, `link:`, or a Git address, remove the old installation reference through the Harness plugin manager and install `@yunlai/dsh-workbench` from npm. Do not enable local and npm copies together; keep layout preferences and local projects. Subsequent updates use version selection in plugin details, followed by reload or restart when prompted. Request previews explicitly with `@yunlai/dsh-workbench@beta`.

## Bottom tool window

Find, Changes, History, Debugger, and Terminal now switch through bottom icons in one resizable tool window. The top Changes/History tabs and separate debugger Dock selector are removed. Previous debugger sizes and docking preferences are no longer used and require no manual cleanup. File-tree sizes remain; the shared tool height is saved separately. Hiding or switching tools retains the terminal process; closing its owning workbench or unloading the plugin requests termination.
