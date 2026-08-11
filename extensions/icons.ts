/**
 * Segment icons — Nerd Font glyphs with ASCII fallback.
 */

export interface IconSet {
	model: string;
	folder: string;
	branch: string;
	tokens: string;
	cost: string;
	time: string;
}

export const NERD: IconSet = {
	model: "\uEC19", // nf-md-chip
	folder: "\uF115", // nf-fa-folder_open
	branch: "\uF126", // nf-fa-code_fork
	tokens: "\uE26B", // nf-seti-html
	cost: "\uF155", // nf-fa-dollar
	time: "\uF017", // nf-fa-clock_o
};

export const ASCII: IconSet = {
	model: "",
	folder: "dir",
	branch: "⎇",
	tokens: "⊛",
	cost: "$",
	time: "◷",
};

export function withIcon(icon: string, text: string): string {
	return icon ? `${icon} ${text}` : text;
}

/**
 * Detect Nerd Font support: explicit env force, Ghostty (survives into tmux),
 * or a known TERM_PROGRAM. Setting `nerd` in settings.json overrides this.
 */
export function hasNerdFonts(): boolean {
	const force = process.env.STATUSBAR_NERD_FONTS;
	if (force === "1") return true;
	if (force === "0") return false;
	if (process.env.GHOSTTY_RESOURCES_DIR) return true;
	const term = (process.env.TERM_PROGRAM ?? "").toLowerCase();
	return ["iterm", "wezterm", "kitty", "ghostty", "alacritty"].some((t) => term.includes(t));
}
