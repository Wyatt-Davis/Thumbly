#!/usr/bin/env node
/**
 * Lightweight sanity checks for Thumbly. No dependencies.
 * Freshness of index.html is checked by `node scripts/build.mjs --check`.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function fail(message) {
  failures.push(message);
}

function pngSize(rel) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    fail(`${rel} is missing`);
    return null;
  }
  const buf = readFileSync(path);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) {
    fail(`${rel} is not a PNG`);
    return null;
  }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') {
    fail(`${rel} is missing an IHDR chunk`);
    return null;
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function expectPng(rel, width, height) {
  const size = pngSize(rel);
  if (!size) return;
  if (size.width !== width || size.height !== height) {
    fail(`${rel} is ${size.width}x${size.height}, expected ${width}x${height}`);
  }
}

const required = [
  'index.html',
  'src/index.html',
  'src/styles.css',
  'src/app.js',
  'src/vendor/jszip.min.js',
  'manifest.webmanifest',
  '.nojekyll',
  'LICENSE',
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  'assets/favicon.ico',
  'assets/favicon-32.png',
  'assets/apple-touch-icon.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/og.png',
  'docs/screenshots/main.png',
  'docs/screenshots/batch.png',
  'docs/screenshots/light.png',
];

for (const rel of required) {
  if (!existsSync(join(root, rel))) fail(`missing ${rel}`);
}

expectPng('assets/favicon-32.png', 32, 32);
expectPng('assets/apple-touch-icon.png', 180, 180);
expectPng('assets/icon-192.png', 192, 192);
expectPng('assets/icon-512.png', 512, 512);
expectPng('assets/og.png', 1200, 630);

function expectPngExists(rel) {
  const size = pngSize(rel);
  if (size && (size.width < 200 || size.height < 200)) {
    fail(`${rel} looks too small to be a screenshot (${size.width}x${size.height})`);
  }
}
if (existsSync(join(root, 'docs/screenshots/main.png'))) {
  expectPngExists('docs/screenshots/main.png');
  expectPngExists('docs/screenshots/batch.png');
  expectPngExists('docs/screenshots/light.png');
}

const ico = existsSync(join(root, 'assets/favicon.ico')) ? readFileSync(join(root, 'assets/favicon.ico')) : Buffer.alloc(0);
if (ico.length < 6 || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) {
  fail('assets/favicon.ico is not an ICO file');
} else if (ico.readUInt16LE(4) < 2) {
  fail('assets/favicon.ico should contain a 16px and a 32px image');
}

let manifest;
try {
  manifest = JSON.parse(read('manifest.webmanifest'));
} catch (err) {
  fail(`manifest.webmanifest is not valid JSON (${err.message})`);
}
if (manifest) {
  if (manifest.start_url !== './' || manifest.scope !== './') {
    fail('manifest start_url and scope must be relative (./) so GitHub Pages works under /Thumbly/');
  }
  if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) {
    fail('manifest is missing icons');
  } else {
    for (const icon of manifest.icons) {
      if (typeof icon.src !== 'string' || icon.src.startsWith('/') || icon.src.includes('://')) {
        fail(`manifest icon src must be a relative path: ${icon.src}`);
      } else if (!existsSync(join(root, icon.src))) {
        fail(`manifest icon is missing: ${icon.src}`);
      }
    }
  }
}

const rootHtml = existsSync(join(root, 'index.html')) ? read('index.html') : '';
const srcHtml = existsSync(join(root, 'src/index.html')) ? read('src/index.html') : '';
const app = existsSync(join(root, 'src/app.js')) ? read('src/app.js') : '';
const css = existsSync(join(root, 'src/styles.css')) ? read('src/styles.css') : '';
const jszip = existsSync(join(root, 'src/vendor/jszip.min.js')) ? read('src/vendor/jszip.min.js') : '';

for (const [name, html] of [['index.html', rootHtml], ['src/index.html', srcHtml]]) {
  if (!html) continue;
  if (html.includes('type="module"') || html.includes("type='module'")) {
    fail(`${name} must use classic script tags so it opens from file://`);
  }
  if (!html.includes('Wyatt Davis &copy; 2026')) fail(`${name} is missing the footer credit`);
  if (!html.includes('rel="manifest"')) fail(`${name} does not link the web manifest`);
  if (!html.includes('og:image')) fail(`${name} is missing Open Graph image metadata`);
  if (!html.includes('https://wyatt-davis.github.io/Thumbly/')) fail(`${name} is missing the canonical site URL`);
  if (/(\shref|\ssrc)\s*=\s*["']\//.test(html)) fail(`${name} has a root-absolute path, which breaks the /Thumbly/ subpath`);
  if (html.includes('<base')) fail(`${name} must not set a <base> href`);
}

if (srcHtml) {
  for (const ref of ['href="styles.css"', 'src="vendor/jszip.min.js"', 'src="app.js"', '../assets/', '../manifest.webmanifest']) {
    if (!srcHtml.includes(ref)) fail(`src/index.html is missing ${ref}`);
  }
  if (srcHtml.includes('Generated from src/')) fail('src/index.html should stay the hand-edited source, not a build product');
}
if (rootHtml) {
  if (rootHtml.includes('src="app.js"') || rootHtml.includes('href="styles.css"') || rootHtml.includes('../assets/')) {
    fail('index.html still points at split source files');
  }
  if (!rootHtml.includes('function parseYouTubeLink')) fail('index.html is missing the inlined app');
  if (!rootHtml.includes('JSZip v3.10.1')) fail('index.html is missing the inlined JSZip banner');
  if (!rootHtml.includes('Generated from src/ by scripts/build.mjs')) fail('index.html is missing the generated-file note');
  if ((rootHtml.match(/<script>/g) || []).length !== 2) fail('index.html should contain exactly two inline scripts (JSZip and the app)');
  if ((rootHtml.match(/<style>/g) || []).length !== 1) fail('index.html should contain exactly one inline stylesheet');
}

if (css.includes('url(/') || css.includes("url('/") || css.includes('url("/')) {
  fail('src/styles.css has a root-absolute url()');
}
for (const needle of ['function parseYouTubeLink', 'https://noembed.com/embed', 'thumbly-recent', "window.onload = init", "key === 'b'", "key === 'r'", "key === 'c'"]) {
  if (!app.includes(needle)) fail(`src/app.js is missing ${needle}`);
}
if (!jszip.startsWith('/*!\n\nJSZip v3.10.1')) fail('vendored JSZip is missing its license banner');
if (jszip.includes('type="module"')) fail('vendored JSZip must stay a classic script');

const textFiles = [
  'index.html',
  'src/index.html',
  'src/styles.css',
  'src/app.js',
  'src/vendor/jszip.min.js',
  'manifest.webmanifest',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'scripts/build.mjs',
  'scripts/check.mjs',
];
for (const rel of textFiles) {
  const path = join(root, rel);
  if (!existsSync(path)) continue;
  if (readFileSync(path).includes(0x0d)) fail(`${rel} contains CR characters; use LF line endings`);
  const stat = statSync(path);
  if (stat.size === 0) fail(`${rel} is empty`);
}

const license = existsSync(join(root, 'LICENSE')) ? read('LICENSE') : '';
if (!license.includes('MIT License') || !license.includes('Copyright (c) 2026 Wyatt Davis')) {
  fail('LICENSE must be MIT, copyright 2026 Wyatt Davis');
}
const notices = existsSync(join(root, 'THIRD_PARTY_NOTICES.md')) ? read('THIRD_PARTY_NOTICES.md') : '';
if (!notices.includes('JSZip') || !notices.includes('3.10.1') || !notices.includes('pako')) {
  fail('THIRD_PARTY_NOTICES.md must credit JSZip 3.10.1 and pako');
}
const changelog = existsSync(join(root, 'CHANGELOG.md')) ? read('CHANGELOG.md') : '';
if (!changelog.includes('## [1.0.0] - 2026-10-20')) fail('CHANGELOG.md is missing 1.0.0 dated 2026-10-20');
const readme = existsSync(join(root, 'README.md')) ? read('README.md') : '';
if (!readme.includes('https://wyatt-davis.github.io/Thumbly/')) fail('README.md is missing the live site link');
if (!readme.includes('docs/screenshots/main.png')) fail('README.md is missing the screenshot');

if (failures.length) {
  console.error(`Sanity checks failed (${failures.length}):`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}
console.log('Sanity checks passed.');
