/**
 * Async pull-request lookup via the GitHub CLI (`gh`), with a long TTL cache +
 * listeners. Mirrors git-status.ts: the first render returns cached/null and
 * triggers a background fetch; listeners fire when fresh data lands so the TUI
 * re-renders. The cache key includes the branch, so a branch change naturally
 * invalidates it.
 *
 * Only GitHub remotes are supported (`gh` is a GitHub tool): the remote's host
 * is checked before spawning gh, so GitLab/Bitbucket/self-hosted forges and
 * bare (or non-) repos never invoke it. No `gh`, a non-GitHub remote, a
 * detached HEAD, or a branch without a PR all resolve to null and the segment
 * renders nothing.
 */

import { parseRemoteHost } from './git-status.ts';
import { runCmd } from './spawn.ts';

export interface PRInfo {
	number: number;
	url: string;
	title: string;
	state: 'OPEN' | 'CLOSED' | 'MERGED';
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
		if (typeof data.number !== 'number' || typeof data.url !== 'string') return null;
		const state = data.state === 'CLOSED' || data.state === 'MERGED' ? data.state : 'OPEN';
		return {
			number: data.number,
			url: data.url,
			title: typeof data.title === 'string' ? data.title : '',
			state,
			isDraft: data.isDraft === true,
		};
	} catch {
		return null;
	}
}

/**
 * `gh` resolves the API host from the git remote — only GitHub hosts are worth
 * querying. github.com and GitHub Enterprise hosts (`ghe.github.com`, …) match;
 * a self-hosted forge with a neutral hostname loses the PR segment (extend the
 * predicate to allow it). The substring check can false-positive on a hostname
 * that merely contains "github" — harmless: the gh spawn then fails fast and
 * resolves to null.
 */
export function isGitHubHost(host: string): boolean {
	return host.includes('github');
}

/**
 * True if any configured remote is a GitHub host. Parses
 * `git config --get-regexp '^remote\..*\.url$'` output (one `key url` per
 * line). Checks ALL remotes, not just `origin`, because fork workflows often
 * keep origin = personal fork and upstream = canonical repo.
 */
export function hasGitHubRemote(remoteConfigLines: string): boolean {
	return remoteConfigLines.split('\n').some(line => {
		const url = line.trim().split(/\s+/).at(1) ?? '';
		const host = parseRemoteHost(url)?.split('/').at(0) ?? '';
		return isGitHubHost(host);
	});
}

/** How long PR data stays fresh before a background refetch (network call, so much longer than git). */
const TTL_MS = 5 * 60_000;
const listeners = new Set<() => void>();
const cache = new Map<string, { at: number; pr: PRInfo | null }>();
const pending = new Map<string, Promise<PRInfo | null>>();

export function onPrUpdate(fn: () => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

function cacheKey(cwd: string, branch: string | null): string {
	return `${cwd}\u0000${branch ?? ''}`;
}

function run(cmd: string, args: string[], cwd: string): Promise<string> {
	return runCmd(cmd, args, cwd, 5000);
}

let ghHintNeeded = false;

export function shouldShowGhHint(): boolean {
	if (ghHintNeeded) {
		ghHintNeeded = false;
		return true;
	}
	return false;
}

async function fetchPr(cwd: string, branch: string | null): Promise<PRInfo | null> {
	if (!branch) return null;
	// gh resolves the repo from any configured remote, so check all of them.
	// Deliberately not reusing git-status's cached remote: getGitStatus()
	// returns null on a cold cache (first render) — the gate must not skip gh
	// just because the git cache hasn't landed yet.
	const remotes = await run('git', ['config', '--get-regexp', '^remote..*.url$'], cwd);
	if (!hasGitHubRemote(remotes)) return null;
	const raw = await run('gh', ['pr', 'view', '--json', 'number,url,title,state,isDraft'], cwd);
	const pr = parsePrView(raw);
	// only hint on gh failure (raw ''), not valid "no PR" — still overfires on empty JSON, throttled once
	if (!pr && raw === '') ghHintNeeded = true;
	return pr;
}

/** Returns cached PR info (null on first call / no PR); kicks off a background refresh. */
export function getPrStatus(cwd: string, branch: string | null): PRInfo | null {
	const k = cacheKey(cwd, branch);
	const now = Date.now();
	const entry = cache.get(k);
	if (entry && now - entry.at < TTL_MS) {
		return entry.pr;
	}
	refresh(cwd, branch);
	return entry ? entry.pr : null;
}

function refresh(cwd: string, branch: string | null): void {
	const k = cacheKey(cwd, branch);
	if (pending.has(k)) return;
	const promise = fetchPr(cwd, branch)
		.then(pr => {
			cache.set(k, { at: Date.now(), pr });
			if (cache.size > 16) {
				const first = cache.keys().next().value;
				if (first !== undefined && first !== k) cache.delete(first);
			}
			pending.delete(k);
			for (const fn of listeners) fn();
			return pr;
		})
		.catch(() => {
			pending.delete(k);
			return null;
		});
	pending.set(k, promise);
}
