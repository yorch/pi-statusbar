/**
 * Async git status with a short TTL cache. Keeps the footer responsive:
 * the first render returns cached/null data and triggers a background fetch;
 * listeners are notified when fresh data lands so the TUI re-renders.
 */

import { spawn } from "node:child_process";

export interface GitStatus {
	branch: string | null;
	staged: number;
	unstaged: number;
	untracked: number;
}

/** Parse `git status --porcelain` output into staged/unstaged/untracked counts. */
export function parsePorcelain(porcelain: string): Pick<GitStatus, "staged" | "unstaged" | "untracked"> {
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;
	for (const line of porcelain.split("\n")) {
		if (!line) continue;
		if (line.startsWith("??")) {
			untracked++;
		} else {
			const xy = line.slice(0, 2);
			if (xy[0] !== " " && xy[0] !== "?") staged++;
			if (xy[1] !== " ") unstaged++;
		}
	}
	return { staged, unstaged, untracked };
}

const TTL_MS = 2000;
const listeners = new Set<() => void>();
let cache: { cwd: string; at: number; status: GitStatus | null } = { cwd: "", at: 0, status: null };
let pending: { cwd: string; promise: Promise<GitStatus> } | null = null;

export function onGitUpdate(fn: () => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

function runGit(args: string[], cwd: string): Promise<string> {
	return new Promise((resolve) => {
		let settled = false;
		const proc = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
		proc.on("close", (code) => {
			if (settled) return;
			settled = true;
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

async function fetchStatus(cwd: string): Promise<GitStatus> {
	const [branch, porcelain] = await Promise.all([
		runGit(["branch", "--show-current"], cwd),
		runGit(["status", "--porcelain"], cwd),
	]);
	return { branch: branch || null, ...parsePorcelain(porcelain) };
}

/** Returns cached status (may be null on first call); kicks off a background refresh. */
export function getGitStatus(cwd: string): GitStatus | null {
	const now = Date.now();
	if (cache.cwd === cwd && cache.status && now - cache.at < TTL_MS) {
		return cache.status;
	}
	refresh(cwd);
	return cache.cwd === cwd ? cache.status : null;
}

function refresh(cwd: string): void {
	if (pending && pending.cwd === cwd) return;
	const promise = fetchStatus(cwd)
		.then((status) => {
			cache = { cwd, at: Date.now(), status };
			pending = null;
			for (const fn of listeners) fn();
			return status;
		})
		.catch(() => {
			pending = null;
			return { branch: null, staged: 0, unstaged: 0, untracked: 0 };
		});
	pending = { cwd, promise };
}
