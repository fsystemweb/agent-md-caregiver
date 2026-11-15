---
title: Configuration
---

# Configuration

## `.agentmdcaregiver.json`

An optional file in the repo root:

```json
{ "maxLines": 200, "strict": false, "rules": { "AMC008": "off", "AMC006": "error" }, "ignore": ["tools/skills/**"] }
```

| Key | Type | Meaning |
|---|---|---|
| `maxLines` | positive integer | Line budget for instruction files (default 150). |
| `strict` | boolean | Warnings fail the run too. |
| `rules` | object | Rule id to `off`, `info`, `warn` or `error`. |
| `ignore` | string[] | Globs of instruction files not to check. See [Skipped files](#skipped-files). |

An invalid file is an error (exit code `2`), never silently ignored. Unknown keys are rejected.

## Skipped files

The tool reviews the instruction files written for **this** repo. Files vendored from third parties are not yours to fix, and a fix would be overwritten on the next update, so they are skipped.

### Built-in exclusions

An instruction file inside one of these directories, at any depth, is never checked:

| Directory | Usually holds |
|---|---|
| `.agent/skills/`, `.claude/skills/` | Installed agent skills |
| `.cursor/`, `.codex/` | Editor and tool configuration |
| `vendor/`, `third_party/`, `third-party/` | Vendored code |
| `node_modules/` | Dependencies |

Only exact directory names count: `vendors/` or `.agent/AGENTS.md` are still checked. There is no switch to turn these off.

### `ignore`

For anything the defaults miss, list globs in `ignore`:

```json
{ "ignore": ["tools/skills/**", "examples/", "**/generated/CLAUDE.md"] }
```

- Patterns are relative to the repo root and use `/`. `*` and `?` stay within one path segment, `**` crosses directories, `[...]` classes are supported.
- A pattern that names a directory skips everything under it (`examples` and `examples/` are the same).
- Use `**/` to match at any depth (`**/fixtures`).
- Each entry must match at least one instruction file. A stale entry, for example after the vendored folder was deleted, is an error (exit `2`) until you remove it.
- Entries that are not strings, are empty, start with `/` or `!`, contain `..` or are not valid globs are errors.

### Paths on the command line

Exclusions also apply to paths you pass: `agent-md-caregiver vendor/x/AGENTS.md` checks nothing and reports the file as skipped.

### Output

Skipped files are never parsed, so they produce no findings and no review items. They are listed so nothing disappears silently:

- `--format json` and `--format agent`: a top-level `skipped` array of `{ "file", "reason" }`.
- `--format pretty`: a `Skipped N vendored or ignored files` line.

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
