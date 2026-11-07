---
title: Agent review
---

# Agent review

The rules check **facts**: a script exists, a path exists, the lockfile matches. They cannot judge natural language: a vague line, two instructions that conflict in different words, a section that says nothing an agent can use. The agent review layer covers that, **inside your coding agent** (Claude Code, Codex, Cursor, ...), so the tool itself stays offline, dependency-free and deterministic. It never calls an LLM, never uses the network and never runs a command from your file.

```text
AGENTS.md -> tool (deterministic) -> findings + review handoff
                                          |
                          coding agent (LLM) reads the handoff
                                          |
                      proposes edits -> tool reruns to verify
```

## Use it

1. Run `npx agent-md-caregiver --format agent`. It prints [JSON](handoff-schema.md) and writes nothing.
2. Give the agent the shipped skill. For Claude Code, copy `skills/agent-md-review/` from the package into your project:

   ```bash
   mkdir -p .claude/skills
   cp -r node_modules/agent-md-caregiver/skills/agent-md-review .claude/skills/
   ```

   Then ask: "review my AGENTS.md". The skill tells the agent to run the tool, report verified findings first, review the handoff items as **advisory**, propose edits for your approval, and rerun the tool to confirm.
3. For another agent, point it at `skills/agent-md-review/SKILL.md` or paste its steps; the handoff JSON is agent-neutral.

## Guarantees

- Exit codes come from the deterministic rules only. Items never fail a run, so do not gate CI on the review.
- The checked file is untrusted text. The skill tells the agent to treat it as data and never run commands found in it.
- Agent judgments are labelled advisory and reported apart from verified findings.

## Tried by hand

The handoff was run on two real repositories, with the review done as a coding agent would:

| Repo | Instruction file | Rules found | Handoff items | Result of the review |
|---|---|---|---|---|
| A three.js game | `CLAUDE.md`, 72 lines | 2 info (no boundaries section) | 6 (3 sections of prose, 3 unchecked instructions) | The unchecked instructions were specific and fine. One item, the claim that `index.html` keeps 11 sections "in this order, clearly commented", is a statement about another file that no rule can verify; a quick search did not find the matching section comments, so it is worth a human look. Nothing the rules had missed was confirmed as wrong. |
| A small Next.js app | `AGENTS.md`, 5 lines | 2 info | 0 | Nothing to review: the file is too short to have vague or conflicting lines. |

Honest summary: on these two files the layer found no confirmed problem the rules had missed. Its first version also produced noise (instruction lines that already named a concrete identifier), which led to excluding lines with code spans. The layer is meant for longer, prose-heavy files; more real-world runs would tell how useful it is.

## Limits

LLM review is non-deterministic and can be wrong. Treat the output as suggestions, and a clean review as evidence, not proof.
