# Contributing

[中文](CONTRIBUTING.md) | English

Contributions through issues and PRs are welcome. Contributions follow the repository’s MIT license; contributors are responsible for understanding, reviewing, and verifying their changes.

## Report a problem

Search existing issues before using the bug form. Include Harness and workbench versions or commits, OS, language/tool versions, a minimal reproduction, and expected versus actual behavior. For debugging, identify launch or attach. Feature requests should explain the scenario, obstacle, and desired interaction; discuss substantial API, configuration, or debugger changes in an issue first.

Remove API keys, tokens, personal paths, and business data from reproductions, logs, screenshots, and GIFs. Follow [security reporting](SECURITY.en.md) for private vulnerability reports.

## Local verification

For development tests, use Node.js 24.15.0 or a newer 24.x release and Git, and work on a separate branch. Run `npm ci` initially, then:

```sh
npm run verify
npm run test:package
```

`verify` builds the client, runs default tests, and checks source syntax, translations, documents, and generated output. Package smoke checks install real runtime dependencies in temporary directories without changing the global environment.

For language service or debugger protocol changes, configure real tools and run the relevant integration tests described in [automation](AUTOMATION.en.md). Default tests use JSDOM and protocol fixtures and do not replace real Harness UI verification.

## PR content and code conventions

Keep each PR focused on one problem and describe its result, actual validation, and compatibility impact. Bug fixes need a regression test reproducing the original problem. UI changes need sanitized light/dark screenshots or GIFs with the Harness version and platform. AI assistance is welcome; disclose substantial assistance and human verification.

Edit `client.source.js` and its imported modules, then regenerate `client.js` with `npm run build`; do not edit generated output directly. Use host theme variables and en/zh dictionaries. Update the corresponding English and Chinese documentation for user-visible changes and preserve aligned paragraph positions.

Preserve compatibility for `@local/dsh-git-control`, panel identifiers, `/api/git.*` routes, and existing preference keys. Discuss necessary changes first and provide migration steps. Git inspection and source reading remain read-only; launch, attach, and evaluation require explicit user actions.

Owners must release subprocesses, language servers, sockets, polling, and listeners and await exit. Async results must not overwrite a newer file, frame, or pause. Tests use independent temporary directories and OS-assigned ports, with observable readiness conditions.

## Review and merge

Maintainers review external PRs. Changes enter main through PRs with passing CI and resolved conversations. With one maintainer, branch rules do not require a second approver; CODEOWNERS requests maintainer review. Squash merging is preferred, with a clear problem and validation description.
