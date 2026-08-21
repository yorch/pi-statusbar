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
 *   tokens  cache  cost  context  statuses  git  pr  stash  commit  remote  path  model  hostname  session  time
 *
 * Presets: minimal | compact | default (1 line) | full (2 lines)
 *   - /statusbar [off|preset]  toggles or switches preset (saved to settings.json)
 *   - /footer is an alias
 *
 * Config in ~/.pi/agent/settings.json:
 *   { "statusbar": { "enabled": true, "preset": "full", "nerd": true, "separator": "dot", "contextBar": true } }
 *
 * `enabled: true` installs the footer automatically on session start.
 *
 * `nerd` overrides auto-detection (iTerm/WezTerm/Kitty/Ghostty/Alacritty via
 * TERM_PROGRAM, Ghostty inside tmux via GHOSTTY_RESOURCES_DIR, or
 * STATUSBAR_NERD_FONTS=1/0 to force).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getGitStatus, onGitUpdate } from "./git-status.ts";
import { ASCII, hasNerdFonts, NERD } from "./icons.ts";
import { getPrStatus, onPrUpdate } from "./pr.ts";
import { PRESETS, renderSegments, type SegmentContext, type UsageTotals } from "./segments.ts";

export interface StatusBarConfig {
	preset: string;
	/** explicit override; null = auto-detect from the terminal */
	nerd: boolean | null;
	separator: "dot" | "pipe" | "space";
	/** render the progress bar in the context segment (default true) */
	contextBar: boolean;
	/** show the PR segment in presets that include it (default true) */
	pr: boolean;
	/** install the footer automatically on session start (default false) */
	enabled: boolean;
}

const DEFAULT_CONFIG: StatusBarConfig = {
	preset: "default",
	nerd: null,
	separator: "dot",
	contextBar: true,
	pr: true,
	enabled: false,
};

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function settingsPath(): string {
	return join(agentDir(), "settings.json");
}

function loadConfig(): StatusBarConfig {
	const cfg = { ...DEFAULT_CONFIG };
	try {
		const file = settingsPath();
		if (!existsSync(file)) return cfg;
		const settings = JSON.parse(readFileSync(file, "utf8")) as { statusbar?: Partial<StatusBarConfig> };
		const sb = settings.statusbar ?? {};
		if (typeof sb.preset === "string" && sb.preset in PRESETS) cfg.preset = sb.preset;
		if (typeof sb.nerd === "boolean") cfg.nerd = sb.nerd;
		if (typeof sb.contextBar === "boolean") cfg.contextBar = sb.contextBar;
		if (typeof sb.pr === "boolean") cfg.pr = sb.pr;
		if (typeof sb.enabled === "boolean") cfg.enabled = sb.enabled;
		if (sb.separator === "pipe" || sb.separator === "space") cfg.separator = sb.separator;
	} catch {
		// invalid settings file — fall back to defaults
	}
	return cfg;
}

function savePreset(preset: string): boolean {
	try {
		const file = settingsPath();
		const settings = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
		const sb = (settings.statusbar as Record<string, unknown> | undefined) ?? {};
		sb.preset = preset;
		settings.statusbar = sb;
		writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
		return true;
	} catch {
		return false;
	}
}

function sumUsage(ctx: ExtensionContext): UsageTotals {
	let input = 0;
	let output = 0;
	let cost = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	for (const e of ctx.sessionManager.getBranch()) {
		if (e.type === "message" && e.message.role === "assistant") {
			const m = e.message as AssistantMessage;
			input += m.usage.input;
			output += m.usage.output;
			cost += m.usage.cost.total;
			cacheRead += m.usage.cacheRead;
			cacheWrite += m.usage.cacheWrite;
		}
	}
	return { input, output, cost, cacheRead, cacheWrite };
}

export default function (pi: ExtensionAPI) {
	let enabled = false;
	let sessionStart = Date.now();

	pi.on("session_start", async (_event, ctx) => {
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
			frames: [
				theme.fg("dim", "·"),
				theme.fg("muted", "•"),
				theme.fg("accent", "●"),
				theme.fg("muted", "•"),
			],
			intervalMs: 120,
		});

		ctx.ui.setFooter((tui, footerTheme, footerData) => {
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
			const unsubGit = onGitUpdate(() => tui.requestRender());
			const unsubPr = onPrUpdate(() => tui.requestRender());
			// keep the session/clock segments fresh while idle
			const timer = setInterval(() => tui.requestRender(), 30_000);

			return {
				dispose() {
					unsubBranch();
					unsubGit();
					unsubPr();
					clearInterval(timer);
				},
				invalidate() {
					// config + theme are re-read on every render
				},
				render(width: number): string[] {
					const current = loadConfig();
					const preset = PRESETS[current.preset] ?? PRESETS.default;
					const sep =
						current.separator === "pipe" ? " │ " : current.separator === "space" ? "  " : " · ";
					const c: SegmentContext = {
						ctx,
						theme: footerTheme,
						git: getGitStatus(ctx.cwd),
						pr: getPrStatus(ctx.cwd, footerData.getGitBranch()),
						icons: (current.nerd ?? hasNerdFonts()) ? NERD : ASCII,
						statuses: [...footerData.getExtensionStatuses().values()],
						usage: sumUsage(ctx),
						elapsedMs: Date.now() - sessionStart,
						opts: { contextBar: current.contextBar, showPr: current.pr, ...preset.opts },
					};
					// One line per preset row; right-aligned groups pad to the right edge
					const lines: string[] = [];
					for (const row of preset.rows) {
						const leftParts = renderSegments(row.left, c);
						const rightParts = row.right ? renderSegments(row.right, c) : [];
						if (leftParts.length === 0 && rightParts.length === 0) continue;
						const left = leftParts.join(footerTheme.fg("dim", sep));
						let line = left;
						if (rightParts.length > 0) {
							const right = rightParts.join(footerTheme.fg("dim", sep));
							const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
							line = left + pad + right;
						}
						lines.push(line);
					}
					return lines.map((line) => truncateToWidth(line, width));
				},
			};
		});
	}

	function remove(ctx: ExtensionContext) {
		ctx.ui.setFooter(undefined);
		ctx.ui.setWorkingIndicator();
		ctx.ui.setStatus("tui-status", undefined);
	}

	function handle(args: string, ctx: ExtensionContext) {
		const arg = args.trim().split(/\s+/)[0] ?? "";
		if (arg === "off" || (arg === "" && enabled)) {
			enabled = false;
			remove(ctx);
			ctx.ui.notify("Status bar off — /statusbar to re-enable", "info");
			return;
		}
		enabled = true;
		if (arg && arg in PRESETS) {
			if (savePreset(arg)) {
				ctx.ui.notify(`Status bar preset → ${arg} (saved to settings.json)`, "info");
			} else {
				ctx.ui.notify(`Could not save preset ${arg}`, "error");
			}
		}
		apply(ctx);
	}

	pi.registerCommand("statusbar", {
		description: "Toggle the status bar or set a preset. Usage: /statusbar [off|minimal|compact|default|full]",
		handler: async (args, ctx) => {
			handle(args, ctx);
		},
	});

	// Turn progress chip (shown in the footer's status area)
	pi.on("turn_start", async (_event, ctx) => {
		if (!enabled) return;
		const theme = ctx.ui.theme;
		ctx.ui.setStatus("tui-status", theme.fg("accent", "●") + theme.fg("dim", " working…"));
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!enabled) return;
		const theme = ctx.ui.theme;
		ctx.ui.setStatus("tui-status", theme.fg("success", "✓") + theme.fg("dim", " done"));
	});
}
