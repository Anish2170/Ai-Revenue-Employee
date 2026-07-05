/**
 * Builds the widget into a single, framework-independent IIFE that any site can
 * load via <script src=".../widget.js" data-site-id="...">. Output is written
 * into the backend's public/ dir so one origin serves everything in dev.
 */
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(__dirname, '..', 'backend', 'public', 'widget.js');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [resolve(__dirname, 'src', 'index.ts')],
  outfile,
  bundle: true,
  format: 'iife',
  target: ['es2018'],
  platform: 'browser',
  minify: !watch,
  sourcemap: watch,
  legalComments: 'none',
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`[widget] watching → ${outfile}`);
} else {
  await build(options);
  console.log(`[widget] built → ${outfile}`);
}
