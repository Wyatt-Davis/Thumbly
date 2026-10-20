#!/usr/bin/env node
/**
 * Inline src/ into the single-file page at the repository root.
 *
 *   node scripts/build.mjs           write index.html
 *   node scripts/build.mjs --check   fail if the committed index.html is stale
 *
 * No dependencies. Node 18 or newer.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

/** Re-indent source so the published page matches the original line padding. */
function indentBlock(text, spaces) {
  const pad = ' '.repeat(spaces);
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n').map((line) => (line ? pad + line : '')).join('\n');
}

function replaceOnce(html, marker, replacement, label) {
  const parts = html.split(marker);
  if (parts.length !== 2) {
    throw new Error(`Expected exactly one ${label}, found ${parts.length - 1}.`);
  }
  return parts[0] + replacement + parts[1];
}

export function buildHtml() {
  let html = read('src/index.html');
  const css = read('src/styles.css');
  const app = read('src/app.js');
  const jszip = read('src/vendor/jszip.min.js');

  // The split page lives in src/, so its icons point at ../assets/.
  // The published page lives at the site root.
  html = html.replaceAll('../assets/', 'assets/');

  html = replaceOnce(
    html,
    '<head>\n',
    '<head>\n  <!-- Generated from src/ by scripts/build.mjs. Edit the files in src/, then rebuild. -->\n',
    '<head> tag',
  );

  html = replaceOnce(
    html,
    '  <link rel="stylesheet" href="styles.css">',
    `  <style>\n${indentBlock(css, 4)}\n  </style>`,
    'stylesheet link',
  );

  const jszipBody = jszip.endsWith('\n') ? jszip.slice(0, -1) : jszip;
  html = replaceOnce(
    html,
    '  <script src="vendor/jszip.min.js"></script>',
    `  <script>\n${jszipBody}\n  </script>`,
    'JSZip script',
  );

  html = replaceOnce(
    html,
    '  <script src="app.js"></script>',
    `  <script>\n${indentBlock(app, 4)}\n  </script>`,
    'app script',
  );

  // JSZip's bundle contains relative module ids such as "../utils". Only the
  // page's own asset links must be rewritten; do not scan the script for "../".
  if (
    html.includes('../assets/') ||
    html.includes('rel="manifest"') ||
    html.includes('href="styles.css"') ||
    html.includes('src="app.js"') ||
    html.includes('src="vendor/jszip.min.js"')
  ) {
    throw new Error('Build left a src/ reference in index.html.');
  }
  if (!html.endsWith('\n')) html += '\n';
  return html;
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const expected = buildHtml();
  const outPath = join(root, 'index.html');
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(outPath, 'utf8');
    } catch {
      current = '';
    }
    if (current !== expected) {
      console.error('index.html is out of date. Run `node scripts/build.mjs` and commit the result.');
      process.exit(1);
    }
    console.log('index.html matches src/.');
  } else {
    writeFileSync(outPath, expected);
    console.log('Wrote index.html');
  }
}
