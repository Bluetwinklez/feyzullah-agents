# Feyzullah Agents

A local multi-agent workspace for planning, executing and reviewing coding, research and creative tasks. Built from the orchestration approach in [Feyzullah Office](https://github.com/Bluetwinklez/feyzullah-office), with optional [Noesis](https://github.com/Bluetwinklez/noesis) knowledge integration.

## Status

Stages 1–7 are implemented on the default branch. Later completion work is tracked in open pull requests; an open PR is not part of the installed version. The CLI and Santral panel coordinate external Claude, Codex and Antigravity executables. Provider availability and usage limits depend on your own installations and accounts.

## Requirements and checks

Use Node.js 24 or newer. The core uses the built-in SQLite module and has no npm runtime dependencies.

```bash
npm test
node bin/fa.js --help
```

Read the CLI help before running tasks. Keep runtime data and provider credentials outside the checkout. Run external agents only in a workspace you intend them to modify.

## Execution and review

The manager creates tasks and dependencies, the scheduler runs eligible specialists, and machine checks or an AI reviewer examine their results. A review must provide an explicit final `KARAR: PASS` or `VERDICT: PASS`; ambiguous output and reviewer failures cannot approve work. After the bounded correction rounds, unresolved tasks fail instead of being reported as complete.

Approval cards govern supported external actions. They are an application control, not an operating-system sandbox: scripts and developer tools can execute arbitrary code with the current user's permissions.

## Project guides

- [Plans and implementation stages](docs/PLAN.md)
- [Packages and example workflows](docs/PAKETLER.md)
- [Sources](docs/KAYNAKLAR.md) and [decisions](docs/KARARLAR.md)
- [Agent instructions](AGENTS.md)
- [Previous Turkish overview](README.tr.md)

Existing specialist prompts and historical project records may be Turkish. This English overview does not rename CLI commands or translate stored user content.

[Security policy](SECURITY.md) · [Repository security audit](SECURITY_AUDIT.md)
