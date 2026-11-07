---
title: CI guide
---

# CI guide

Use `actions/checkout` with `fetch-depth: 0` so rename suggestions can read git history.

## Annotations on the pull request

```yaml
name: Lint agent instructions
on: [pull_request]
permissions:
  contents: read
jobs:
  agent-md:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx agent-md-caregiver --strict --format github
```

`--format github` turns each finding into a workflow annotation on the changed file. `--strict` makes warnings fail the job too. This repository runs this form on itself.

## Code scanning (SARIF)

```yaml
      - run: npx agent-md-caregiver --format sarif > amc.sarif || true
      - uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: amc.sarif }
```

The `|| true` lets the upload step run when there are findings; the SARIF report carries them.

## Do not gate CI on the agent review

`--format agent` is advice for a coding agent. Its exit code comes from the deterministic rules only, but the review items themselves are judgment calls, so do not block merges on them.

[Documentation home](index.md)
