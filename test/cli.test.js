import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.js';
import { makeRepo } from './helpers/make-repo.js';

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/agent-md-caregiver.js', import.meta.url));
const SNAPSHOT = new URL('./snapshots/json-report.json', import.meta.url);

const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));

/** A repo with a clean file, empty files (the AMC000 stub fires on them), and files that must not be found. */
const FILES = {
  'AGENTS.md': '# Project\n\nRun `npm test`.\n',
  'CLAUDE.md': '@AGENTS.md\n',
  'packages/a/AGENTS.md': '',
  'packages/b/codex.md': '\n',
  'packages/a/README.md': '# not an instruction file\n',
  '.gitignore': 'ignored/\n',
  'ignored/AGENTS.md': '',
  'node_modules/dep/AGENTS.md': '',
};

/**
 * Run the CLI in a throwaway repo and capture everything.
 * @param {string[]} argv
 * @param {{ files?: Record<string, string>, cwd?: string, io?: object }} [opts]
 */
function cli(argv, { files = FILES, cwd = '', io = {} } = {}) {
  const r = makeRepo(files);
  cleanups.push(r.cleanup);
  let stdout = '';
  let stderr = '';
  const code = run(argv, {
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
    cwd: join(r.root, cwd),
    env: {},
    ...io,
  });
  return { code, stdout, stderr, root: r.root };
}

describe('help and version', () => {
  test('--help prints usage, flags, exit codes and rules; exit 0', () => {
    const { code, stdout, stderr } = cli(['--help']);
    assert.equal(code, 0);
    assert.equal(stderr, '');
    for (const needle of ['Usage:', '--root', '--format', '--max-lines', '--rule', '--strict', '--init', '--explain', 'Exit codes:', 'AMC000']) {
      assert.ok(stdout.includes(needle), needle);
    }
  });

  test('`node src/cli.js --help` works as a real process', () => {
    const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^agent-md-caregiver: check AGENTS\.md/);
  });

  test('the bin script works as a real process and --version matches package.json', () => {
    const r = spawnSync(process.execPath, [BIN, '--version'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), PKG.version);
    assert.equal(PKG.bin['agent-md-caregiver'], 'bin/agent-md-caregiver.js');
  });
});

describe('discovery', () => {
  test('finds root and nested instruction files; skips ignored, node_modules and other files', () => {
    const { stdout } = cli(['--format', 'json']);
    assert.deepEqual(JSON.parse(stdout).files, ['AGENTS.md', 'CLAUDE.md', 'packages/a/AGENTS.md', 'packages/b/codex.md']);
  });

  test('explicit file, directory and --root', () => {
    assert.deepEqual(JSON.parse(cli(['CLAUDE.md', '--format', 'json']).stdout).files, ['CLAUDE.md']);
    assert.deepEqual(JSON.parse(cli(['packages', '--format', 'json']).stdout).files, ['packages/a/AGENTS.md', 'packages/b/codex.md']);
    const r = makeRepo(FILES);
    cleanups.push(r.cleanup);
    const out = cli(['--root', r.root, '--format', 'json'], { files: {} });
    assert.equal(JSON.parse(out.stdout).files.length, 4);
  });

  test('paths are relative to the working directory', () => {
    const { stdout } = cli(['a/AGENTS.md', '--format', 'json', '--root', '..'], { cwd: 'packages' });
    assert.deepEqual(JSON.parse(stdout).files, ['packages/a/AGENTS.md']);
  });

  test('a repo with no instruction files is clean, with a hint', () => {
    const { code, stdout } = cli([], { files: { 'a.txt': '' } });
    assert.equal(code, 0);
    assert.match(stdout, /No instruction files found/);
    assert.deepEqual(JSON.parse(cli(['--format', 'json'], { files: { 'a.txt': '' } }).stdout).files, []);
  });

  test('missing path or path outside the root: exit 2', () => {
    const missing = cli(['nope.md']);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /nope\.md: no such file/);
    const outside = cli(['../x.md']);
    assert.equal(outside.code, 2);
    assert.match(outside.stderr, /outside the repo root/);
    assert.equal(cli(['--root', '/definitely/not/here']).code, 2);
  });
});

describe('exit codes and rule levels', () => {
  test('info findings do not fail the run', () => {
    const { code, stdout } = cli([]);
    assert.equal(code, 0);
    assert.match(stdout, /AMC000/);
  });

  test('--rule raises or lowers severity; off silences the rule', () => {
    assert.equal(cli(['--rule', 'AMC000=error']).code, 1);
    assert.equal(cli(['--rule', 'amc000=warn']).code, 0);
    assert.equal(cli(['--rule', 'AMC000=warn', '--strict']).code, 1);
    const off = cli(['--rule', 'AMC000=off', '--format', 'json']);
    assert.equal(off.code, 0);
    assert.deepEqual(JSON.parse(off.stdout).findings, []);
  });

  test('--strict alone does not fail on info', () => {
    assert.equal(cli(['--strict']).code, 0);
  });

  test('usage errors exit 2 with a message on stderr and nothing on stdout', () => {
    const cases = [
      [['--bogus'], /Unknown option/],
      [['--format', 'xml'], /--format must be one of/],
      [['--format', 'github'], /not available yet/],
      [['--format', 'sarif'], /not available yet/],
      [['--max-lines', '0'], /positive integer/],
      [['--max-lines', 'abc'], /positive integer/],
      [['--rule', 'AMC000'], /--rule expects/],
      [['--rule', 'AMC999=off'], /unknown rule "AMC999"/],
      [['--rule', 'AMC000=loud'], /level must be one of/],
      [['--write'], /--write only makes sense with --init/],
      [['--explain', 'AMC999'], /unknown rule/],
    ];
    for (const [argv, re] of cases) {
      const r = cli(argv);
      assert.equal(r.code, 2, argv.join(' '));
      assert.match(r.stderr, re, argv.join(' '));
      assert.equal(r.stdout, '', argv.join(' '));
    }
  });

  test('an unexpected failure exits 2 with "internal error"', () => {
    const r = cli([], { io: { stdout: { write: () => { throw new Error('boom'); } } } });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /internal error: .*boom/);
  });
});

describe('--explain', () => {
  test('prints the rule docs (case-insensitive id)', () => {
    const { code, stdout } = cli(['--explain', 'amc000']);
    assert.equal(code, 0);
    assert.match(stdout, /^AMC000 empty-file/);
  });
});

describe('--init', () => {
  test('prints the skeleton and writes nothing', () => {
    const { code, stdout, root } = cli(['--init'], { files: { 'a.txt': '' } });
    assert.equal(code, 0);
    assert.match(stdout, /^# AGENTS\.md/);
    assert.ok(stdout.includes('## Boundaries'));
    assert.equal(existsSync(join(root, 'AGENTS.md')), false);
  });

  test('--init --write creates AGENTS.md once and refuses to overwrite', () => {
    const r = makeRepo({ 'a.txt': '' });
    cleanups.push(r.cleanup);
    const io = () => {
      const out = { stdout: '', stderr: '' };
      return {
        out,
        io: {
          stdout: { write: (s) => (out.stdout += s) },
          stderr: { write: (s) => (out.stderr += s) },
          cwd: r.root,
          env: {},
        },
      };
    };
    const first = io();
    assert.equal(run(['--init', '--write'], first.io), 0);
    const written = readFileSync(join(r.root, 'AGENTS.md'), 'utf8');
    assert.match(written, /^# AGENTS\.md/);
    r.write('AGENTS.md', 'mine\n');
    const second = io();
    assert.equal(run(['--init', '--write'], second.io), 2);
    assert.match(second.out.stderr, /already exists/);
    assert.equal(readFileSync(join(r.root, 'AGENTS.md'), 'utf8'), 'mine\n');
  });

  test('the skeleton passes our own checks (no claims turn into findings)', () => {
    const r = cli(['--init']);
    const out = cli(['--rule', 'AMC000=error', '--format', 'json'], { files: { 'AGENTS.md': r.stdout } });
    assert.equal(out.code, 0);
  });
});

describe('reporters', () => {
  test('json report matches the committed snapshot', () => {
    const { stdout } = cli(['--format', 'json']);
    const actual = stdout.replace(`"version": "${PKG.version}"`, '"version": "__VERSION__"');
    if (process.env.UPDATE_SNAPSHOTS) writeFileSync(SNAPSHOT, actual);
    assert.equal(actual, readFileSync(SNAPSHOT, 'utf8'));
  });

  test('json report is deterministic and has the documented shape', () => {
    const a = cli(['--format', 'json']).stdout;
    const b = cli(['--format', 'json']).stdout;
    assert.equal(a, b);
    const report = JSON.parse(a);
    assert.deepEqual(Object.keys(report), ['schemaVersion', 'tool', 'files', 'findings', 'summary']);
    assert.equal(report.schemaVersion, 1);
    assert.deepEqual(report.tool, { name: 'agent-md-caregiver', version: PKG.version });
    assert.deepEqual(Object.keys(report.findings[0]), [
      'ruleId', 'severity', 'message', 'file', 'line', 'col', 'evidence', 'suggestion',
    ]);
    assert.deepEqual(report.summary, { files: 4, errors: 0, warnings: 0, infos: 2 });
    assert.ok(!a.includes(process.cwd()), 'no absolute paths');
  });

  test('pretty report (no color)', () => {
    const { stdout } = cli([]);
    assert.equal(
      stdout,
      [
        'packages/a/AGENTS.md',
        '  1:1     info   Instruction file is empty  AMC000',
        '          fix: Add build and test commands, conventions and boundaries, or delete the file.',
        '',
        'packages/b/codex.md',
        '  1:1     info   Instruction file is empty  AMC000',
        '          fix: Add build and test commands, conventions and boundaries, or delete the file.',
        '',
        '4 files checked: 0 error(s), 0 warning(s), 2 info.',
        '',
      ].join('\n'),
    );
  });

  test('pretty report: clean run, and color only on a TTY without NO_COLOR', () => {
    const clean = { 'AGENTS.md': '# Hi\n\nRun `npm test`.\n' };
    assert.equal(cli([], { files: clean }).stdout, '1 file checked, no problems found.\n');
    const tty = cli([], { io: { isTTY: true } }).stdout;
    assert.ok(tty.includes('\u001b['));
    assert.ok(!cli(['--no-color'], { io: { isTTY: true } }).stdout.includes('\u001b['));
    assert.ok(!cli([], { io: { isTTY: true, env: { NO_COLOR: '1' } } }).stdout.includes('\u001b['));
  });
});
