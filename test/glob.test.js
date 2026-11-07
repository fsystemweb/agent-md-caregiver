import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compileGlob, MAX_GLOB_LENGTH } from '../src/repo/glob.js';
import { matchIgnore, parseGitignore } from '../src/repo/gitignore.js';
import { matchWorkspaceDirs } from '../src/repo/package.js';

/** The previous implementation (glob -> backtracking regex), kept as the oracle for equivalence tests. */
function oracleSource(glob) {
  const esc = (c) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const atStart = i === 0 || glob[i - 1] === '/';
        if (glob[i + 2] === '/' && atStart) { out += '(?:.*/)?'; i += 2; }
        else if (i + 2 === glob.length && atStart) { out += '.*'; i += 1; }
        else { out += '[^/]*'; i += 1; }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 2);
      if (end === -1) out += '\\[';
      else {
        let cls = glob.slice(i + 1, end);
        if (cls[0] === '!') cls = '^' + cls.slice(1);
        out += `[${cls.replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else if (c === '\\' && i + 1 < glob.length) out += esc(glob[++i]);
    else out += esc(c);
  }
  return out;
}

/** Small deterministic PRNG so failures reproduce. */
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const time = (fn) => {
  const t = process.hrtime.bigint();
  const r = fn();
  return { r, ms: Number(process.hrtime.bigint() - t) / 1e6 };
};

describe('compileGlob matches exactly what the old regex translation matched', () => {
  test('5000 random patterns against random strings, anchored and floating', () => {
    const next = rng(42);
    const pick = (a) => a[Math.floor(next() * a.length)];
    const parts = ['a', 'b', '.', '*', '**', '?', '/', '[ab]', '[!a]', '**/', '\\*', '[a-b]'];
    let checked = 0;
    for (let n = 0; n < 5000; n++) {
      const glob = Array.from({ length: 1 + Math.floor(next() * 6) }, () => pick(parts)).join('');
      const exact = new RegExp(`^${oracleSource(glob)}$`);
      const floating = new RegExp(`^(?:.*/)?${oracleSource(glob)}$`);
      const m = compileGlob(glob);
      const mf = compileGlob(glob, { floating: true });
      for (let k = 0; k < 8; k++) {
        const str = Array.from({ length: Math.floor(next() * 9) }, () => pick(['a', 'b', '/', '.', '*'])).join('');
        assert.equal(m.test(str), exact.test(str), `exact: ${JSON.stringify(glob)} vs ${JSON.stringify(str)}`);
        assert.equal(mf.test(str), floating.test(str), `floating: ${JSON.stringify(glob)} vs ${JSON.stringify(str)}`);
        checked++;
      }
    }
    assert.equal(checked, 5000 * 8);
  });

  test('gitignore semantics are unchanged on common patterns', () => {
    const ignored = (patterns, path, isDir = false) => matchIgnore(parseGitignore(patterns), path, isDir) === true;
    assert.ok(ignored('*.log\n', 'a/b/c.log'));
    assert.ok(ignored('/dist\n', 'dist', true));
    assert.ok(!ignored('/dist\n', 'src/dist', true));
    assert.ok(ignored('build/\n', 'x/build', true));
    assert.ok(!ignored('build/\n', 'x/build', false));
    assert.ok(!ignored('*.js\n!keep.js\n', 'keep.js'));
    assert.ok(ignored('docs/**/*.tmp\n', 'docs/a/b/x.tmp'));
    assert.ok(ignored('a\\ \n', 'a '), 'an escaped trailing space is kept');
    assert.ok(!ignored('a \n', 'a '), 'an unescaped trailing space is trimmed');
  });

  test('workspace globs', () => {
    assert.deepEqual(matchWorkspaceDirs(['packages/*', '!packages/skip'], ['packages/a', 'packages/skip', 'apps/x']), ['packages/a']);
    assert.deepEqual(matchWorkspaceDirs(['./apps/**'], ['apps/x', 'apps/x/y', 'packages/a']), ['apps/x', 'apps/x/y']);
  });
});

describe('hostile globs and .gitignore lines stay cheap (security audit: regex backtracking)', () => {
  test('many stars with literals between them, against a long non-matching name', () => {
    for (const k of [4, 12, 40]) {
      const { r, ms } = time(() => matchWorkspaceDirs(['*a'.repeat(k) + '*b'], ['a'.repeat(250)]));
      assert.deepEqual(r, []);
      assert.ok(ms < 200, `k=${k} took ${ms} ms`);
    }
    const { ms } = time(() => compileGlob('*a'.repeat(200) + '*b').test('a'.repeat(250)));
    assert.ok(ms < 200, `200 stars took ${ms} ms`);
  });

  test('stacked `**/` groups and a hostile .gitignore pattern', () => {
    const rules = parseGitignore('**/'.repeat(30) + 'x\n' + '*a'.repeat(50) + '*b\n');
    const { ms } = time(() => matchIgnore(rules, 'a'.repeat(250), false));
    assert.ok(ms < 200, `took ${ms} ms`);
  });

  test('a .gitignore line of whitespace is trimmed in linear time', () => {
    for (const n of [80000, 400000]) {
      const { r, ms } = time(() => parseGitignore(`x${' '.repeat(n)}y\n`));
      assert.equal(r.length === 0 || r.length === 1, true);
      assert.ok(ms < 300, `n=${n} took ${ms} ms`);
    }
    const { ms } = time(() => parseGitignore(`x${' '.repeat(400000)}\n`));
    assert.ok(ms < 300, `trailing run took ${ms} ms`);
  });

  test('over-long lines and patterns are skipped; a malformed class does not crash', () => {
    assert.deepEqual(parseGitignore(`${'a'.repeat(5000)}\n`), []);
    assert.equal(compileGlob('a'.repeat(MAX_GLOB_LENGTH + 1)).test('a'.repeat(MAX_GLOB_LENGTH + 1)), false);
    assert.doesNotThrow(() => compileGlob('[z-a]').test('a'));
    assert.equal(compileGlob('[z-a]').test('a'), false);
    assert.doesNotThrow(() => matchWorkspaceDirs(['[z-a]'], ['a']));
    assert.deepEqual(matchIgnore(parseGitignore('[z-a]\n*.log\n'), 'x.log', false), true, 'other lines still apply');
  });
});
