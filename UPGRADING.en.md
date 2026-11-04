# Upgrade the development workbench

## Change

The package changes from `@local/dsh-git-control` (interim name `@local/dsh-workbench`) to `@yunlai/dsh-workbench`, and its bundle entry changes from `git-control` to `workbench`. Older configuration must update package references. Sidebar and layout preferences retain their internal keys; do not clear user data.

## Migration

1. Update the local plugin checkout and its dependencies with `npm ci --omit=dev`. Its directory does not need renaming.

2. In the active Harness profile package.json, replace `@local/dsh-git-control` or `@local/dsh-workbench` with `@yunlai/dsh-workbench` in dependencies keys and `dsh.profile.bundles`. Keep the existing `link:` path, then install profile dependencies to refresh the lockfile and links.

3. For manually registered Cordis entries, change `name` to `@yunlai/dsh-workbench`. Retarget overrides of the old `git-control` entry to `workbench`, retaining their `config`. Do not insert a second entry when the bundle already registers it.

4. Reload Harness and verify that plugin details show `@yunlai/dsh-workbench` and exactly one Development workbench. Existing panel layout and preferences remain restorable.

## Switch to online installation

For installations from a local directory, `link:`, or a Git address, remove the old installation reference through the Harness plugin manager and install `@yunlai/dsh-workbench` from npm. This becomes available after the first npm publication. Do not enable local and npm copies together; keep layout preferences and local projects. Subsequent updates use version selection in plugin details, followed by reload or restart when prompted. Request previews explicitly with `@yunlai/dsh-workbench@beta`.
