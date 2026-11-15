---
title: Configuration
---

# Configuration

## `.agentmdcaregiver.json`

An optional file in the repo root:

```json
{ "maxLines": 200, "strict": false, "rules": { "AMC008": "off", "AMC006": "error" }, "ignore": ["tools/generated/**"] }
```

| Key | Type | Meaning |
|---|---|---|
| `maxLines` | positive integer | Line budget for instruction files (default 150). |
| `strict` | boolean | Warnings fail the run too. |
| `rules` | object | Rule id to `off`, `info`, `warn` or `error`. |
| `ignore` | string[] | Globs of instruction files not to check. See [Skipped files](#skipped-files). |

An invalid file is an error (exit code `2`), never silently ignored. Unknown keys are rejected.

## Skipped files

The tool checks the instruction files written for **this** repo. Skills installed by AI coding agents, and the agents' own folders, are not yours to fix, so they are skipped by default.

### Default: agent skills and tool folders

An instruction file inside one of these folders, at any depth, is skipped:

`.claude/skills/` · `.agent/skills/` · `.agents/skills/` · `.codex/` · `.cursor/` · `.gemini/`

Only these exact folders count: `.claude/CLAUDE.md` or `skills/AGENTS.md` are still checked.

### Checking skills anyway

- `--include-skills` checks every skill and tool folder in the run.
- Naming a path checks it: `agent-md-caregiver .claude/skills/pdf` or `agent-md-caregiver .claude/skills/pdf/CLAUDE.md`. Naming a parent such as `.` or `apps` does not pull skills in.

### `ignore`

To skip other files, list globs in `ignore`:

```json
{ "ignore": ["tools/generated/**", "examples"] }
```

- Patterns are relative to the repo root. `*` stays in one folder, `**` crosses folders, so use `**/fixtures` for any depth.
- A folder name skips everything under it (`examples` and `examples/` are the same).
- A pattern that matches nothing is fine. An entry that is not a non-empty string or not a valid glob is an error (exit `2`).
- Naming an ignored path on the command line checks it. `--include-skills` does not undo `ignore`.

### Output

Skipped files are never read, so they produce no findings and no review items. They are still listed:

- `--format pretty`: a `Skipped N agent skill or ignored files` line.
- `--format json` and `--format agent`: a top-level `skipped` array of `{ "file", "reason" }`.

## Precedence

Command line, then config file, then defaults. `--max-lines 100` beats `"maxLines": 200`; `--rule AMC007=off` beats `"rules"`.

## Ignore markers

Put an HTML comment in the Markdown to silence a deliberate case:

| Marker | Effect |
|---|---|
| `<!-- amc-ignore-next-line -->` | Ignores the next line, or the whole fenced block it opens. |
| `<!-- amc-ignore -->` on its own line | Ignores the block right below it (until a blank line, or through a fenced block that follows directly). |
| `<!-- amc-ignore -->` at the end of a line | Ignores that line. |

[Documentation home](index.md)
