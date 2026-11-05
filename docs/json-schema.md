# JSON report schema (version 1)

`agent-md-caregiver --format json` prints one JSON document to stdout. It is meant for agents and scripts, so it is stable and versioned: fields are only ever added within a schema version, and any breaking change bumps `schemaVersion`.

The output is deterministic. It contains no timestamps and no absolute paths, so the same repo gives byte-identical output.

## Example

```json
{
  "schemaVersion": 1,
  "tool": { "name": "agent-md-caregiver", "version": "0.1.0" },
  "files": ["AGENTS.md", "packages/a/AGENTS.md"],
  "findings": [
    {
      "ruleId": "AMC000",
      "severity": "info",
      "message": "Instruction file is empty",
      "file": "packages/a/AGENTS.md",
      "line": 1,
      "col": 1,
      "evidence": "",
      "suggestion": "Add build and test commands, conventions and boundaries, or delete the file."
    }
  ],
  "summary": { "files": 2, "errors": 0, "warnings": 0, "infos": 1 }
}
```

## Fields

### Top level

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | integer | Always `1` for this document. Check it before reading anything else. |
| `tool.name` | string | `agent-md-caregiver`. |
| `tool.version` | string | The version of the tool that produced the report. |
| `files` | string[] | Every instruction file that was checked, sorted, relative to the repo root, `/` separated. |
| `findings` | Finding[] | Sorted by `file`, `line`, `col`, then `ruleId`. Empty when the run is clean. |
| `summary` | object | Counts, see below. |

### Finding

Every finding has all of these fields, so a consumer never needs to guess.

| Field | Type | Meaning |
|---|---|---|
| `ruleId` | string | Stable rule id such as `AMC001`. Run `--explain <id>` for the rule's docs. |
| `severity` | `"error"` \| `"warn"` \| `"info"` | After `--rule` overrides. Rules set to `off` produce no findings. |
| `message` | string | What is wrong, in one sentence. |
| `file` | string | Instruction file the finding is in, relative to the repo root. |
| `line` | integer | 1-based line. |
| `col` | integer | 1-based column (UTF-16 code units). |
| `evidence` | string | The offending source text. May be an empty string. |
| `suggestion` | string \| null | A concrete fix an agent can apply without guessing, or `null` if there is none. |

### Summary

| Field | Type | Meaning |
|---|---|---|
| `files` | integer | Number of files checked (`files.length`). |
| `errors` | integer | Findings with severity `error`. |
| `warnings` | integer | Findings with severity `warn`. |
| `infos` | integer | Findings with severity `info`. |

## Exit codes

The report does not carry the exit code; read it from the process.

| Code | Meaning |
|---|---|
| `0` | Clean. `info` findings never fail a run. |
| `1` | At least one `error` finding, or with `--strict` at least one `warn` finding. |
| `2` | Usage or internal error. Nothing is written to stdout; the message is on stderr. |
