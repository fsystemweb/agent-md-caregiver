---
title: Configuration
---

# Configuration

## `.agentmdcaregiver.json`

An optional file in the repo root:

```json
{ "maxLines": 200, "strict": false, "rules": { "AMC008": "off", "AMC006": "error" } }
```

| Key | Type | Meaning |
|---|---|---|
| `maxLines` | positive integer | Line budget for instruction files (default 150). |
| `strict` | boolean | Warnings fail the run too. |
| `rules` | object | Rule id to `off`, `info`, `warn` or `error`. |

An invalid file is an error (exit code `2`), never silently ignored. Unknown keys are rejected.

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
