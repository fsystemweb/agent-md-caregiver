import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/parse/index.js';

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/parse/${name}`, import.meta.url)), 'utf8');

/** Compact view of claims for readable assertions. */
const brief = (claims) => claims.map((c) => [c.kind, c.text, c.line, c.col]);

test('basic fixture: exact kinds, text, line and column', () => {
  const { claims } = parse(fixture('basic.md'), { file: 'basic.md' });
  assert.deepEqual(brief(claims), [
    ['command', 'npm test', 3, 6],
    ['path', 'src/parse/index.js', 4, 6],
    ['path', 'docs/guide.md', 5, 2],
    ['command', 'npm install', 10, 3],
    ['command', 'pnpm run build', 11, 1],
    ['command', 'make lint', 11, 19],
    ['directive', 'Always use pnpm.', 14, 1],
  ]);
  assert.deepEqual(
    claims.map((c) => c.via ?? null),
    ['inline-code', 'inline-code', 'import', 'fence', 'fence', 'fence', null],
  );
  assert.ok(claims.every((c) => c.file === 'basic.md'));
});

test('claim carries the raw source it came from', () => {
  const { claims } = parse('Run `npm test` now.\n', { file: 'a.md' });
  assert.equal(claims[0].raw, '`npm test`');
  const dir = parse('```sh\n$ npm run build\n```\n').claims[0];
  assert.equal(dir.raw, '$ npm run build');
});

test('silent fixture: URLs, globs, placeholders, prose, quotes, ignores produce no claims', () => {
  const { claims } = parse(fixture('silent.md'));
  assert.deepEqual(brief(claims), []);
});

test('ignore markers only ignore what they cover', () => {
  const src = [
    '<!-- amc-ignore-next-line -->',
    '`npm run a`',
    '`npm run b`',
    '',
    '<!-- amc-ignore -->',
    '`npm run c`',
    '',
    '`npm run d`',
  ].join('\n');
  assert.deepEqual(brief(parse(src).claims), [
    ['command', 'npm run b', 3, 2],
    ['command', 'npm run d', 8, 2],
  ]);
});

test('commands: shell fences, prompts, env vars, continuations, comments', () => {
  const src = [
    '```sh',
    '# a comment',
    'CI=1 npm run test:ci',
    'npx tsc \\',
    '  --noEmit',
    'node scripts/build.js | tee out.log',
    'echo hi',
    'make',
    '```',
  ].join('\n');
  assert.deepEqual(brief(parse(src).claims), [
    ['command', 'npm run test:ci', 3, 6],
    ['command', 'npx tsc --noEmit', 4, 1],
    ['command', 'node scripts/build.js', 6, 1],
    ['command', 'make', 8, 1],
  ]);
});

test('commands: unlabeled fences count, other languages do not', () => {
  assert.equal(parse('```\nnpm test\n```').claims.length, 1);
  assert.equal(parse('```python\nnpm test\n```').claims.length, 0);
  assert.equal(parse('```diff\n+ npm test\n```').claims.length, 0);
});

test('commands: inline code must be a full command with an argument', () => {
  const { claims } = parse('Use `pnpm test` or `yarn build`, not `npm`.');
  assert.deepEqual(brief(claims.filter((c) => c.kind === 'command')), [
    ['command', 'pnpm test', 1, 6],
    ['command', 'yarn build', 1, 21],
  ]);
});

test('paths: inline code, links, images, imports, line refs', () => {
  const src = [
    'Edit `src/cli.js:42` and `README.md`.',
    '![logo](assets/logo.svg "Logo") and [guide](./docs/guide.md#intro).',
    '- @AGENTS.md',
    'Also `@docs/rules.md`.',
  ].join('\n');
  const { claims } = parse(src);
  assert.deepEqual(brief(claims), [
    ['path', 'src/cli.js', 1, 7],
    ['path', 'README.md', 1, 27],
    ['path', 'assets/logo.svg', 2, 9],
    ['path', './docs/guide.md', 2, 45],
    ['path', 'AGENTS.md', 3, 4],
    ['path', 'docs/rules.md', 4, 8],
  ]);
  assert.deepEqual(
    claims.map((c) => c.via),
    ['inline-code', 'inline-code', 'link', 'link', 'import', 'import'],
  );
});

test('paths: directories with a slash count, bare words do not', () => {
  assert.deepEqual(brief(parse('See `src/rules/` and `test`.').claims), [['path', 'src/rules/', 1, 6]]);
});

test('directives: only when a known subject is present', () => {
  const src = [
    '- Always use pnpm, never npm.',
    '- Never commit secrets.',
    '- Use tabs for indentation.',
    '- Prefer vitest over jest.',
    '- Requires Node 20 or newer, must not use Node 18.',
    '| Use pnpm | in a table |',
  ].join('\n');
  const { claims } = parse(src);
  const d = claims.filter((c) => c.kind === 'directive').map((c) => [c.line, c.verb, c.subject]);
  assert.deepEqual(d, [
    [1, 'always', 'package-manager'],
    [3, 'use', 'indentation'],
    [4, 'prefer', 'test-runner'],
    [5, 'must not', 'language-version'],
  ]);
  assert.equal(claims.find((c) => c.line === 1).col, 3);
});

test('structure: line count, headings, tree dumps', () => {
  const { structure } = parse(fixture('tree.md'));
  assert.equal(structure.lineCount, 19);
  assert.deepEqual(structure.headings, [{ level: 1, text: 'Layout', line: 1 }]);
  assert.deepEqual(structure.treeDumps, [
    { line: 3, endLine: 8, lines: 3, fenced: true },
    { line: 12, endLine: 14, lines: 3, fenced: false },
  ]);
});

test('structure: headings keep levels and ignore fenced "#" lines', () => {
  const src = '# A\n## B ##\n```sh\n# not a heading\n```\n### C\n';
  assert.deepEqual(parse(src).structure.headings, [
    { level: 1, text: 'A', line: 1 },
    { level: 2, text: 'B', line: 2 },
    { level: 3, text: 'C', line: 6 },
  ]);
  assert.equal(parse(src).structure.lineCount, 6);
});

test('tree dumps do not produce path claims', () => {
  assert.deepEqual(brief(parse(fixture('tree.md')).claims), []);
});

test('CRLF input gives the same positions', () => {
  const lf = parse(fixture('basic.md')).claims;
  const crlf = parse(fixture('basic.md').replace(/\n/g, '\r\n')).claims;
  assert.deepEqual(brief(crlf), brief(lf));
});

test('unterminated fence runs to end of file', () => {
  assert.deepEqual(brief(parse('```sh\nnpm test').claims), [['command', 'npm test', 2, 1]]);
});

test('empty input', () => {
  assert.deepEqual(parse(''), { claims: [], structure: { lineCount: 0, headings: [], treeDumps: [] } });
});

test("the repo's own AGENTS.md yields exactly the claims it actually makes", () => {
  const src = readFileSync(fileURLToPath(new URL('../AGENTS.md', import.meta.url)), 'utf8');
  const { claims } = parse(src, { file: 'AGENTS.md' });
  assert.deepEqual(
    claims.map((c) => [c.kind, c.text]),
    [
      ['command', 'npm test'],
      ['command', 'node src/cli.js --help'],
      ['path', 'CONTRIBUTING.md'],
    ],
  );
});

test('commands in a fence carry the directory set by cd', () => {
  const src = [
    '```sh',
    'npm test',
    'cd frontend && npm run dev',
    'pnpm build',
    'cd ../x',
    'make',
    '```',
    '```sh',
    'npm run fresh-block',
    '```',
  ].join('\n');
  const { claims } = parse(src);
  assert.deepEqual(
    claims.map((c) => [c.text, c.dir]),
    [
      ['npm test', undefined],
      ['npm run dev', 'frontend'],
      ['pnpm build', 'frontend'],
      ['make', 'x'],
      ['npm run fresh-block', undefined],
    ],
  );
  assert.deepEqual(parse('```sh\ncd $DIR\nnpm test\n```').claims[0].dir, '?');
  assert.deepEqual(parse('```sh\ncd a\ncd b\nnpm test\n```').claims[0].dir, 'a/b');
  assert.deepEqual(parse('```sh\ncd /abs\nnpm test\n```').claims[0].dir, '?');
  assert.deepEqual(parse('```sh\ncd a\ncd ../..\nnpm test\n```').claims[0].dir, '?');
  assert.deepEqual(parse('```sh\ncd ./\nnpm test\n```').claims[0].dir, undefined);
});
