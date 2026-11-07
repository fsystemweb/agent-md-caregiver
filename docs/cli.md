---
title: CLI reference
---

# CLI reference

```text
agent-md-caregiver [paths...] [options]
```

With no paths, the tool finds `AGENTS.md`, `CLAUDE.md` and `codex.md` in the repo, including nested ones. A directory path checks the instruction files inside it. `agent-md-caregiver --help` prints the same information; a test keeps this page in sync with it.

## Options

| Flag | Meaning |
|---|---|
| `--root <dir>` | Repo root (default: current directory). |
| `--format <name>` | `pretty` (default), `json`, `github`, `sarif` or `agent`. See below. |
| `--max-lines <n>` | Line budget for instruction files (default: 150). |
| `--rule <id>=<level>` | Override a rule: `off`, `info`, `warn` or `error`. Repeatable. |
| `--strict` | Warnings fail the run too. |
| `--init` | Print the recommended `AGENTS.md` skeleton (writes nothing). |
| `--write` | With `--init`: create `AGENTS.md` at the root if it does not exist. The only write path. |
| `--explain <id>` | Show what a rule checks and how to fix it. |
| `--docs` | Print the documentation URL (offline, writes nothing). |
| `--no-color` | Disable colors (`NO_COLOR` is also respected). |
| `-v`, `--version` | Print the version. |
| `-h`, `--help` | Show help. |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Clean. Info findings never fail the run. |
| `1` | Findings at or above the threshold: errors; with `--strict`, warnings too. |
| `2` | Usage or internal error (bad flag, invalid config, unknown rule). |

## Output formats

| Format | Use it for |
|---|---|
| `pretty` | Reading in a terminal. Colors only on a TTY. |
| `json` | Scripts and agents. Versioned, deterministic. See the [JSON schema](json-schema.md). |
| `github` | GitHub Actions annotations on the pull request. |
| `sarif` | SARIF 2.1.0, for code scanning upload. |
| `agent` | The [review handoff](handoff-schema.md): findings plus what the rules could not decide, for your coding agent. Exit code still comes from the rules only. |

[Documentation home](index.md)
