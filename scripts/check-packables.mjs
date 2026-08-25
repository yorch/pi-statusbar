#!/usr/bin/env node
/**
 * Guard rail: refuse to publish an empty tarball or the 0.0.0 placeholder.
 *
 * For this SINGLE-PACKAGE repo there is no dist build — files: ["extensions", "README.md", "LICENSE"].
 * We ensure `bun pm pack --dry-run` (fallback to `npm pack --dry-run --json`) lists at least one
 * file under extensions/. Publishing is the only irreversible action; this guard prevents burning
 * a version with an empty tarball.
 *
 * Adapted from yorch/colophon scripts/check-packables.mjs - removed Backstage prepack restore
 * and dist/ assertion (see repo-release-process.md §5, §11).
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
  const cmds = ['bun pm pack --dry-run 2>&1', 'npm pack --dry-run --json 2>&1'];
  let lastError;
  for (const cmd of cmds) {
    try {
      const out = execSync(cmd, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      // bun pm pack lists files line-by-line, npm pack --json is JSON array
      // Try JSON parse first
      try {
        const json = JSON.parse(out);
        // npm pack --json returns [{files:[{path:...}]}]
        if (Array.isArray(json) && json[0]?.files) {
          return json[0].files.map(f => f.path);
        }
      } catch {}
      // Fallback: treat as newline list, strip ansi and extract extensions/ paths
      const files = out
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        // bun pm pack prints "pack manifest table" - look for extensions/ token
        .map(l => {
          // Remove ansi, then find extensions/ fragment
          // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence
          const clean = l.replace(/\x1B\[[0-9;]*m/g, '');
          const m = clean.match(/(extensions\/[^\s]+)/);
          return m ? m[1] : null;
        })
        .filter(Boolean);
      if (files.length > 0) return files;
      // Also try direct line contains extensions/
      const alt = out.split('\n').filter(l => l.includes('extensions/'));
      if (alt.length > 0) return alt;
    } catch (e) {
      lastError = e;
    }
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
