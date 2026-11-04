# Automation and releases

[中文](AUTOMATION.md) | English

Workflows live in `.github/workflows/`. External Actions use full commit SHAs. Dependabot proposes weekly npm and Actions updates for maintainer review through the same PR checks. React and React DOM update together to prevent mismatched versions.

## Every PR and main

`CI` runs `npm ci` and `npm run verify` on Ubuntu 24.04 and macOS 15 with Node.js 24. Linux also runs pinned actionlint for workflow semantics. A separate package job builds and runs `npm run test:package`, producing a ZIP, npm tarball, and SHA256SUMS retained as Actions artifacts for seven days.

Each default test has a five-minute deadline; subprocess fixtures escalate SIGTERM to SIGKILL after the grace period and await closed output streams. Default tests cover real Git, bundled JS/TS and Python navigation, simulated DAP, and client DOM. Repository checks validate translation keys and placeholders, local document links, aligned bilingual paragraphs, and uncommitted drift in rebuilt `client.js`. Package checks verify Host imports, client registration, required resources, and installed compiler navigation in isolated directories; the ZIP also includes the lockfile and is checked with `npm ci --omit=dev`.

Main requires the aggregate `CI` check, which succeeds only when every core and package job succeeds. Document-only changes do not skip this required check. Windows is not yet a verified platform, and passing JSDOM tests does not establish native desktop behavior.

## Real-tool integration tests

`Integration` runs for PRs changing relevant language-server/debugger files, manual dispatches, Mondays at 03:20 Asia/Shanghai, and release verification. It is independent of core PR CI, so ordinary document and UI changes do not download the full toolchain.

Tools are pinned to Go 1.24.5, gopls 0.20.0, Delve 1.25.2, Java 21.0.8+9, JDT LS 1.50.0, debugpy 1.8.22, and js-debug 1.140.0. JDT LS and js-debug downloads are SHA-256 verified. Tools and machine-local configuration live in ignored `.tools/ci` and `.tools/*.json`.

Locally, provide Python 3.12, Go, and a Java 21 `JAVA_HOME`. `DSH_CI_PYTHON` and `DSH_DEBUG_GO` may select explicit commands. The script installs tools under local `.tools` and updates the plugin’s machine-local server/adapter configuration:

```sh
npm run setup:ci-tools
npm run test:languages
npm run test:debug
```

Integration tests start temporary projects and dedicated processes to verify real definitions, launch/attach, breakpoints, stepping, variables, and evaluation. They require no model API key and do not run user projects.

## Versioned releases

Manual `Release` dispatch is a build rehearsal: it runs core and real integration tests and uploads install assets for thirty days without creating a release. Maintainers can use it to validate the first release.

For a release, update `package.json`, its lockfile version, and release notes through a PR, then merge to main. Create and push a `v<version>` tag matching that package version exactly; package version `1.0.0` corresponds to `v1.0.0`. Release checks reject mismatched tags and commits outside main history.

Tags trigger tests, clean installation checks, ZIP/tarball and checksum generation, followed by a separate job creating a draft release. Prereleases are marked accordingly. Publishing the reviewed release triggers `release.published`, revalidates the tag on main history and all release checks, then publishes the tested tarball to npm with OIDC. Stable versions use `latest`; prerelease versions use `beta`. Manual build rehearsals and drafts do not publish to npm. An existing bootstrap publication is skipped only when its npm SHA-512 integrity exactly matches the tested tarball; an existing version with different bytes fails and requires a new version.

ZIP users extract it, follow `INSTALL.txt` to run `npm ci --omit=dev`, and install the extracted directory through the Harness plugin manager. The npm tarball can be installed with npm and does not contain a lockfile. The public package is `@yunlai/dsh-workbench`, with Harness compatibility declared by `engines.dsh`.

## First npm publication and trusted publisher setup

For the first publication, log in to npm as `yunlai` in the maintainer terminal and publish the tested tarball using `npm publish ./dist/dsh-workbench-1.0.0.tgz --access public --registry=https://registry.npmjs.org` (replace the filename for later versions). The maintainer completes browser login or 2FA. Once the package exists, configure its npm Trusted Publisher for GitHub Actions with owner `Chengyunlai`, repository `dsh-workbench`, workflow `release.yml`, and permission to run `npm publish`. Later publications follow public GitHub Releases without storing a long-lived npm token. See the [official npm guide](https://docs.npmjs.com/trusted-publishers/).
