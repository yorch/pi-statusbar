/**
 * Segment registry + presets. Each segment renders one piece of status data
 * through pi theme tokens, so everything re-skins automatically when the
 * active theme changes (tokyo-night / tokyo-night-day / …).
 */

import { hostname as osHostname } from 'node:os';
import { basename } from 'node:path';
import type { ExtensionContext, Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import { estimateTokens, sessionEntryToContextMessages } from '@earendil-works/pi-coding-agent';
import type { GitStatus } from './git-status.ts';
import { type IconSet, withIcon } from './icons.ts';
import type { PRInfo } from './pr.ts';

export interface UsageTotals {
	input: number;
	output: number;
	cost: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface SegmentOptions {
	/** Show the :thinking-level badge on the model segment. */
	showThinkingLevel?: boolean;
	/** "basename" shows the last path component, "abbreviated" trims the middle. */
	pathMode?: 'basename' | 'abbreviated';
	/** Show +staged *unstaged ?untracked counts on the git segment. */
	gitDetail?: boolean;
	/** Render a progress bar in front of the context percentage (default true). */
	contextBar?: boolean;
	/** Bar width in cells (default 10). */
	contextBarWidth?: number;
	/** Hide the PR segment even in presets that include it (default true). */
	showPr?: boolean;
	/** Context display mode. */
	contextMode?: 'percent' | 'remaining' | 'used';
	/** Show diff stat segment (default true). */
	showDiff?: boolean;
}

export interface SegmentContext {
	ctx: ExtensionContext;
	theme: Theme;
	git: GitStatus | null;
	pr: PRInfo | null;
	icons: IconSet;
	statuses: string[];
	usage: UsageTotals;
	/** ms since the current session started */
	elapsedMs: number;
	/** override for the machine name (hostnameSegment) — used by the preview generator */
	hostname?: string;
	opts: SegmentOptions;
}

export interface Segment {
	id: string;
	render(c: SegmentContext): string;
}

export type ThinkingLevel = NonNullable<ExtensionContext['thinkingLevel']>;
const THINKING_TOKENS: Record<ThinkingLevel, ThemeColor> = {
	off: 'thinkingOff',
	minimal: 'thinkingMinimal',
	low: 'thinkingLow',
	medium: 'thinkingMedium',
	high: 'thinkingHigh',
	xhigh: 'thinkingXhigh',
	max: 'thinkingMax',
};

export function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

export function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m${seconds % 60}s`;
	return `${seconds}s`;
}

// Eighth-block fillers for a smooth gradient bar (▏▎▍▌▋▊▉) + █ full + ░ empty
const BLOCKS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉'];

export function renderBar(percent: number, width: number): { filled: string; partial: string; empty: string } {
	const cells = Math.max(0, Math.min(width, (percent / 100) * width));
	let full = Math.floor(cells);
	let frac = Math.round((cells - full) * 8);
	if (frac === 8) {
		full += 1;
		frac = 0;
	}
	const partial = frac > 0 ? (BLOCKS[frac - 1] ?? '') : '';
	const empty = '░'.repeat(Math.max(0, width - full - (partial ? 1 : 0)));
	return { filled: '█'.repeat(full), partial, empty };
}

// ── Segments ────────────────────────────────────────────────────────────────

const tokensSegment: Segment = {
	id: 'tokens',
	render({ theme, usage, icons, elapsedMs }) {
		if (usage.input === 0 && usage.output === 0) return '';
		let body = `↑${formatTokens(usage.input)} ↓${formatTokens(usage.output)}`;
		if (elapsedMs > 60_000) {
			const total = usage.input + usage.output;
			if (total > 0) {
				const perMin = Math.round(total / (elapsedMs / 60000));
				body += ` ${formatTokens(perMin)}/min`;
			}
		}
		return theme.fg('dim', withIcon(icons.tokens, body));
	},
};

const cacheSegment: Segment = {
	id: 'cache',
	render({ theme, usage }) {
		const parts: string[] = [];
		if (usage.cacheWrite > 0) parts.push(`W${formatTokens(usage.cacheWrite)}`);
		if (usage.cacheRead > 0 || usage.cacheWrite > 0) {
			const hit =
				usage.cacheRead + usage.input > 0 ? (usage.cacheRead / (usage.cacheRead + usage.input)) * 100 : 0;
			parts.push(`CH${hit.toFixed(1)}%`);
		}
		return parts.length > 0 ? theme.fg('dim', parts.join(' ')) : '';
	},
};

const costSegment: Segment = {
	id: 'cost',
	render({ theme, usage, icons }) {
		if (usage.cost <= 0) return '';
		let formatted: string;
		if (usage.cost >= 10) formatted = usage.cost.toFixed(2);
		else if (usage.cost >= 1) formatted = usage.cost.toFixed(3);
		else formatted = usage.cost.toFixed(4);
		return theme.fg('dim', withIcon(icons.cost, `$${formatted}`));
	},
};

// Memoization for context estimator fallback
let lastEntryCount = -1;
let lastEstimatedPercent: number | null = null;
let lastEstimateAt = 0;

const contextSegment: Segment = {
	id: 'context',
	render({ ctx, theme, opts }) {
		const usage = ctx.getContextUsage();
		let percent: number | null = usage?.percent ?? null;
		const window = usage?.contextWindow;

		// Fallback estimate (e.g. right after compaction) from context entries
		if (percent === null && window && window > 0) {
			try {
				const now = Date.now();
				const entries = ctx.sessionManager.buildContextEntries();
				const count = entries.length;
				if (count !== lastEntryCount || now - lastEstimateAt > 1000 || lastEstimatedPercent === null) {
					let tokens = 0;
					for (const entry of entries) {
						for (const m of sessionEntryToContextMessages(entry)) tokens += estimateTokens(m);
					}
					lastEstimatedPercent = (tokens / window) * 100;
					lastEntryCount = count;
					lastEstimateAt = now;
				}
				percent = lastEstimatedPercent;
			} catch {
				// keep null
			}
		}

		const windowStr = window && window > 0 ? formatTokens(window) : '?';
		if (percent === null || !Number.isFinite(percent)) return theme.fg('dim', `?/${windowStr}`);

		let display: string;
		const mode = opts.contextMode ?? 'percent';
		if (mode === 'remaining' && window && window > 0) {
			const tokens = (percent / 100) * window;
			const remaining = Math.max(0, window - tokens);
			display = `${formatTokens(Math.round(remaining))} left/${windowStr}`;
		} else if (mode === 'used' && window && window > 0) {
			const tokens = (percent / 100) * window;
			display = `${formatTokens(Math.round(tokens))}/${windowStr}`;
		} else {
			display = `${Math.round(percent)}%/${windowStr}`;
		}
		const state: ThemeColor = percent > 90 ? 'error' : percent > 70 ? 'warning' : 'accent';
		const textColor: ThemeColor = percent > 90 ? 'error' : percent > 70 ? 'warning' : 'dim';
		let s = theme.fg(textColor, display);

		// Progress bar in front of the percentage (smooth eighth-block gradient)
		if (opts.contextBar !== false) {
			const bar = renderBar(percent, opts.contextBarWidth ?? 10);
			const barStr = theme.fg(state, bar.filled + bar.partial) + theme.fg('dim', bar.empty);
			s = `${barStr} ${s}`;
		}
		return s;
	},
};

const statusesSegment: Segment = {
	id: 'statuses',
	render({ theme, statuses }) {
		return statuses.length > 0 ? theme.fg('dim', statuses.join(' · ')) : '';
	},
};

const modelSegment: Segment = {
	id: 'model',
	render({ ctx, theme, icons, opts }) {
		const name = ctx.model?.name || ctx.model?.id || 'no-model';
		let s = theme.fg('muted', withIcon(icons.model, name));
		const level = ctx.thinkingLevel;
		if (opts.showThinkingLevel !== false && level && level !== 'off') {
			const token: ThemeColor = (THINKING_TOKENS as Record<string, ThemeColor>)[level] ?? 'thinkingOff';
			s += theme.fg(token, `:${level}`);
		}
		return s;
	},
};

const pathSegment: Segment = {
	id: 'path',
	render({ ctx, theme, icons, opts }) {
		const cwd = ctx.cwd;
		const mode = opts.pathMode ?? 'basename';
		let pwd: string;
		if (mode === 'abbreviated') {
			const home = process.env.HOME ?? process.env.USERPROFILE;
			let p = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
			// directory indicator: ~/code-personal/tradr/
			if (p !== '/' && !p.endsWith('/')) p = `${p}/`;
			const max = 40;
			// TODO: width-aware truncation (visibleWidth) for wide unicode
			pwd = p.length > max ? `…${p.slice(-(max - 1))}` : p;
		} else {
			pwd = basename(cwd) || cwd;
		}
		return theme.fg('accent', withIcon(icons.folder, pwd));
	},
};

const gitSegment: Segment = {
	id: 'git',
	render({ theme, git, icons, opts }) {
		if (!git || (!git.branch && !git.detachedSha)) return '';
		const branchName = git.branch ?? `detached@${git.detachedSha ?? ''}`;
		const dirty = git.staged > 0 || git.unstaged > 0 || git.untracked > 0 || git.conflicted > 0;
		const base = theme.fg(dirty ? 'warning' : 'success', withIcon(icons.branch, branchName));
		const parts: string[] = [];
		if (git.isWorktree) parts.push(theme.fg('muted', '⁺'));
		// conflicted indicator
		if (git.conflicted > 0) parts.push(theme.fg('error', `⚑${git.conflicted}`));
		// divergence vs upstream (only shown when out of sync)
		if (git.upstream && (git.ahead > 0 || git.behind > 0)) {
			const sync: string[] = [];
			if (git.ahead > 0) sync.push(`↑${git.ahead}`);
			if (git.behind > 0) sync.push(`↓${git.behind}`);
			if (sync.length > 0) parts.push(theme.fg('muted', sync.join(' ')));
		}
		if (opts.gitDetail !== false && dirty) {
			if (git.staged > 0) parts.push(theme.fg('success', `+${git.staged}`));
			if (git.unstaged > 0) parts.push(theme.fg('warning', `*${git.unstaged}`));
			if (git.untracked > 0) parts.push(theme.fg('muted', `?${git.untracked}`));
		}
		return parts.length > 0 ? `${base} ${parts.join(' ')}` : base;
	},
};

const diffSegment: Segment = {
	id: 'diff',
	render({ theme, git, opts }) {
		if (opts.showDiff === false) return '';
		if (!git || (git.diffAdded === 0 && git.diffRemoved === 0)) return '';
		return theme.fg('muted', `+${git.diffAdded} -${git.diffRemoved}`);
	},
};

const PR_COLORS: Record<PRInfo['state'], ThemeColor> = {
	OPEN: 'success',
	MERGED: 'success',
	CLOSED: 'error',
};

const prSegment: Segment = {
	id: 'pr',
	render({ theme, pr, icons, opts }) {
		if (opts.showPr === false) return '';
		if (!pr) return '';
		// draft → warning, open/merged → success, closed → error
		const color: ThemeColor = pr.isDraft ? 'warning' : (PR_COLORS[pr.state] ?? 'success');
		const label = `#${pr.number}`;
		// OSC 8 hyperlink — pi's footer width/truncation strips the escape codes
		const text = pr.url ? `\x1b]8;;${pr.url}\x1b\\${label}\x1b]8;;\x1b\\` : label;
		return theme.fg(color, withIcon(icons.pr, text));
	},
};

const stashSegment: Segment = {
	id: 'stash',
	render({ theme, git, icons }) {
		if (!git || git.stash <= 0) return '';
		return theme.fg('muted', withIcon(icons.stash, String(git.stash)));
	},
};

const commitSegment: Segment = {
	id: 'commit',
	render({ theme, git, icons }) {
		if (!git || !git.lastCommit) return '';
		const body = git.lastCommit.length > 48 ? `${git.lastCommit.slice(0, 45)}…` : git.lastCommit;
		return theme.fg('dim', withIcon(icons.commit, body));
	},
};

const remoteSegment: Segment = {
	id: 'remote',
	render({ theme, git, icons }) {
		if (!git || !git.remote) return '';
		return theme.fg('muted', withIcon(icons.remote, git.remote));
	},
};

const timeSegment: Segment = {
	id: 'time',
	render({ theme }) {
		const now = new Date();
		const hh = String(now.getHours()).padStart(2, '0');
		const mm = String(now.getMinutes()).padStart(2, '0');
		return theme.fg('dim', `${hh}:${mm}`);
	},
};

const sessionSegment: Segment = {
	id: 'session',
	render({ theme, icons, elapsedMs }) {
		return theme.fg('dim', withIcon(icons.time, formatDuration(elapsedMs)));
	},
};

const hostnameSegment: Segment = {
	id: 'hostname',
	render({ theme, hostname }) {
		return theme.fg('dim', hostname ?? osHostname());
	},
};

// ── Registry + presets ──────────────────────────────────────────────────────

export const SEGMENTS = {
	tokens: tokensSegment,
	cache: cacheSegment,
	cost: costSegment,
	context: contextSegment,
	diff: diffSegment,
	statuses: statusesSegment,
	model: modelSegment,
	path: pathSegment,
	git: gitSegment,
	pr: prSegment,
	stash: stashSegment,
	commit: commitSegment,
	remote: remoteSegment,
	time: timeSegment,
	session: sessionSegment,
	hostname: hostnameSegment,
} satisfies Record<string, Segment>;

export type SegmentId = keyof typeof SEGMENTS;

// Rows are footer lines; each row can left-align and right-align segments.
export interface Row {
	left: string[];
	right?: string[];
}

export interface PresetDef {
	rows: Row[];
	opts?: SegmentOptions;
}

// Presets — one row = one footer line.
export const PRESETS = {
	minimal: { rows: [{ left: ['path', 'git', 'context'] }] },
	compact: { rows: [{ left: ['model', 'git', 'cost', 'context'] }] },
	default: {
		rows: [
			{
				left: ['tokens', 'cache', 'cost', 'context', 'diff', 'statuses', 'git', 'path', 'model'],
				right: ['session'],
			},
		],
	},
	// `full` is the two-line layout: identity row + telemetry row. Each row
	// splits left essentials from right-aligned auxiliaries (which truncate
	// first on narrow terminals). Row 1 carries repo identity (path/branch/PR/
	// remote), row 2 carries telemetry + stash; the long `commit` breadcrumb
	// sits at the far right so it yields first when space runs out.
	full: {
		rows: [
			{ left: ['path', 'git', 'pr', 'remote'], right: ['hostname', 'session', 'time'] },
			{ left: ['tokens', 'cache', 'cost', 'context', 'diff', 'stash'], right: ['statuses', 'model', 'commit'] },
		],
		opts: { pathMode: 'abbreviated' },
	},
} satisfies Record<string, PresetDef>;

export type PresetName = keyof typeof PRESETS;

export function renderSegments(ids: string[], c: SegmentContext): string[] {
	const out: string[] = [];
	for (const id of ids) {
		const seg = (SEGMENTS as Record<string, Segment>)[id];
		if (!seg) continue;
		const s = seg.render(c);
		if (s) out.push(s);
	}
	return out;
}
