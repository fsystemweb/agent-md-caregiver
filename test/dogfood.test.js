import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { discover } from '../src/discover.js';
import { lint } from '../src/lint.js';
import { createRepoContext } from '../src/repo/index.js';

// The tool must pass its own checks: no false positives on this repo's instruction files.
test("this repo's own instruction files have no errors", () => {
  const repo = createRepoContext(fileURLToPath(new URL('..', import.meta.url)));
  const files = discover(repo);
  assert.ok(files.includes('AGENTS.md') && files.includes('CLAUDE.md'));
  const { findings } = lint(repo, files, { maxLines: 150, ruleLevels: {} });
  assert.deepEqual(findings.filter((f) => f.severity === 'error'), []);
});
