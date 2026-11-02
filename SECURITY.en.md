# Security reporting

[中文](SECURITY.md) | English

Security fixes target current main and the latest published release. Users of older versions should upgrade and verify. Unreleased main builds are development versions.

## Report vulnerabilities privately

Use [GitHub private vulnerability reporting](https://github.com/Chengyunlai/dsh-workbench/security/advisories/new). Keep unpatched exploitation details, credentials, and private files out of public issues, PRs, and logs.

Include affected versions, OS and Harness version, a minimal reproduction, impact, and possible mitigation. Use fictional files and sample values; submit necessary sensitive material only through the private report. Maintainers assess reproducibility and impact before coordinating fixes and disclosure.

## Debugging and automation

Debugging executes real programs, evaluation may mutate state, and detaching should preserve existing processes. Filesystem escapes, unintended execution, credential exposure, and process ownership errors are suitable security reports. Use the bug form for ordinary feature problems.

External PR CI uses ephemeral GitHub-hosted runners, read-only permissions, and commit-pinned Actions. Tests do not access maintainer machines, credentials, or existing processes. Only the separate publisher for trusted version tags receives write access to create a draft release.
