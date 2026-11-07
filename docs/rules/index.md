---
title: Rules
has_children: true
---

# Rules

Every rule has a page that mirrors `agent-md-caregiver --explain <id>`. A test fails when a rule has no page or when a page drifts from the `--explain` text.

| Rule | Name | Default severity | Catches |
|---|---|---|---|
| [AMC000](AMC000.md) | empty-file | info | The instruction file has no content. |
| [AMC001](AMC001.md) | command-not-found | error | A package script, Makefile target or workspace the file tells agents to run does not exist. |
| [AMC002](AMC002.md) | path-missing | error | A file or directory the file points agents to does not exist (suggests where it went). |
| [AMC003](AMC003.md) | contradiction | error | Two instructions conflict: package managers, tabs vs spaces, test runners, "never X" vs "run X". |
| [AMC004](AMC004.md) | package-manager-mismatch | warn | The file tells agents to use a package manager other than the one the repo uses. |
| [AMC005](AMC005.md) | broken-import | error | An `@` import or relative link points nowhere, or CLAUDE.md does not import AGENTS.md. |
| [AMC006](AMC006.md) | vague-instruction | warn | An instruction says "run the tests" without a command, or the file has no commands at all. |
| [AMC007](AMC007.md) | too-long | warn | The file is longer than the line budget (default 150). |
| [AMC008](AMC008.md) | tree-dump | info | A big directory-tree listing goes stale and tells agents little. |
| [AMC009](AMC009.md) | missing-boundaries | info | No always / ask first / never section, or no rule about secrets. |
| [AMC010](AMC010.md) | legacy-filename | info | codex.md is a legacy name, or CLAUDE.md and AGENTS.md are diverging copies. |
| [AMC011](AMC011.md) | duplicate-instruction | info | The same instruction appears twice in one file. |

[Documentation home](../index.md)
