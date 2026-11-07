---
title: Security audit report
---

# Security audit report (pre-release, v0.1.0)

Summary of the supervised security audit run before the first npm publish (issue #18). The raw agent transcripts, ledgers and logs are not committed; this page keeps what a reader needs: what was run, what was found, what was fixed, and what the audit did not cover.

## What was run

| | |
|---|---|
| Date | 2026-11-07 |
| Method | [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill), commit `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` (MIT). Its source was read before use: Markdown guidance plus two validators that only use `fs`, `path` and `util`. |
| Agents | Claude Code coordinated the run (parent: Claude Sonnet 5.5). Reconnaissance, hunters, critics and verifiers were Claude Code subagents on its default subagent model. |
| Runs | 2, both with the `quick` profile (one hunter wave, one coverage critic, one fresh verifier per candidate, with candidate validation and final record verification merged). Run 1 on `a74c9af` (budget 20 agents, 15 used), run 2 on `5002dbd` after the first fixes (budget 14, 9 used). |
| Execution | Hunters were source-only. Verifiers could run bounded checks only through a `bubblewrap` wrapper that was self-tested first: no network (loopback only), empty environment, read-only target and toolchain, writes only to a per-agent scratch directory, and CPU, memory, file-size, fd, process and wall-clock limits. Evidence files were copied out by a no-follow, size-bounded promotion helper. Nothing ran in the working tree, nothing wrote into the repo, and no network call was made by the audit. |
| Validation | Both validators of the skill (`validate-findings.cjs`, `validate-coverage-ledger.cjs`) pass on both runs. |
| Supervision | The maintainer requested the run and chose the `quick x2` profile. The session ran under Claude Code's permission settings, and the maintainer reviewed the results as they came in. |

## Result

8 confirmed findings, all **low** severity, none exploitable beyond availability of a local lint run or spoofing of its output. All 8 are fixed, each with regression tests. There are no open `needs_validation` leads.

| # | Finding | Severity | Found in | Fix |
|---|---|---|---|---|
| 1 | Terminal escape sequences from a checked file reached the terminal through the pretty and github reports | low | run 1 | PR #25 |
| 2 | A symlinked `codex.md`, `CLAUDE.md`, `AGENTS.md` or config leaving the repo root was read and its first line echoed (or quoted in a parse error) | low | run 1 | PR #26 |
| 3 | `*a*a*...*b` globs (workspaces, `.gitignore`) compiled to regexes that backtrack polynomially (12 stars, 30 chars: 3.6 s) | low | run 1 | PR #27 |
| 4 | Quadratic trailing-whitespace trim in `parseGitignore` (80000 spaces: 7.6 s) | low | run 1 | PR #27 |
| 5 | The same terminal-escape root cause on a sink the first fix missed: config keys and rule ids in error messages on stderr | low | run 2 (revalidation of #1) | PR #29 |
| 6 | Quadratic Makefile target regex (80000 spaces: 7.4 s) | low | run 2 | PR #30 |
| 7 | Quadratic TOML multi-line string rescan (200000 lines: 6.1 s) | low | run 2 | PR #30 |
| 8 | Quadratic whitespace regexes and an unbounded edit-distance table on long lines and names in checked Markdown (80000 spaces: 7.5 s; 12000-char name: 4.3 s) | low | run 2 | PR #30 |

Findings 3 and 4 were fixed with a different approach than the verifiers' sketches: collapsing repeated stars would not help when literals sit between them, so globs are matched by a small non-backtracking matcher, checked against the old regex translation on 5000 random patterns, each tried on 8 random strings, anchored and floating. PR #30 also added global limits: lines over 2000 characters are cut before parsing, files over 2 MiB are not read (an oversized instruction file is skipped), and line continuations are joined at most 100 lines.

Run 2 also revalidated the run-1 fixes: findings 2, 3 and 4 held; finding 1 was incomplete (finding 5).

After the last fix, all eight reproducers were re-run in the sandbox against `main` at `2b2b206`: every one passes (hostile inputs that took 4 to 8 seconds now take under 20 ms; config, symlink and escape cases are refused or escaped). That re-run used the audit's own reproduction cases and was done by the coordinating agent, not by an independent verifier.

A hunter's suspicion that the code-span regex in `src/parse/paths.js` backtracks badly was tested by a verifier and did **not** reproduce (about 50 ms at 20,000 backtick runs).

Positive source patterns noted by the hunters: `spawnSync` with a fixed argv and no shell (and `--` / `--literal-pathspecs` before the one variable argument), the exclusive-create (`wx`) write for `--init --write`, no dependencies and no lifecycle scripts, a `contents: read` workflow with no secrets and no `pull_request_target`, an explicit `files` allowlist, and a static test that keeps network and process modules out of `src/review` and `src/report`.

## Hardening: done and open

Done: `git --literal-pathspecs check-ignore`; `persist-credentials: false` on both CI checkouts; the review-handoff guidance and skill now name every file-derived field as untrusted.

Open, deliberately not done (none is a finding):

- Pin GitHub Actions by commit SHA instead of tag (the workflow has a read-only token and no secrets).
- Scrub the git environment and pass `-c core.fsmonitor=false` when the checked directory is untrusted and carries its own `.git/config` (for example an extracted tarball that includes `.git`). It changes behavior for users with a custom `GIT_DIR`, so it needs a decision.
- `isDirOnDisk` follows symlinks out of the root (a one-bit answer that is never echoed).
- `ref.script in scripts` treats `constructor` and `toString` as existing scripts (a false negative only).
- SARIF `artifactLocation.uri` is not percent-encoded; `visible()` does not escape LRM/RLM or zero-width characters.
- Regexes on `pnpm-workspace.yaml` lines and the trailing-slash strip in workspace patterns are micro-quadratic on one very long line (now bounded by the 2 MiB file cap).
- When publishing to npm is automated, use a separate workflow limited to protected refs, with provenance and no `pull_request` trigger. Npm 2FA, branch protection and repository token defaults are not visible from the source and were not audited.

## What this audit did not cover

- Both runs used the `quick` profile, so this is a partial pass. The run-2 coverage critic accepted six more units that were deferred, not reviewed: the git subprocess against a hostile `.git/config` (changed since run 1), spawn and wall-time amplification from claim-driven `git check-ignore` calls and rename history, quadratic passes in the review handoff and some rules over many prose lines, the handoff as a prompt-injection sink after the guidance change, the release and CI surface after the changes, and any remaining stderr/stdout sinks outside the report formatters.
- Run 2 reused run 1's reconnaissance instead of repeating the four reconnaissance agents, because the source had changed only by the known fix diff. The critic of run 2 asked to reopen the symlink-read unit without giving a source-backed reason; it was left covered, since its checks were concrete.
- Hunters could not execute code, so anything that needed execution depended on a verifier.
- There was no independent audit of the run-2 fixes (they were checked with the reproducers and tests, see above). A third run on the final code would cover the deferred units and that gap.
- LLM audits are non-deterministic. A clean or low-severity result is evidence, not proof of security.

## Before publishing

No finding blocks the release. Reasonable to do first: decide on the open git-environment hardening, and enable npm 2FA and provenance for the publisher.

[Documentation home](../index.md)
