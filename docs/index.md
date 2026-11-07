---
title: Home
nav_order: 1
---

# agent-md-caregiver

A linter for your agent instructions. It checks `AGENTS.md`, `CLAUDE.md` and `codex.md` against the actual repo: dead commands, renamed paths, contradicting instructions. Zero runtime dependencies, offline and deterministic. It does not call an LLM, use the network, or execute the commands in your file.

Agents *do follow* instruction files, so every stale line wastes tokens and sends the agent in the wrong direction, in every session. This tool finds those lines.

## How it works

```text
file -> claims -> rules -> findings
```

It reads the file, extracts every claim it can verify (commands, paths, imports, directives), and checks each one against your file tree, `package.json` scripts, `pyproject.toml`, lockfiles and git history. Each finding has an exact line and column, the offending text, and a concrete suggestion.

## 30-second example

```bash
npx agent-md-caregiver
```

```text
AGENTS.md
  7:10    error  `npm run test:unit`: no such script "test:unit" in package.json  AMC001
          > `npm run test:unit`
          fix: Did you mean `npm run test`?
  11:26   error  `src/routes/users.ts` does not exist  AMC002
          > `src/routes/users.ts`
          fix: Renamed to `src/routes/user.ts` in git history. Replace the path.

1 file checked: 2 error(s), 0 warning(s), 0 info.
```

The exit code is `1`, so it works in CI.

## Documentation

- [Getting started](getting-started.md): install, first run, reading the output
- [CLI reference](cli.md): every flag, exit codes and output formats
- [Rules](rules/index.md): one page per rule, `AMC000` to `AMC011`
- [Configuration](configuration.md): `.agentmdcaregiver.json`, precedence, ignore markers
- [CI guide](ci.md): GitHub Actions, SARIF upload, `--strict`
- [Compatibility](compatibility.md): languages and package managers
- [Agent review](agent-review.md): optional LLM judgment that runs inside your coding agent
- Schemas: [JSON report](json-schema.md), [review handoff](handoff-schema.md)
- [Contributing and changelog](contributing.md)

Source and issues: [github.com/fsystemweb/agent-md-caregiver](https://github.com/fsystemweb/agent-md-caregiver). MIT.
