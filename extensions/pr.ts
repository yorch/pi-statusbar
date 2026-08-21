/**
 * Async pull-request lookup via the GitHub CLI (`gh`), with a long TTL cache +
 * listeners. Mirrors git-status.ts: the first render returns cached/null and
 * triggers a background fetch; listeners fire when fresh data lands so the TUI
 * re-renders. The cache key includes the branch, so a branch change naturally
 * invalidates it.
 *
 * Only GitHub remotes are supported (`gh` is a GitHub tool). No `gh`, a
 * non-GitHub remote, a detached HEAD, or a branch without a PR all resolve to
 * null and the segment renders nothing.
 */

import { spawn } from "node:child_process";

export interface PRInfo {
	number: number;
	url: string;
	title: string;
	state: "OPEN" | "CLOSED" | "MERGED";
	isDraft: boolean;
}

/** Parse `gh pr view --json number,url,title,state,isDraft` stdout. Empty output (no PR) → null. */
export function parsePrView(json: string): PRInfo | null {
	if (!json.trim()) return null;
	try {
		const data = JSON.parse(json) as {
			number?: unknown;
			url?: unknown;
			title?: unknown;
			state?: unknown;
			isDraft?: unknown;
		};
		if (typeof data.number !== "number" || typeof data.url !== "string")
			return null;
		const state =
			data.state === "CLOSED" || data.state === "MERGED" ? data.state : "OPEN";
		return {
			number: data.number,
			url: data.url,
			title: typeof data.title === "string" ? data.title : "",
			state,
			isDraft: data.isDraft === true,
		};
	} catch {
		return null;
	}
}

/** How long PR data stays fresh before a background refetch (network call, so much longer than git). */
const TTL_MS = 5 * 60_000;
const listeners = new Set<() => void>();
let cache: { key: string; at: number; pr: PRInfo | null } | null = null;
let pending: { key: string; promise: Promise<PRInfo | null> } | null = null;

export function onPrUpdate(fn: () => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

function cacheKey(cwd: string, branch: string | null): string {
	return `${cwd}\u0000${branch ?? ""}`;
}

function runGh(cwd: string): Promise<string> {
	return new Promise((resolve) => {
		let settled = false;
		const proc = spawn(
			"gh",
			["pr", "view", "--json", "number,url,title,state,isDraft"],
			{
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let out = "";
		proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
		proc.on("close", (code) => {
			if (settled) return;
			settled = true;
			// gh exits 0 with the "no pull requests found" notice on stderr and empty stdout
			resolve(code === 0 ? out.trim() : "");
		});
		proc.on("error", () => {
			if (settled) return;
			settled = true;
			resolve("");
		});
		setTimeout(() => {
			if (settled) return;
			settled = true;
			try {
				proc.kill();
			} catch {
				// noop
			}
			resolve("");
		}, 5000).unref?.();
	});
}

async function fetchPr(
	cwd: string,
	branch: string | null,
): Promise<PRInfo | null> {
	if (!branch) return null;
	return parsePrView(await runGh(cwd));
}

/** Returns cached PR info (null on first call / no PR); kicks off a background refresh. */
export function getPrStatus(cwd: string, branch: string | null): PRInfo | null {
	const k = cacheKey(cwd, branch);
	const now = Date.now();
	if (cache && cache.key === k && now - cache.at < TTL_MS) {
		return cache.pr;
	}
	refresh(cwd, branch);
	return cache && cache.key === k ? cache.pr : null;
}

function refresh(cwd: string, branch: string | null): void {
	const k = cacheKey(cwd, branch);
	if (pending && pending.key === k) return;
	const promise = fetchPr(cwd, branch)
		.then((pr) => {
			cache = { key: k, at: Date.now(), pr };
			pending = null;
			for (const fn of listeners) fn();
			return pr;
		})
		.catch(() => {
			pending = null;
			return null;
		});
	pending = { key: k, promise };
}
