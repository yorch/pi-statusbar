/**
 * Status bar extension — modular segments, presets, rich git, live context.
 *
 * The built-in footer has no theme tokens, so a custom footer is the only way
 * to restyle it. This one renders a row of theme-token-colored segments:
 *
 *   default: ↑1.2k ↓340 W0.5k CH92.1% $0.004 42%/64k · ● working… · ⎇main · tradr · model:high
 *   full (two lines, right-aligned auxiliaries):
 *     ~/code-personal/tradr/ (⎇main ↑2 ↓5 +1) #12 github.com/yorch/tradr     mbp2024.local · ⏱12m · 14:32
 *     ↑1.2k ↓340 W0.5k CH92.1% $0.004 ██████░░░░ 42%/64k ≡1      ● working… · model:high · c921a07 Fix thing
 *
 * Segments (see segments.ts):
 *   tokens  cache  cost  context  diff  statuses  git  pr  stash  commit  remote  path  model  hostname  session  time
 *
 * Presets: minimal | compact | default (1 line) | full (2 lines)
 *   - /statusbar [off|preset]  toggles or switches preset (saved to settings.json)
 *   - /footer is an alias
 *
 * Config in ~/.pi/agent/settings.json:
 *   { "statusbar": { "enabled": true, "preset": "full", "nerd": true, "separator": "dot", "contextBar": true, "pr": true, "contextMode": "percent" } }
 *
 * `enabled: true` installs the footer automatically on session start.
 *
 * `nerd` overrides auto-detection (iTerm/WezTerm/Kitty/Ghostty/Alacritty via
 * TERM_PROGRAM, Ghostty inside tmux via GHOSTTY_RESOURCES_DIR, or
 * STATUSBAR_NERD_FONTS=1/0 to force).
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { getGitStatus, onGitUpdate } from './git-status.ts';
import { ASCII, hasNerdFonts, NERD } from './icons.ts';
import { getPrStatus, onPrUpdate, shouldShowGhHint } from './pr.ts';
import {
	PRESETS,
	type PresetDef,
	type PresetName,
	renderSegments,
	type SegmentContext,
	type UsageTotals,
} from './segments.ts';

export interface StatusBarConfig {
	preset: PresetName;
	/** explicit override; null = auto-detect from the terminal */
	nerd: boolean | null;
	separator: string;
	/** render the progress bar in the context segment (default true) */
	contextBar: boolean;
	/** show the PR segment in presets that include it (default true) */
	pr: boolean;
	/** install the footer automatically on session start (default false) */
	enabled: boolean;
	contextMode?: 'percent' | 'remaining' | 'used';
}

const DEFAULT_CONFIG: StatusBarConfig = {
	preset: 'default',
	nerd: null,
	separator: 'dot',
	contextBar: true,
	pr: true,
	enabled: false,
	contextMode: 'percent',
};

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
}

function settingsPath(): string {
	return join(agentDir(), 'settings.json');
}

function isPreset(s: string): s is PresetName {
	return Object.hasOwn(PRESETS, s);
}

function getPreset(name: string): PresetDef {
	return isPreset(name) ? PRESETS[name] : PRESETS.default;
}

function loadConfig(): StatusBarConfig {
	const cfg = { ...DEFAULT_CONFIG };
	try {
		const file = settingsPath();
		if (!existsSync(file)) return cfg;
		const settings = JSON.parse(readFileSync(file, 'utf8')) as { statusbar?: Partial<StatusBarConfig> };
		const sb = settings.statusbar ?? {};
		if (typeof sb.preset === 'string' && isPreset(sb.preset)) cfg.preset = sb.preset;
		if (typeof sb.nerd === 'boolean') cfg.nerd = sb.nerd;
		if (typeof sb.contextBar === 'boolean') cfg.contextBar = sb.contextBar;
		if (typeof sb.pr === 'boolean') cfg.pr = sb.pr;
		if (typeof sb.enabled === 'boolean') cfg.enabled = sb.enabled;
		if (typeof sb.separator === 'string') {
			if (sb.separator === 'pipe' || sb.separator === 'space' || sb.separator === 'dot')
				cfg.separator = sb.separator;
			else if (sb.separator.length > 0 && sb.separator.length <= 4) cfg.separator = sb.separator;
		}
		if (sb.contextMode === 'remaining' || sb.contextMode === 'used' || sb.contextMode === 'percent')
			cfg.contextMode = sb.contextMode;
	} catch {
		// invalid settings file — fall back to defaults
	}
	return cfg;
}

// Cached config to avoid sync file read on every render
let configCache: { at: number; cfg: StatusBarConfig } | null = null;

function getCachedConfig(): StatusBarConfig {
	const now = Date.now();
	if (configCache && now - configCache.at < 1000) return configCache.cfg;
	const cfg = loadConfig();
	configCache = { at: now, cfg };
	return cfg;
}

function savePreset(preset: PresetName): boolean {
	try {
		const file = settingsPath();
		const settings = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
		let sb = settings.statusbar as Record<string, unknown> | undefined;
		if (!sb || typeof sb !== 'object' || Array.isArray(sb)) sb = {};
		sb.preset = preset;
		settings.statusbar = sb;
		const tmp = `${file}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
		renameSync(tmp, file);
		// invalidate cache
		configCache = null;
		return true;
	} catch {
		return false;
	}
}

let lastBranchLen = -1;
let lastBranchRef: unknown[] | null = null;
let cachedUsage: UsageTotals | null = null;

function sumUsage(ctx: ExtensionContext): UsageTotals {
	const branch = ctx.sessionManager.getBranch();
	// memoize when branch length and reference unchanged
	if (cachedUsage && branch.length === lastBranchLen && lastBranchRef === branch) return cachedUsage;
	// also check last element identity to catch in-place updates
	if (cachedUsage && branch.length === lastBranchLen && lastBranchRef !== branch) {
		// length same but new array instance — recompute
	}
	let input = 0;
	let output = 0;
	let cost = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	for (const e of branch) {
		if (e.type === 'message' && e.message.role === 'assistant') {
			const m = e.message as AssistantMessage;
			input += m.usage.input ?? 0;
			output += m.usage.output ?? 0;
			cost += m.usage.cost?.total ?? 0;
			cacheRead += m.usage.cacheRead ?? 0;
			cacheWrite += m.usage.cacheWrite ?? 0;
		}
	}
	const totals: UsageTotals = { input, output, cost, cacheRead, cacheWrite };
	lastBranchLen = branch.length;
	lastBranchRef = branch;
	cachedUsage = totals;
	return totals;
}

export default function (pi: ExtensionAPI) {
	let enabled = false;
	let sessionStart = Date.now();
	let ghHintShown = false;

	pi.on('session_start', async (_event, ctx) => {
		sessionStart = Date.now();
		// auto-install on load when enabled in settings.json
		if (loadConfig().enabled && !enabled) {
			enabled = true;
			apply(ctx);
		}
	});

	function apply(ctx: ExtensionContext) {
		// TUI-only APIs — skip in print/rpc/json modes
		if (!ctx.hasUI) return;
		const theme = ctx.ui.theme;

		ctx.ui.setWorkingIndicator({
			frames: [theme.fg('dim', '·'), theme.fg('muted', '•'), theme.fg('accent', '●'), theme.fg('muted', '•')],
			intervalMs: 120,
		});

		ctx.ui.setFooter((tui, footerTheme, footerData) => {
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
			const unsubGit = onGitUpdate(() => tui.requestRender());
			const unsubPr = onPrUpdate(() => tui.requestRender());
			// keep the session/clock segments fresh while idle — only when needed
			const needsTimer = (() => {
				const cfg = getCachedConfig();
				const preset = getPreset(cfg.preset);
				const ids = preset.rows.flatMap((r: { left: string[]; right?: string[] }) => [
					...r.left,
					...(r.right ?? []),
				]);
				return ids.includes('time') || ids.includes('session');
			})();
			const timer = needsTimer ? setInterval(() => tui.requestRender(), 30_000) : null;

			return {
				dispose() {
					unsubBranch();
					unsubGit();
					unsubPr();
					if (timer) clearInterval(timer);
				},
				invalidate() {
					// config + theme are re-read on every render
				},
				render(width: number): string[] {
					const current = getCachedConfig();
					const preset = getPreset(current.preset);
					const sepRaw = current.separator;
					const sep =
						sepRaw === 'pipe'
							? ' │ '
							: sepRaw === 'space'
								? '  '
								: sepRaw === 'dot'
									? ' · '
									: ` ${sepRaw} `;
					const c: SegmentContext = {
						ctx,
						theme: footerTheme,
						git: getGitStatus(ctx.cwd),
						pr: getPrStatus(ctx.cwd, footerData.getGitBranch()),
						icons: (current.nerd ?? hasNerdFonts()) ? NERD : ASCII,
						statuses: [...footerData.getExtensionStatuses().values()],
						usage: sumUsage(ctx),
						elapsedMs: Date.now() - sessionStart,
						opts: {
							contextBar: current.contextBar,
							showPr: current.pr,
							contextMode: current.contextMode ?? 'percent',
							...preset.opts,
						},
					};
					if (!ghHintShown && shouldShowGhHint()) {
						ghHintShown = true;
						ctx.ui.notify('PR segment: gh not found or not authed — run gh auth login to enable', 'info');
					}
					// One line per preset row; right-aligned groups pad to the right edge
					const lines: string[] = [];
					for (const row of preset.rows) {
						const leftParts = renderSegments(row.left, c);
						const rightParts = row.right ? renderSegments(row.right, c) : [];
						if (leftParts.length === 0 && rightParts.length === 0) continue;
						const left = leftParts.join(footerTheme.fg('dim', sep));
						let line = left;
						if (rightParts.length > 0) {
							const right = rightParts.join(footerTheme.fg('dim', sep));
							const pad = ' '.repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
							line = left + pad + right;
						}
						lines.push(line);
					}
					return lines.map(line => truncateToWidth(line, width));
				},
			};
		});
	}

	function remove(ctx: ExtensionContext) {
		ctx.ui.setFooter(undefined);
		ctx.ui.setWorkingIndicator();
		ctx.ui.setStatus('tui-status', undefined);
	}

	function handle(args: string, ctx: ExtensionContext) {
		const arg = args.trim().split(/\s+/)[0] ?? '';
		if (arg === 'off' || (arg === '' && enabled)) {
			enabled = false;
			remove(ctx);
			ctx.ui.notify('Status bar off — /statusbar to re-enable', 'info');
			return;
		}
		enabled = true;
		if (arg && isPreset(arg)) {
			if (savePreset(arg)) {
				ctx.ui.notify(`Status bar preset → ${arg} (saved to settings.json)`, 'info');
			} else {
				ctx.ui.notify(`Could not save preset ${arg}`, 'error');
			}
		}
		apply(ctx);
	}

	pi.registerCommand('statusbar', {
		description: 'Toggle the status bar or set a preset. Usage: /statusbar [off|minimal|compact|default|full]',
		handler: async (args, ctx) => {
			handle(args, ctx);
		},
	});

	pi.registerCommand('footer', {
		description: 'Alias for /statusbar',
		handler: async (args, ctx) => {
			handle(args, ctx);
		},
	});

	// Turn progress chip (shown in the footer's status area)
	pi.on('turn_start', async (_event, ctx) => {
		if (!enabled) return;
		const theme = ctx.ui.theme;
		ctx.ui.setStatus('tui-status', theme.fg('accent', '●') + theme.fg('dim', ' working…'));
	});

	pi.on('turn_end', async (_event, ctx) => {
		if (!enabled) return;
		const theme = ctx.ui.theme;
		ctx.ui.setStatus('tui-status', theme.fg('success', '✓') + theme.fg('dim', ' done'));
	});
}
