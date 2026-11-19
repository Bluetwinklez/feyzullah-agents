<div align="center">

# Feyzullah Agents

[![Core tests](https://github.com/Bluetwinklez/feyzullah-agents/actions/workflows/test.yml/badge.svg)](https://github.com/Bluetwinklez/feyzullah-agents/actions/workflows/test.yml) [![Secret scanning](https://github.com/Bluetwinklez/feyzullah-agents/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/Bluetwinklez/feyzullah-agents/actions/workflows/secret-scan.yml)

**Plan • Execute • Verify — local multi-agent workflows**

A Node.js workspace for coordinating coding, research and creative tasks through externally installed AI coding tools. Inspired by [Feyzullah Office](https://github.com/Bluetwinklez/feyzullah-office), with optional knowledge integration from [Noesis](https://github.com/Bluetwinklez/noesis).

![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white) ![License MIT](https://img.shields.io/badge/License-MIT-blue)

[Quick start](#quick-start) · [CLI reference](#cli-at-a-glance) · [Architecture & roadmap](docs/PLAN.md) · [Security](SECURITY.md)

</div>

## Overview

The system keeps tasks, dependencies, events, approvals and review results in a local workspace. A scheduler assigns eligible work to configured specialists; the reviewer requires explicit pass evidence rather than accepting an ambiguous response. Approval prompts are part of the application workflow, **not an OS security sandbox**.

| Component | Purpose |
| :--- | :--- |
| **Task manager & scheduler** | Organize goals, dependencies, agents and eligible tasks |
| **Execution adapters** | Integrate installed Claude, Codex and Antigravity CLIs |
| **Review & approvals** | Record explicit verdicts and gate supported external operations |
| **Local data & transfer** | Maintain SQLite-backed state and supported import/export operations |
| **Santral** | Optional local HTTP control panel and API |
| **Knowledge** | Optional Noesis context lookup |

## Quick start

**Requirements:** Node.js 24 or newer and Git. The core has no npm runtime dependencies. AI-backed execution additionally requires separately installed, authenticated provider CLIs.

~~~bash
git clone https://github.com/Bluetwinklez/feyzullah-agents.git
cd feyzullah-agents
npm test
node bin/fa.js --help
node bin/fa.js bins
~~~

`bins` reports which supported external engines are discoverable. To initialize a workspace in the current directory and inspect it without launching tasks:

~~~bash
node bin/fa.js init
node bin/fa.js agents
node bin/fa.js status
~~~

These examples operate from the repository checkout. For another project, invoke `bin/fa.js` by its absolute path **from that project’s working directory**; task state then belongs to the selected workspace. Review a command and its permissions before enabling execution, worktrees or network access.

## CLI at a glance

| Command | What it does |
| :--- | :--- |
| `init` | Initialize the current workspace (`--kind generic` or `roblox`) |
| `add`, `run` | Queue tasks and execute eligible work |
| `goal`, `goals` | Plan a goal and inspect goal progress |
| `agents`, `bins`, `packages` | Inspect specialists, engines and packages |
| `approve`, `verify` | Resolve pending approvals and verify the event chain |
| `serve` | Start the optional Santral interface (defaults to loopback) |
| `status`, `export`, `import` | Inspect and transfer workspace state |

Run `node bin/fa.js --help` for the complete current syntax, including routines, worktrees and review commands. Do not copy experimental commands from a pull request until its changes are present in the branch you run.

## Safety and project status

- External coding agents can modify files and run commands with the permissions of their host process; application approval cards are not a sandbox.
- Keep provider credentials and local runtime data outside commits. Use the supported secret-handling mechanisms and inspect any workflow before running it.
- The default branch is the source of truth for available code. Proposed features in open pull requests are **not** included until merged.
- Automation and tests do not replace hands-on checks for live provider behavior, platform-specific integration or third-party costs.

## Documentation

- [Plan, architecture and implementation tracking](docs/PLAN.md)
- [Agent packages and workflows](docs/PAKETLER.md)
- [Sources](docs/KAYNAKLAR.md) and [technical decisions](docs/KARARLAR.md)
- [Instructions for coding agents](AGENTS.md)
- [Turkish overview](README.tr.md)
- [Security policy](SECURITY.md) · [Security audit](SECURITY_AUDIT.md) · [License](LICENSE)
