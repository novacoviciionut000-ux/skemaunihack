// Fails when the UI uses a color that is not in src/theme.js (palette, rgb, brand exceptions).
import { readFileSync, readdirSync } from 'fs';
import { build } from 'esbuild';

const here = new URL('.', import.meta.url).pathname;
const root = new URL('..', import.meta.url).pathname;
const out = `${here}.theme.out.mjs`;
await build({ entryPoints: [`${root}src/theme.js`], bundle: true, format: 'esm', outfile: out, logLevel: 'error' });
const { palette, rgb, brandExceptions } = await import(out);

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
const allowedHex = new Set([...Object.values(palette), ...brandExceptions].map((h) => h.toUpperCase()));
const allowedRgb = new Set([
  ...Object.values(rgb).map((t) => t.replace(/\s/g, '')),
  ...Object.values(palette).map(hexToRgb),
]);

const files = [
  ...readdirSync(`${root}src/components`).filter((f) => f.endsWith('.jsx')).map((f) => `${root}src/components/${f}`),
  `${root}src/App.jsx`,
  `${root}index.html`,
];

const problems = [];
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      const hex = m[0].length === 4 ? `#${[...m[1]].map((c) => c + c).join('')}` : m[0];
      if (!allowedHex.has(hex.toUpperCase())) problems.push(`${file.replace(root, '')}:${i + 1} ${m[0]}`);
    }
    for (const m of line.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
      const key = `${m[1]},${m[2]},${m[3]}`;
      if (!allowedRgb.has(key)) problems.push(`${file.replace(root, '')}:${i + 1} ${m[0]})`);
    }
  });
}

if (problems.length) {
  console.log(`FAIL ${problems.length} color(s) outside the palette (src/theme.js):`);
  problems.slice(0, 40).forEach((p) => console.log('  ' + p));
  process.exit(1);
}
console.log(`palette: all colors in ${files.length} files come from src/theme.js`);
