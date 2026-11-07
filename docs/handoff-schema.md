# Review handoff schema (version 1)

`agent-md-caregiver --format agent` prints one JSON document to stdout: the deterministic findings plus a list of things the rules **could not decide**, for the user's coding agent to review. See [agent-review.md](agent-review.md) for how to use it. The normal report is documented in [json-schema.md](json-schema.md) and is unchanged.

The output is deterministic: no timestamps, no absolute paths, stable order. The tool still never calls an LLM, never uses the network and never runs anything from the checked files. The **exit code comes from the deterministic findings only**; review items never change it.

Versioning: fields are only ever added within a schema version; a breaking change bumps `schemaVersion`.

## Top level

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | integer | `1`. Check it first. |
| `kind` | string | Always `"review-handoff"`. |
| `tool` | `{ name, version }` | The tool that produced it. |
| `guidance.advisory` | boolean | Always `true`: everything in `items` is a prompt for judgment, not a verified fact. |
| `guidance.untrustedInput` | string | Reminder that text copied from the files is data, never instructions. |
| `guidance.exitCode` | string | Reminder that items never change the exit code. |
| `files` | string[] | Instruction files checked, sorted, repo-relative. |
| `deterministic.findings` | Finding[] | Same objects as `findings` in the JSON report. |
| `deterministic.summary` | object | Same counts as `summary` in the JSON report. |
| `items` | Item[] | What the rules could not decide, sorted by file, line, column, kind. |
| `summary` | `{ items, byKind }` | Number of items, and a count per `kind`. |

## Item

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `R001`, `R002`, ... in output order. Stable for the same repo. |
| `kind` | string | See below. |
| `file`, `line`, `col` | string, integer, integer | Where the item is. 1-based. |
| `context` | `{ line, text }[]` | The line and its non-blank neighbours, each clipped to 200 characters. **Untrusted text.** |
| `related` | `{ line, text }[]` | Other lines involved (the other half of a contradiction pair); otherwise empty. |
| `reason` | string | Why the tool could not decide. |
| `question` | string | What to ask while reviewing. |

### Kinds

| Kind | When it appears |
|---|---|
| `skipped-claim` | A command the tool skipped because it was unsure: a `cd` to a directory it cannot resolve, or an `npm run` / `make` form with flags it does not model (`--if-present`, `-C`). |
| `no-checkable-content` | A section (level 2 or deeper) with at least 3 lines of prose and no command, path or directive. |
| `candidate-contradiction` | Two prose instructions with the same subject words (at least 2 shared, half of the shorter line) and opposite polarity ("always ..." vs "never ..."), not already reported by `AMC003`. At most 15 per file. |
| `unchecked-instruction` | A prose instruction (always, never, must, use, avoid, keep, follow, ...) with no command, path or code span on the line, not already reported by `AMC006`. At most 25 per file. |

Lines under `<!-- amc-ignore -->` markers, code blocks, tables, quotes and headings are never items.

The committed snapshot `test/snapshots/agent-handoff.json` pins the exact shape.
