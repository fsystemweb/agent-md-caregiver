// Renders assets/demo.svg, the animated terminal session embedded at the top of the README.
//
// It rebuilds the repo from the README's "## Demo" section, runs the real CLI on it, fixes
// AGENTS.md, shows the diff and runs the CLI again. Every line of output in the animation is
// what the tool printed, and test/demo-svg.test.js fails when the committed SVG is stale.
//
//   node scripts/demo-svg.js           write assets/demo.svg
//   node scripts/demo-svg.js --check   exit 1 if assets/demo.svg is out of date

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.js';
import { git, makeRepo } from '../test/helpers/make-repo.js';

export const SVG_PATH = fileURLToPath(new URL('../assets/demo.svg', import.meta.url));
const README_PATH = fileURLToPath(new URL('../README.md', import.meta.url));

/** The command shown at the prompt. The CLI is the same whether run with npx or node. */
const COMMAND = 'npx agent-md-caregiver';

/** Edits that turn the README demo's AGENTS.md into one the tool accepts. */
const FIXES = [
  ['@docs/code-style.md', '@docs/style.md'],
  ['`npm run test:unit`', '`npm run test`'],
  ['- Lint: `npm run lint:fix`', '- Build: `npm run build`'],
  ['`src/routes/users.ts`', '`src/routes/user.ts`'],
];

/**
 * The AGENTS.md shown in the README demo.
 * @param {string} readme
 */
export function demoAgentsMd(readme) {
  const demo = readme.slice(readme.indexOf('## Demo'), readme.indexOf('## Usage'));
  const m = /```md\n([\s\S]*?)\n```/.exec(demo);
  if (!m) throw new Error('README "## Demo" has no ```md block');
  return m[1] + '\n';
}

/**
 * Run the demo session for real and record what the terminal shows.
 * @param {string} readme
 * @returns {{ before: string, diff: string, after: string, codes: [number, number] }}
 */
export function recordSession(readme) {
  const bulk = (prefix) => Array.from({ length: 30 }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';
  const r = makeRepo(
    {
      'package.json': '{"name":"acme-api","scripts":{"test":"node --test","build":"tsc"}}\n',
      'package-lock.json': '{}\n',
      'src/routes/users.ts': bulk('// line'),
      'docs/code-style.md': '# Code style\n' + bulk('rule'),
    },
    { git: true },
  );
  try {
    r.mv('src/routes/users.ts', 'src/routes/user.ts');
    r.mv('docs/code-style.md', 'docs/style.md');
    r.commit('rename files');
    let agents = demoAgentsMd(readme);
    r.write('AGENTS.md', agents);
    r.commit('add AGENTS.md');

    const lint = () => {
      let out = '';
      const code = run([], { stdout: { write: (s) => (out += s) }, stderr: { write() {} }, cwd: r.root, env: {}, isTTY: true });
      return { out, code };
    };
    const before = lint();
    for (const [from, to] of FIXES) {
      if (!agents.includes(from)) throw new Error(`demo fix does not apply: ${from}`);
      agents = agents.replace(from, to);
    }
    r.write('AGENTS.md', agents);
    const diff = git(r.root, 'diff', '-U0', '--no-color', 'AGENTS.md');
    const after = lint();
    return { before: before.out, diff, after: after.out, codes: [before.code, after.code] };
  } finally {
    r.cleanup();
  }
}

// ---------------------------------------------------------------------------------------------
// Terminal rendering

const THEME = {
  bg: '#0d1117',
  bar: '#161b22',
  border: '#30363d',
  fg: '#e6edf3',
  dim: '#7d8590',
  prompt: '#58a6ff',
  31: '#ff7b72',
  32: '#3fb950',
  33: '#d29922',
  36: '#39c5cf',
};

const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const CHAR_WIDTH = 8.6; // advance of a 14px monospace glyph; only used to size the window
const PAD_X = 20;
const BAR_HEIGHT = 36;
const ROWS = 22;

/** @typedef {{ text: string, color?: string, bold?: boolean }} Span */

/**
 * Split one line with SGR escape codes into styled spans.
 * @param {string} line
 * @returns {Span[]}
 */
export function parseAnsi(line) {
  /** @type {Span[]} */
  const spans = [];
  let style = /** @type {{ color?: string, bold?: boolean }} */ ({});
  const re = /\u001b\[([0-9;]*)m/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) spans.push({ text: line.slice(last, m.index), ...style });
    for (const code of m[1].split(';')) {
      if (code === '0' || code === '') style = {};
      else if (code === '1') style = { ...style, bold: true };
      else if (code === '2') style = { ...style, color: THEME.dim };
      else if (code in THEME) style = { ...style, color: THEME[/** @type {keyof typeof THEME} */ (code)] };
    }
    last = re.lastIndex;
  }
  if (last < line.length) spans.push({ text: line.slice(last), ...style });
  return spans;
}

/** @param {string} s */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @param {Span[]} spans
 */
function tspans(spans) {
  return spans
    .map((s) => {
      const attrs = [s.color && `fill="${s.color}"`, s.bold && 'font-weight="bold"'].filter(Boolean).join(' ');
      return attrs ? `<tspan ${attrs}>${esc(s.text)}</tspan>` : esc(s.text);
    })
    .join('');
}

/** @param {string} cmd @returns {Span[][]} */
const promptLine = (cmd, cursor = false) => [[{ text: '$ ', color: THEME.prompt, bold: true }, { text: cmd }, ...(cursor ? [{ text: '▋', color: THEME.dim }] : [])]];

/** @param {string} text @returns {Span[][]} */
const outputLines = (text) => text.replace(/\n$/, '').split('\n').map(parseAnsi);

/** @param {string} diff @returns {Span[][]} */
function diffLines(diff) {
  return diff
    .replace(/\n$/, '')
    .split('\n')
    .map((l) => {
      if (l.startsWith('diff --git') || l.startsWith('index ')) return [{ text: l, bold: true }];
      if (l.startsWith('+++') || l.startsWith('---')) return [{ text: l, bold: true }];
      if (l.startsWith('@@')) return [{ text: l, color: THEME[36] }];
      if (l.startsWith('+')) return [{ text: l, color: THEME[32] }];
      if (l.startsWith('-')) return [{ text: l, color: THEME[31] }];
      return [{ text: l }];
    });
}

/**
 * Build the screen-by-screen script of the session.
 * @param {ReturnType<typeof recordSession>} session
 * @returns {{ lines: Span[][], ms: number }[]}
 */
export function frames(session) {
  /** @type {{ lines: Span[][], ms: number }[]} */
  const out = [];
  /** @param {Span[][]} screen @param {string} cmd */
  const type = (screen, cmd) => {
    for (let i = 0; i <= cmd.length; i++) out.push({ lines: [...screen, ...promptLine(cmd.slice(0, i), true)], ms: i === 0 ? 700 : 55 });
    out[out.length - 1].ms = 450;
  };
  /** @param {Span[][]} screen @param {number} ms */
  const show = (screen, ms) => out.push({ lines: screen, ms });

  const diffCmd = 'git diff -U0 AGENTS.md';
  type([], COMMAND);
  const first = [...promptLine(COMMAND), ...outputLines(session.before), ...promptLine('echo $?'), [{ text: String(session.codes[0]) }]];
  show(first, 5000);

  type([], diffCmd);
  const second = [...promptLine(diffCmd), ...diffLines(session.diff), []];
  show(second, 2600);
  type(second, COMMAND);
  show([...second, ...promptLine(COMMAND), ...outputLines(session.after), ...promptLine('echo $?'), [{ text: String(session.codes[1]) }]], 4500);
  return out;
}

/**
 * Render the frames as a looping SVG. Frames are stacked vertically and a single
 * stepped keyframe animation slides each one into the window in turn, so it plays
 * wherever SVG with CSS works (GitHub READMEs included) and needs no script.
 * @param {ReturnType<typeof frames>} script
 */
export function renderSvg(script) {
  const cols = Math.max(...script.flatMap((f) => f.lines.map((l) => l.reduce((n, s) => n + [...s.text].length, 0))));
  for (const f of script) if (f.lines.length > ROWS) throw new Error(`frame has ${f.lines.length} rows; ROWS is ${ROWS}`);
  const width = Math.ceil(cols * CHAR_WIDTH + PAD_X * 2);
  const screenH = ROWS * LINE_HEIGHT + 24;
  const height = BAR_HEIGHT + screenH;
  const total = script.reduce((n, f) => n + f.ms, 0);

  let t = 0;
  const stops = script.map((f, i) => {
    const pct = ((t / total) * 100).toFixed(3);
    t += f.ms;
    return `${pct}%{transform:translateY(${-i * screenH}px)}`;
  });

  const body = script
    .map((f, i) => {
      const y0 = i * screenH + 16 + FONT_SIZE;
      const rows = f.lines
        .map((l, r) => (l.length ? `<text x="${PAD_X}" y="${y0 + r * LINE_HEIGHT}">${tspans(l)}</text>` : ''))
        .join('');
      return `<g>${rows}</g>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="agent-md-caregiver finds four stale lines in an AGENTS.md; after fixing them, the next run is clean">
<title>agent-md-caregiver demo</title>
<style>
.film{animation:play ${total}ms steps(1,end) infinite}
@keyframes play{${stops.join('')}}
text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace;font-size:${FONT_SIZE}px;fill:${THEME.fg};white-space:pre}
@media (prefers-reduced-motion:reduce){.film{animation:none;transform:translateY(${-(script.length - 1) * screenH}px)}}
</style>
<rect width="${width}" height="${height}" rx="8" fill="${THEME.bg}" stroke="${THEME.border}"/>
<path d="M8 .5H${width - 8}A7.5 7.5 0 0 1 ${width - 0.5} 8V${BAR_HEIGHT}H.5V8A7.5 7.5 0 0 1 8 .5Z" fill="${THEME.bar}"/>
<circle cx="20" cy="18" r="6" fill="#ff5f57"/><circle cx="40" cy="18" r="6" fill="#febc2e"/><circle cx="60" cy="18" r="6" fill="#28c840"/>
<text x="${width / 2}" y="23" text-anchor="middle" style="fill:${THEME.dim};font-size:13px">acme-api</text>
<svg x="0" y="${BAR_HEIGHT}" width="${width}" height="${screenH}" viewBox="0 0 ${width} ${screenH}">
<g class="film" xml:space="preserve">
${body}
</g>
</svg>
</svg>
`;
}

/** The SVG for the current README and CLI. */
export function buildDemoSvg() {
  return renderSvg(frames(recordSession(readFileSync(README_PATH, 'utf8'))));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const svg = buildDemoSvg();
  if (process.argv.includes('--check')) {
    const ok = readFileSync(SVG_PATH, 'utf8') === svg;
    console.log(ok ? 'assets/demo.svg is up to date.' : 'assets/demo.svg is stale: run `node scripts/demo-svg.js`.');
    process.exitCode = ok ? 0 : 1;
  } else {
    writeFileSync(SVG_PATH, svg);
    console.log(`Wrote assets/demo.svg (${Buffer.byteLength(svg)} bytes).`);
  }
}
