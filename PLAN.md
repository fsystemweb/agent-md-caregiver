# agent-md-caregiver: Master Plan

> Status: **draft for review**. Nothing beyond this plan and the scaffold is merged until you approve each PR.

## 1. What and why

Agent instruction files (`AGENTS.md`, `CLAUDE.md`, `codex.md`) rot. Scripts get renamed, folders move, a package manager changes, and the file keeps telling agents to run commands that no longer exist. Agents **do follow** these files, so a stale line costs real tokens and produces wrong work in every session. No linter checks them against reality.

`agent-md-caregiver` parses an instruction file, extracts every verifiable claim, and checks each claim against the actual repo (file tree, `package.json` scripts, lockfiles, git history).

**One-liner:** *A linter that checks your agent instructions against your repo.*

### Non-goals (v1)
- Not an LLM-based tool. Deterministic, offline, fast, free. Same input gives same output.
- Not a generator. Auto-generated instruction files are reported to hurt agent performance, so we do not write the file for you.
- Not a prose style checker. We verify **claims**, not wording.

## 2. Best practices we encode (research summary)

Sources: the AGENTS.md open spec (Linux Foundation / Agentic AI Foundation), a lessons-from-2,500-repos analysis, Phil Schmid's "Writing a Good AGENTS.md", and ETH Zurich findings on context files.

| Finding | What it means for the tool |
|---|---|
| Agents *follow* instructions, so wrong ones are costly | Core value: catch wrong commands and paths |
| Vagueness is the #1 failure ("run the tests") | Rule: flag commands-without-commands, suggest exact runnable ones |
| Overviews and file maps don't speed up navigation | Rule: warn on large directory-tree dumps; they also go stale |
| Auto-generated files reduce success ~3% and raise cost 20%+ | Docs recommend hand-written; no generator |
| Frontier models follow ~150-200 instructions total | Rule: size and instruction-budget warning (default >150 lines) |
| Unnecessary requirements raise reasoning tokens 14-22% | Rule: duplicates and redundant restatements |
| Claude Code reads only `CLAUDE.md`; most others read `AGENTS.md` | **Standard: `AGENTS.md` is canonical.** `CLAUDE.md` should be a thin `@AGENTS.md` import or symlink |
| Subdirectory files override root (nested/monorepo) | Rule: check nested files, report conflicts with parent |
| Boundaries (always / ask first / never) are the most common good pattern | Info rule: suggest when missing |
| "Never commit secrets" appears in nearly all good files | Info rule: suggest when missing |

### Our standard (the default we recommend and lint toward)
1. `AGENTS.md` is the single source of truth, at repo root.
2. `CLAUDE.md` = `@AGENTS.md` plus Claude-only additions. `codex.md` is legacy: migrate to `AGENTS.md`.
3. Under ~150 lines. Progressive disclosure: link deeper docs, don't inline them.
4. Exact runnable commands early (build, test, lint, typecheck).
5. Boundaries: Always / Ask first / Never.
6. Prefer capability descriptions over brittle exact paths; where paths are used, they must exist.

## 3. Core design

```
file.md --> [parse] --> claims[] --> [verify against RepoContext] --> findings[] --> [report]
```

### 3.1 Parser (`src/parse`)
Dependency-free Markdown scan that keeps line and column. Extracts:
- **Command claims**: fenced code blocks (`sh`, `bash`, none) and inline code that look like commands (`npm run x`, `pnpm test`, `yarn build`, `bun run x`, `make x`, `npx x`, `node x`, `python x`, `pytest ...`).
- **Path claims**: inline code and links that look like paths (contain `/` or a known extension, not URLs), including `@path` imports.
- **Directive claims**: lines with `always / never / must / do not / prefer / use` plus a subject (package manager, indentation, test runner, language/version).
- **Structure facts**: line count, headings, presence of sections, tree-dump blocks.

Each claim: `{ kind, text, file, line, col, raw }`. Ignore content in clearly illustrative contexts (blockquote examples, blocks fenced with `text`/`diff`, or lines marked `<!-- amc-ignore -->`).

### 3.2 Repo context (`src/repo`)
Lazy, cached, read-only: file tree (respects `.gitignore`), `package.json` scripts and `workspaces`, lockfile detection (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`), `Makefile` targets, `engines`, `packageManager` field, and git rename history (`git log --diff-filter=R -M --name-status`), all optional if not a git repo.

### 3.3 Rules (`src/rules`), one file per rule, one test file per rule

| ID | Name | Catches | Severity |
|---|---|---|---|
| AMC001 | `command-not-found` | `npm run foo` where `foo` isn't in scripts; `make foo` with no target; unknown workspace | error |
| AMC002 | `path-missing` | Referenced file/dir doesn't exist; **suggests the renamed path** from git history or closest basename match | error |
| AMC003 | `contradiction` | Two instructions conflict (npm vs pnpm, tabs vs spaces, "never X" vs "run X", nested file vs root) | error |
| AMC004 | `package-manager-mismatch` | File says `npm` but lockfile/`packageManager` says pnpm | warn |
| AMC005 | `broken-import` | `@AGENTS.md` or relative link target missing; CLAUDE.md not importing AGENTS.md when both exist | error |
| AMC006 | `vague-instruction` | "run the tests" with no command; no commands section at all | warn |
| AMC007 | `too-long` | Over line budget (default 150) | warn |
| AMC008 | `tree-dump` | Big directory-tree listing (goes stale, doesn't help agents) | info |
| AMC009 | `missing-boundaries` | No always/ask/never section; no secrets rule | info |
| AMC010 | `legacy-filename` | `codex.md` or divergent `CLAUDE.md` + `AGENTS.md` | info |
| AMC011 | `duplicate-instruction` | Same instruction twice | info |

Each finding: `{ ruleId, severity, message, file, line, col, evidence, suggestion? }`.

### 3.4 Reporters (`src/report`)
- `pretty` (default, colored, human)
- `json` (stable schema, for agents and scripts)
- `github` (workflow annotations)
- `sarif` (code scanning)

### 3.5 CLI (`src/cli.js`)
```
agent-md-caregiver [paths...]          # default: auto-discover AGENTS.md, CLAUDE.md, codex.md (+ nested)
  --root <dir>        repo root (default: cwd)
  --format pretty|json|github|sarif
  --max-lines <n>     default 150
  --rule <id>=<off|info|warn|error>
  --strict            warnings fail too
  --init              print the recommended AGENTS.md skeleton (never writes without --write)
  --explain <ruleId>  show rule docs
Exit: 0 clean, 1 findings at/above threshold, 2 usage or internal error
```
Config: optional `.agentmdcaregiver.json`. Inline ignore: `<!-- amc-ignore -->` and `<!-- amc-ignore-next-line -->`.

### 3.6 Agent-friendliness (a hard requirement)
- Zero-install: `npx agent-md-caregiver`.
- `--format json` has a documented, versioned schema (`schemaVersion: 1`).
- Every finding carries file, line, evidence and a concrete suggestion, so an agent can fix it without guessing.
- This repo ships its own `AGENTS.md` (we lint ourselves in CI: dogfooding).

## 4. Tech decisions

| Decision | Choice | Why |
|---|---|---|
| Language | Node.js >= 20, ESM, JSDoc types (no build step) | Target users already have Node; `npx` works instantly; zero build keeps PRs small |
| Dependencies | **None at runtime** | Fast, auditable, no supply chain |
| Tests | `node:test` + fixture repos in `test/fixtures/` | No framework to maintain |
| Lint / format | none initially beyond `node --check`; revisit | Keep v1 light |
| Type safety | `tsc --noEmit --checkJs` (dev dependency only) | Types without a build |
| CI | GitHub Actions: test on Node 20/22, self-lint | |
| License | MIT | |

## 5. PR roadmap (each PR small, reviewable, independently mergeable)

| PR | Branch | Contents | Done when |
|---|---|---|---|
| 0 | `chore/scaffold` | README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, issue/PR templates, logo, AGENTS.md, PLAN.md, package.json | You approve the shape and tone |
| 1 | `feat/parser` | Markdown claim extractor + tests | Fixtures parse to expected claims with exact line/col |
| 2 | `feat/repo-context` | File tree, scripts, lockfiles, Makefile, git renames | Context tests pass on fixtures |
| 3 | `feat/cli-and-reporters` | CLI, discovery, pretty/json reporters, exit codes (no rules yet except a stub) | `--help` and JSON schema tested |
| 4 | `feat/rules-core` | AMC001, AMC002, AMC005 (the headline value) | Demo catches dead command, renamed path, broken import |
| 5 | `feat/rules-contradiction` | AMC003, AMC004 | Contradiction fixtures pass, low false-positive rate |
| 6 | `feat/rules-hygiene` | AMC006 to AMC011 | Info/warn rules with `--rule` overrides |
| 7 | `feat/ci-and-formats` | GitHub Actions, `github` and `sarif` reporters, self-lint in CI | CI green, dogfooding on |
| 8 | `docs/demo-and-release` | Demo GIF/asciinema, README polish, npm publish dry-run, v0.1.0 | You approve the release |

I will open PR 0 first and wait. Each later PR is a separate branch off `main` so you can review in isolation.

## 6. Quality bar and risks

- **False positives are the main product risk.** A linter that cries wolf gets deleted. Mitigations: conservative extraction (only claim what is clearly a command or path), `amc-ignore`, per-rule severity, fixtures for tricky cases (globs, placeholders like `<name>`, `$VAR`, example blocks).
- **Placeholders and globs**: `src/**/*.ts`, `path/to/file`, `<your-file>` are skipped or matched as globs, never reported missing.
- **Commands we cannot verify** (e.g. `docker compose up`) are skipped, not guessed.
- **Contradictions are heuristic**: ship a small, explicit subject list first (package manager, indentation, test runner) and expand with evidence.
- **Security**: read-only. We never execute commands found in the file.

## 7. Open questions for you

1. **Name on npm**: is `agent-md-caregiver` free to publish under your account/org?
2. **Language**: OK with Node/JS (zero-dep) rather than TypeScript-with-build or Python?
3. **GitHub owner** for the repo URLs in README/package.json (placeholder `OWNER` for now).
4. **Logo**: I'll draw a simple SVG nurse with a clipboard-style `.md` file. Want it playful or minimal?

Defaults if you don't answer: Node/JS, placeholder `OWNER`, playful-minimal logo.
