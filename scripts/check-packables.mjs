#!/usr/bin/env node
/**
 * Guard rail: refuse to publish an empty tarball or the 0.0.0 placeholder.
 *
 * For this SINGLE-PACKAGE repo there is no dist build — files: ["extensions", "README.md", "LICENSE"].
 * We ensure `npm pack --dry-run --json` (fallback to `bun pm pack --dry-run`) lists at least one
 * file under extensions/. Publishing is the only irreversible action; this guard prevents burning
 * a version with an empty tarball.
 *
 * Adapted from yorch/colophon scripts/check-packables.mjs - removed Backstage prepack restore
 * and dist/ assertion (see repo-release-process.md §5, §11).
 * Primary is npm pack JSON (stable); bun pm pack is fallback (table parsing).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
let pkg;
try {
  pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
} catch (e) {
  console.error('Failed to read package.json:', e?.message ?? e);
  process.exit(1);
}

// 1. Refuse 0.0.0 placeholder
if (pkg.version === '0.0.0') {
  console.error('Refusing to publish 0.0.0 placeholder version. Run `bun run version-packages` first.');
  process.exit(1);
}

// 2. Refuse empty tarball: pack --dry-run and assert extensions/ files exist
function getPackFiles() {
  let lastError;
  // Primary: npm pack JSON (stable, no ANSI, no 2>&1)
  try {
    const out = execSync('npm pack --dry-run --json', {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const json = JSON.parse(out);
    const entry = Array.isArray(json) ? json[0] : json;
    const files = entry?.files;
    if (Array.isArray(files) && files.length > 0) {
      return files.map(f => f.path ?? f);
    }
    // If npm produced empty, fall through to bun
  } catch (e) {
    lastError = e;
  }
  // Fallback: bun pm pack table (parse extensions/ tokens)
  try {
    const out = execSync('bun pm pack --dry-run', {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    // bun prints a table; extract extensions/ tokens without fragile ANSI regex
    // Strip ANSI via control-char replacement using string char code to avoid lint
    const ansiStripped = out.replaceAll(String.fromCharCode(27) + '[', '[').replaceAll('\u001B[', '[');
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence
    const ansiRegex = /\x1B\[[0-9;]*m/g;
    const cleaned = ansiStripped.replace(ansiRegex, '');
    const files = cleaned
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        const m = l.match(/(extensions\/[^\s]+)/);
        return m ? m[1] : null;
      })
      .filter(Boolean);
    if (files.length > 0) return files;
    const alt = cleaned.split('\n').filter(l => l.includes('extensions/'));
    if (alt.length > 0) return alt;
  } catch (e) {
    lastError = e;
  }
  throw lastError ?? new Error('pack dry-run failed');
}

let files;
try {
  files = getPackFiles();
} catch (e) {
  console.error('Failed to run pack --dry-run:', e?.message ?? e);
  process.exit(1);
}

const hasExtensions = files.some(f => String(f).includes('extensions/') || String(f) === 'extensions');

if (!hasExtensions) {
  console.error('Refusing to publish: tarball contains no files under extensions/.');
  console.error('Files found:', files.slice(0, 20).join(', ') || '<none>');
  console.error('Check `files` in package.json and that extensions/ exists.');
  process.exit(1);
}

console.log(`check-packables: ok - version ${pkg.version}, ${files.length} files, tarball includes extensions/`);
