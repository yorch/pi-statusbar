/**
 * Segment registry + presets. Each segment renders one piece of status data
 * through pi theme tokens, so everything re-skins automatically when the
 * active theme changes (tokyo-night / tokyo-night-day / …).
 */

import { basename } from "node:path";
import { hostname } from "node:os";
import type { ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { estimateTokens, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { GitStatus } from "./git-status.ts";
import type { PRInfo } from "./pr.ts";
import { withIcon, type IconSet } from "./icons.ts";

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
	pathMode?: "basename" | "abbreviated";
	/** Show +staged *unstaged ?untracked counts on the git segment. */
	gitDetail?: boolean;
	/** Render a progress bar in front of the context percentage (default true). */
	contextBar?: boolean;
	/** Bar width in cells (default 10). */
	contextBarWidth?: number;
	/** Hide the PR segment even in presets that include it (default true). */
	showPr?: boolean;
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
	opts: SegmentOptions;
}

export interface Segment {
	id: string;
	render(c: SegmentContext): string;
}

const THINKING_TOKENS: Record<string, ThemeColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
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
const BLOCKS = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"];

export function renderBar(percent: number, width: number): { filled: string; partial: string; empty: string } {
	const cells = Math.max(0, Math.min(width, (percent / 100) * width));
	const full = Math.floor(cells);
	const frac = Math.round((cells - full) * 8);
	const partial = frac > 0 ? BLOCKS[frac - 1] : "";
	const empty = "░".repeat(Math.max(0, width - full - (partial ? 1 : 0)));
	return { filled: "█".repeat(full), partial, empty };
}

// ── Segments ────────────────────────────────────────────────────────────────

const tokensSegment: Segment = {
	id: "tokens",
	render({ theme, usage, icons }) {
		if (usage.input === 0 && usage.output === 0) return "";
		const body = `↑${formatTokens(usage.input)} ↓${formatTokens(usage.output)}`;
		return theme.fg("dim", withIcon(icons.tokens, body));
	},
};

const cacheSegment: Segment = {
	id: "cache",
	render({ theme, usage }) {
		const parts: string[] = [];
		if (usage.cacheWrite > 0) parts.push(`W${formatTokens(usage.cacheWrite)}`);
		if (usage.cacheRead > 0 || usage.cacheWrite > 0) {
			const hit = usage.cacheRead + usage.input > 0 ? (usage.cacheRead / (usage.cacheRead + usage.input)) * 100 : 0;
			parts.push(`CH${hit.toFixed(1)}%`);
		}
		return parts.length > 0 ? theme.fg("dim", parts.join(" ")) : "";
	},
};

const costSegment: Segment = {
	id: "cost",
	render({ theme, usage, icons }) {
		return usage.cost > 0 ? theme.fg("dim", withIcon(icons.cost, `$${usage.cost.toFixed(4)}`)) : "";
	},
};

const contextSegment: Segment = {
	id: "context",
	render({ ctx, theme, opts }) {
		const usage = ctx.getContextUsage();
		let percent: number | null = usage?.percent ?? null;
		const window = usage?.contextWindow;

		// Fallback estimate (e.g. right after compaction) from context entries
		if (percent === null && window) {
			try {
				const entries = ctx.sessionManager.buildContextEntries();
				let tokens = 0;
				for (const entry of entries) {
					for (const m of sessionEntryToContextMessages(entry)) tokens += estimateTokens(m);
				}
				percent = (tokens / window) * 100;
			} catch {
				// keep null
			}
		}

		const windowStr = window ? formatTokens(window) : "?";
		if (percent === null) return theme.fg("dim", `?/${windowStr}`);

		const display = `${Math.round(percent)}%/${windowStr}`;
		const state: ThemeColor = percent > 90 ? "error" : percent > 70 ? "warning" : "accent";
		const textColor: ThemeColor = percent > 90 ? "error" : percent > 70 ? "warning" : "dim";
		let s = theme.fg(textColor, display);

		// Progress bar in front of the percentage (smooth eighth-block gradient)
		if (opts.contextBar !== false) {
			const bar = renderBar(percent, opts.contextBarWidth ?? 10);
			const barStr = theme.fg(state, bar.filled + bar.partial) + theme.fg("dim", bar.empty);
			s = `${barStr} ${s}`;
		}
		return s;
	},
};

const statusesSegment: Segment = {
	id: "statuses",
	render({ theme, statuses }) {
		return statuses.length > 0 ? theme.fg("dim", statuses.join(" · ")) : "";
	},
};

const modelSegment: Segment = {
	id: "model",
	render({ ctx, theme, icons, opts }) {
		const name = ctx.model?.name || ctx.model?.id || "no-model";
		let s = theme.fg("muted", withIcon(icons.model, name));
		const level = ctx.thinkingLevel;
		if (opts.showThinkingLevel !== false && level && level !== "off") {
			s += theme.fg(THINKING_TOKENS[level] ?? "thinkingOff", `:${level}`);
		}
		return s;
	},
};

const pathSegment: Segment = {
	id: "path",
	render({ ctx, theme, icons, opts }) {
		const cwd = ctx.cwd;
		const mode = opts.pathMode ?? "basename";
		let pwd: string;
		if (mode === "abbreviated") {
			const home = process.env.HOME ?? process.env.USERPROFILE;
			let p = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
			// directory indicator: ~/code-personal/tradr/
			if (p !== "/" && !p.endsWith("/")) p = `${p}/`;
			const max = 40;
			pwd = p.length > max ? `…${p.slice(-(max - 1))}` : p;
		} else {
			pwd = basename(cwd) || cwd;
		}
		return theme.fg("accent", withIcon(icons.folder, pwd));
	},
};

const gitSegment: Segment = {
	id: "git",
	render({ theme, git, icons, opts }) {
		if (!git || !git.branch) return "";
		const dirty = git.staged > 0 || git.unstaged > 0 || git.untracked > 0;
		const base = theme.fg(
			dirty ? "warning" : "success",
			withIcon(icons.branch, git.branch),
		);
		const parts: string[] = [];
		// divergence vs upstream (only shown when out of sync)
		if (git.upstream && (git.ahead > 0 || git.behind > 0)) {
			const sync: string[] = [];
			if (git.ahead > 0) sync.push(`↑${git.ahead}`);
			if (git.behind > 0) sync.push(`↓${git.behind}`);
			if (sync.length > 0) parts.push(theme.fg("muted", sync.join(" ")));
		}
		if (opts.gitDetail !== false && dirty) {
			if (git.staged > 0) parts.push(theme.fg("success", `+${git.staged}`));
			if (git.unstaged > 0) parts.push(theme.fg("warning", `*${git.unstaged}`));
			if (git.untracked > 0) parts.push(theme.fg("muted", `?${git.untracked}`));
		}
		return parts.length > 0 ? `${base} ${parts.join(" ")}` : base;
	},
};

const PR_COLORS: Record<string, ThemeColor> = {
	OPEN: "success",
	MERGED: "success",
	CLOSED: "error",
};

const prSegment: Segment = {
	id: "pr",
	render({ theme, pr, icons, opts }) {
		if (opts.showPr === false) return "";
		if (!pr) return "";
		// draft → warning, open/merged → success, closed → error
		const color: ThemeColor = pr.isDraft ? "warning" : (PR_COLORS[pr.state] ?? "success");
		const label = `#${pr.number}`;
		// OSC 8 hyperlink — pi's footer width/truncation strips the escape codes
		const text = pr.url ? `\x1b]8;;${pr.url}\x1b\\${label}\x1b]8;;\x1b\\` : label;
		return theme.fg(color, withIcon(icons.pr, text));
	},
};

const stashSegment: Segment = {
	id: "stash",
	render({ theme, git, icons }) {
		if (!git || git.stash <= 0) return "";
		return theme.fg("muted", withIcon(icons.stash, String(git.stash)));
	},
};

const commitSegment: Segment = {
	id: "commit",
	render({ theme, git, icons }) {
		if (!git || !git.lastCommit) return "";
		const body = git.lastCommit.length > 48 ? `${git.lastCommit.slice(0, 45)}…` : git.lastCommit;
		return theme.fg("dim", withIcon(icons.commit, body));
	},
};

const remoteSegment: Segment = {
	id: "remote",
	render({ theme, git, icons }) {
		if (!git || !git.remote) return "";
		return theme.fg("muted", withIcon(icons.remote, git.remote));
	},
};

const timeSegment: Segment = {
	id: "time",
	render({ theme }) {
		const now = new Date();
		const hh = String(now.getHours()).padStart(2, "0");
		const mm = String(now.getMinutes()).padStart(2, "0");
		return theme.fg("dim", `${hh}:${mm}`);
	},
};

const sessionSegment: Segment = {
	id: "session",
	render({ theme, icons, elapsedMs }) {
		return theme.fg("dim", withIcon(icons.time, formatDuration(elapsedMs)));
	},
};

const hostnameSegment: Segment = {
	id: "hostname",
	render({ theme }) {
		return theme.fg("dim", hostname());
	},
};

// ── Registry + presets ──────────────────────────────────────────────────────

export const SEGMENTS: Record<string, Segment> = {
	tokens: tokensSegment,
	cache: cacheSegment,
	cost: costSegment,
	context: contextSegment,
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
};

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
export const PRESETS: Record<string, PresetDef> = {
	minimal: { rows: [{ left: ["path", "git", "context"] }] },
	compact: { rows: [{ left: ["model", "git", "cost", "context"] }] },
	default: {
		rows: [
			{
				left: ["tokens", "cache", "cost", "context", "statuses", "git", "path", "model"],
				right: ["session"],
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
			{ left: ["path", "git", "pr", "remote"], right: ["hostname", "session", "time"] },
			{ left: ["tokens", "cache", "cost", "context", "stash"], right: ["statuses", "model", "commit"] },
		],
		opts: { pathMode: "abbreviated" },
	},
};

export function renderSegments(ids: string[], c: SegmentContext): string[] {
	const out: string[] = [];
	for (const id of ids) {
		const seg = SEGMENTS[id];
		if (!seg) continue;
		const s = seg.render(c);
		if (s) out.push(s);
	}
	return out;
}
