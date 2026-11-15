import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { run } from '../src/cli.js';
import { skipper, splitFiles } from '../src/ignore.js';
import { hasGit, makeRepo } from './helpers/make-repo.js';

const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));

/** Clean, checkable repo file. */
const OWN = '# Repo\n\n`npm test`\n\n## Boundaries\n- Never: commit secrets.\n';
/** A long, self-contradicting skill file: fires AMC007 and AMC003 wherever it is checked. */
const SKILL =
  '# Skill\n\n- Always use pnpm.\n- Never use pnpm.\n' +
  Array.from({ length: 300 }, (_, i) => `Use rule ${i} carefully and keep code clean.`).join('\n') +
  '\n';

const REPO = {
  'package.json': JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }),
  'AGENTS.md': OWN,
  'packages/a/AGENTS.md': OWN,
  '.claude/skills/pdf/CLAUDE.md': SKILL,
  '.agent/skills/react-best-practices/AGENTS.md': SKILL,
  'apps/web/.cursor/AGENTS.md': SKILL,
};
const SKILL_FILES = ['.agent/skills/react-best-practices/AGENTS.md', '.claude/skills/pdf/CLAUDE.md', 'apps/web/.cursor/AGENTS.md'];

function cli(argv, files = REPO, { git = false } = {}) {
  const r = makeRepo(files, { git });
  cleanups.push(r.cleanup);
  let stdout = '';
  let stderr = '';
  const code = run(argv, {
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
    cwd: r.root,
    env: {},
  });
  return { code, stdout, stderr, json: stdout.startsWith('{') ? JSON.parse(stdout) : null };
}

const checkedFiles = (json) => [...new Set(json.findings.map((f) => f.file))];

describe('agent skill files are skipped by default', () => {
  test('stays silent: skill files are not parsed and produce no findings or handoff items', () => {
    const r = cli(['--format', 'json', '--strict']);
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.files, ['AGENTS.md', 'packages/a/AGENTS.md']);
    assert.deepEqual(r.json.findings, []);
    assert.deepEqual(r.json.skipped.map((s) => s.file), SKILL_FILES);
    assert.match(r.json.skipped[0].reason, /agent skill or tool folder \(\.agent\/skills\/\)/);

    const agent = JSON.parse(cli(['--format', 'agent']).stdout);
    assert.deepEqual(agent.skipped, r.json.skipped);
    assert.deepEqual(agent.items.filter((i) => SKILL_FILES.includes(i.file)), []);
  });

  test('tracked by git: still skipped', { skip: !hasGit && 'git not installed' }, () => {
    const { json } = cli(['--format', 'json'], REPO, { git: true });
    assert.deepEqual(json.files, ['AGENTS.md', 'packages/a/AGENTS.md']);
  });

  test('fires: --include-skills checks them', () => {
    const { json } = cli(['--format', 'json', '--include-skills']);
    assert.deepEqual(json.skipped, []);
    assert.deepEqual(checkedFiles(json), SKILL_FILES);
    const ids = json.findings.map((f) => f.ruleId);
    assert.ok(ids.includes('AMC007') && ids.includes('AMC003'), ids.join(','));
  });

  test('fires: naming a skill file or folder checks it', () => {
    assert.deepEqual(cli(['.claude/skills/pdf/CLAUDE.md', '--format', 'json']).json.files, ['.claude/skills/pdf/CLAUDE.md']);
    assert.deepEqual(cli(['.agent/skills', '--format', 'json']).json.files, ['.agent/skills/react-best-practices/AGENTS.md']);
  });

  test('naming a parent folder does not pull skills in', () => {
    const { json } = cli(['.', '--format', 'json']);
    assert.deepEqual(json.files, ['AGENTS.md', 'packages/a/AGENTS.md']);
    assert.deepEqual(cli(['apps', '--format', 'json']).json.skipped.map((s) => s.file), ['apps/web/.cursor/AGENTS.md']);
  });

  test('look-alike folders are still checked', () => {
    const { json } = cli(['--format', 'json'], { 'AGENTS.md': OWN, '.claude/CLAUDE.md': OWN, 'skills/AGENTS.md': OWN, 'vendor/AGENTS.md': OWN });
    assert.deepEqual(json.files, ['.claude/CLAUDE.md', 'AGENTS.md', 'skills/AGENTS.md', 'vendor/AGENTS.md']);
    assert.deepEqual(json.skipped, []);
  });

  test('the pretty report says how many files were skipped and how to check them', () => {
    assert.match(cli([]).stdout, /Skipped 3 agent skill or ignored files \(--include-skills checks skills/);
    assert.match(cli([]).stdout, /2 files checked, no problems found/);
  });
});

describe('"ignore" in .agentmdcaregiver.json', () => {
  const withIgnore = (ignore) => ({ ...REPO, 'tools/gen/AGENTS.md': SKILL, '.agentmdcaregiver.json': JSON.stringify({ ignore }) });

  test('fires: without it the file is checked', () => {
    assert.deepEqual(checkedFiles(cli(['--format', 'json'], withIgnore([])).json), ['tools/gen/AGENTS.md']);
  });

  test('stays silent: a glob or a folder name skips the file', () => {
    for (const pattern of ['tools/**', 'tools', 'tools/gen/', '**/gen/AGENTS.md']) {
      const r = cli(['--format', 'json', '--strict'], withIgnore([pattern]));
      assert.equal(r.code, 0, pattern);
      assert.deepEqual(r.json.files, ['AGENTS.md', 'packages/a/AGENTS.md'], pattern);
      assert.deepEqual(r.json.skipped.at(-1), { file: 'tools/gen/AGENTS.md', reason: `ignore pattern "${pattern}" in .agentmdcaregiver.json` });
    }
  });

  test('a pattern that matches nothing is fine; naming an ignored path checks it', () => {
    assert.equal(cli([], withIgnore(['tools', 'gone/**'])).code, 0);
    assert.deepEqual(cli(['tools', '--format', 'json'], withIgnore(['tools'])).json.files, ['tools/gen/AGENTS.md']);
  });

  test('--include-skills does not undo "ignore"', () => {
    assert.ok(!cli(['--format', 'json', '--include-skills'], withIgnore(['tools'])).json.files.includes('tools/gen/AGENTS.md'));
  });

  test('broken entries are a usage error (exit 2)', () => {
    for (const [ignore, re] of [['"tools"', /"ignore" must be an array/], ['[3]', /must be a non-empty string/], ['[""]', /must be a non-empty string/], ['["[z-a]"]', /not a valid glob/]]) {
      const r = cli([], { 'AGENTS.md': OWN, '.agentmdcaregiver.json': `{"ignore": ${ignore}}` });
      assert.equal(r.code, 2, ignore);
      assert.match(r.stderr, re, ignore);
    }
  });
});

describe('ignore helpers', () => {
  test('skipper and splitFiles', () => {
    const skip = skipper(['x']);
    assert.match(skip('a/.codex/AGENTS.md'), /\.codex\//);
    assert.equal(skip('AGENTS.md'), null);
    assert.equal(skipper([], { includeSkills: true })('.codex/AGENTS.md'), null);
    const out = splitFiles(['.codex/AGENTS.md', 'AGENTS.md', 'x/AGENTS.md'], skip, ['x']);
    assert.deepEqual(out.files, ['AGENTS.md', 'x/AGENTS.md']);
    assert.deepEqual(out.skipped.map((s) => s.file), ['.codex/AGENTS.md']);
  });
});
