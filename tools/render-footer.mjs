/**
 * Render the `full` preset footer exactly as pi would, for the preview image.
 *
 * Uses the real segment code (segments.ts) + the real render loop from
 * index.ts's setFooter (replicated below — keep in sync if rows change), with
 * a stub theme that emits truecolor ANSI from the user's active theme file.
 * Output goes to stdout; pipe into tools/paint-preview.py.
 *
 *   node tools/render-footer.mjs ~/.pi/agent/themes/<your-theme>.json <width> | python3 tools/paint-preview.py ~/.pi/agent/themes/<your-theme>.json -o assets/statusbar-preview.png
 *   # e.g. tokyo-night.json; use your active theme file (~/.pi/agent/themes/<theme>.json)
 */

import { readFileSync } from 'node:fs';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { PRESETS, renderSegments } from '../extensions/segments.ts';
import { NERD } from '../extensions/icons.ts';

const themePath = process.argv[2] ?? `${process.env.HOME}/.pi/agent/themes/tokyo-night.json`;
const width = Number(process.argv[3] ?? 110);

// Fixed wall clock so the preview doesn't change with the render time.
const RealDate = globalThis.Date;
class FixedDate extends RealDate {
	constructor(...args) {
		super(...(args.length ? args : [2026, 7, 21, 15, 4]));
	}
}
globalThis.Date = FixedDate;

let theme;
try {
	theme = JSON.parse(readFileSync(themePath, 'utf8'));
} catch {
	console.error(`cannot read theme JSON at ${themePath}`);
	process.exit(1);
}
const varHex = new Map(Object.entries(theme.vars));
const toRgb = (hex) => hex.match(/^#?([0-9a-f]{6})$/i) && [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const tokenRgb = new Map(Object.entries(theme.colors).map(([token, ref]) => [token, toRgb(varHex.get(ref) ?? ref)]));
const stubTheme = {
	fg: (token, text) => {
		const [r, g, b] = tokenRgb.get(token) ?? [192, 202, 245];
		return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
	},
};

const git = {
	branch: 'feature/pr-tracker',
	upstream: 'origin/feature/pr-tracker',
	staged: 1,
	unstaged: 2,
	untracked: 1,
	ahead: 2,
	behind: 5,
	stash: 1,
	lastCommit: 'c921a07 Add CLAUDE.md symlink → AGENTS.md (keep in sync)',
	remote: 'github.com/yorch/pi-statusbar',
};

const c = {
	ctx: {
		cwd: '/Users/yorch/code-personal/pi-statusbar',
		model: { id: 'claude-sonnet-4', name: 'claude-sonnet-4' },
		thinkingLevel: 'high',
		getContextUsage: () => ({ percent: 52, contextWindow: 64_000 }),
	},
	theme: stubTheme,
	git,
	pr: {
		number: 12,
		url: 'https://github.com/yorch/pi-statusbar/pull/12',
		title: 'PR tracker segments',
		state: 'OPEN',
		isDraft: false,
	},
	icons: NERD,
	statuses: ['\x1b[38;2;122;162;247m●\x1b[0m working…'],
	usage: { input: 12_400, output: 1800, cost: 0.0043, cacheRead: 200_000, cacheWrite: 23_000 },
	elapsedMs: 12 * 60_000 + 45_000,
	// fake — never leak the real machine hostname into published assets
	hostname: 'mbp-15.local',
	opts: { contextBar: true, showPr: true, ...PRESETS.full.opts },
};

// Mirrors index.ts's setFooter render loop.
const preset = PRESETS.full;
const sep = stubTheme.fg('dim', ' · ');
const lines = [];
for (const row of preset.rows) {
	const leftParts = renderSegments(row.left, c);
	const rightParts = row.right ? renderSegments(row.right, c) : [];
	if (leftParts.length === 0 && rightParts.length === 0) continue;
	const left = leftParts.join(sep);
	let line = left;
	if (rightParts.length > 0) {
		const right = rightParts.join(sep);
		const pad = ' '.repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
		line = left + pad + right;
	}
	lines.push(line);
}
for (const line of lines.map((l) => truncateToWidth(l, width))) {
	process.stdout.write(`${line}\n`);
}
