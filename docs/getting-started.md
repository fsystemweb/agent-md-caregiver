---
title: Getting started
---

# Getting started

## Install

You need Node 20 or newer. `git` is optional: with it the tool suggests renames from history.

```bash
npx agent-md-caregiver          # no install
npm install --save-dev agent-md-caregiver   # or add it to a project
```

## First run

From the repo root:

```bash
npx agent-md-caregiver
```

It finds `AGENTS.md`, `CLAUDE.md` and `codex.md`, including nested ones, and checks each against the repo. To check one file or a folder, pass it: `npx agent-md-caregiver AGENTS.md`.

No instruction file yet? `npx agent-md-caregiver --init` prints a recommended skeleton, and `--init --write` creates `AGENTS.md` if it does not exist.

## Reading the output

```text
AGENTS.md
  8:10    error  `npm run lint:fix`: no such script "lint:fix" in package.json  AMC001
          > `npm run lint:fix`
          fix: Did you mean `npm run lint:check`?

1 file checked: 1 error(s), 0 warning(s), 0 info.
```

- `8:10` is line and column of the offending text.
- `error`, `warn` or `info` is the severity. Errors fail the run (exit code `1`); with `--strict`, warnings do too; info never does.
- `AMC001` is the rule. Run `npx agent-md-caregiver --explain AMC001`, or see [the rules](rules/index.md).
- `>` is the exact text, and `fix:` is a concrete suggestion.

## When it is wrong

False positives are the main risk of a tool like this, so it stays silent when unsure. If it still reports something deliberate, put `<!-- amc-ignore-next-line -->` on the line before it, or turn the rule down in the [configuration](configuration.md).

[Documentation home](index.md)
