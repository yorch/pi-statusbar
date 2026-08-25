/**
 * Async git status with a short TTL cache. Keeps the footer responsive:
 * the first render returns cached/null data and triggers a background fetch;
 * listeners are notified when fresh data lands so the TUI re-renders.
 *
 * One `git status --porcelain=v2 --branch` call supplies branch, upstream,
 * ahead/behind and file counts; stash count, last commit and the remote URL
 * come from cheap sibling calls fetched in parallel.
 */

import { runCmd } from './spawn.ts';

export interface GitStatus {
	branch: string | null;
	upstream: string | null;
	staged: number;
	unstaged: number;
	untracked: number;
	/** number of conflicted (unmerged) entries */
	conflicted: number;
	/** commits ahead of / behind the upstream branch */
	ahead: number;
	behind: number;
	/** number of stash entries */
	stash: number;
	/** `shortSha subject` of HEAD, or null in a repo with no commits */
	lastCommit: string | null;
	/** `host/owner/repo` of the origin remote, e.g. github.com/yorch/pi-statusbar */
	remote: string | null;
	diffAdded: number;
	diffRemoved: number;
	isWorktree: boolean;
	detachedSha: string | null;
}

/** Parse `git status --porcelain=v2 --branch` output (also tolerates v1 file lines). */
export function parseStatusV2(
	output: string,
): Pick<GitStatus, 'branch' | 'upstream' | 'ahead' | 'behind' | 'staged' | 'unstaged' | 'untracked' | 'conflicted'> {
	let branch: string | null = null;
	let upstream: string | null = null;
	let ahead = 0;
	let behind = 0;
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;
	let conflicted = 0;
	for (const line of output.split('\n')) {
		if (line.startsWith('# branch.head ')) {
			const raw = line.slice('# branch.head '.length).trim() || null;
			// detached HEAD yields "(detached)" or "(HEAD detached at …)" — normalize to null
			if (raw && (raw === '(detached)' || raw.startsWith('(HEAD detached'))) {
				branch = null;
			} else {
				branch = raw;
			}
		} else if (line.startsWith('# branch.upstream ')) {
			upstream = line.slice('# branch.upstream '.length).trim() || null;
		} else if (line.startsWith('# branch.ab ')) {
			const m = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
			if (m) {
				ahead = Number(m[1]);
				behind = Number(m[2]);
			}
		} else if (line.trim() && !line.startsWith('#')) {
			const c = countLine(line);
			staged += c.staged;
			unstaged += c.unstaged;
			untracked += c.untracked;
			conflicted += c.conflicted;
		}
	}
	return { branch, upstream, ahead, behind, staged, unstaged, untracked, conflicted };
}

/** Count one status line — v2 (`1 XY …`, `2 XY …`, `u XY …`, `? path`) or v1 (`XY path`, `?? path`).
 * Note the conventions differ: v2 marks unmodified as `.`, v1 as a space. */
function countLine(line: string): {
	staged: number;
	unstaged: number;
	untracked: number;
	conflicted: number;
} {
	if (line.startsWith('??') || line.startsWith('? ')) return { staged: 0, unstaged: 0, untracked: 1, conflicted: 0 };
	if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
		const xy = line.split(' ').at(1) ?? '';
		if (line.startsWith('u ')) {
			return {
				staged: xy[0] !== '.' && xy[0] !== '?' ? 1 : 0,
				unstaged: xy[1] === '.' ? 0 : 1,
				untracked: 0,
				conflicted: 1,
			};
		}
		return {
			staged: xy[0] !== '.' && xy[0] !== '?' ? 1 : 0,
			unstaged: xy[1] === '.' ? 0 : 1,
			untracked: 0,
			conflicted: 0,
		};
	}
	const xy = line.slice(0, 2);
	return {
		staged: xy[0] !== ' ' && xy[0] !== '?' ? 1 : 0,
		unstaged: xy[1] === ' ' ? 0 : 1,
		untracked: 0,
		conflicted: 0,
	};
}

/** Parse `git status --porcelain` (v1) output into staged/unstaged/untracked counts. */
export function parsePorcelain(porcelain: string): Pick<GitStatus, 'staged' | 'unstaged' | 'untracked' | 'conflicted'> {
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;
	let conflicted = 0;
	for (const line of porcelain.split('\n')) {
		if (!line.trim()) continue;
		const c = countLine(line);
		staged += c.staged;
		unstaged += c.unstaged;
		untracked += c.untracked;
		conflicted += c.conflicted;
	}
	return { staged, unstaged, untracked, conflicted };
}

/** Count non-empty lines of `git stash list` output. */
export function countStash(output: string): number {
	let n = 0;
	for (const line of output.split('\n')) {
		if (line.trim()) n++;
	}
	return n;
}

/** Parse `git log -1 --format=%h%x09%s` output into `shortSha subject`, or null. */
export function parseLogLine(output: string): string | null {
	const line = output.trim();
	if (!line) return null;
	const [sha, ...rest] = line.split('\t');
	if (!sha) return null;
	const subject = rest.join('\t').trim();
	return subject ? `${sha} ${subject}` : sha;
}

/**
 * Parse a git remote URL into `host/owner/repo` (`.git` stripped), or null.
 * Handles scp-style (`git@github.com:yorch/repo.git`) and URL-style
 * (`https://`, `ssh://git@`, `git://`) remotes.
 */
export function parseRemoteHost(url: string): string | null {
	const u = url.trim();
	if (!u || /^(\.{0,2}\/|file:)/.test(u)) return null;
	let host = '';
	let path = '';
	if (u.includes('://')) {
		const rest = u.split('://').at(1) ?? '';
		const slash = rest.indexOf('/');
		const hostPart = slash === -1 ? rest : rest.slice(0, slash);
		host = (hostPart.split('@').pop() ?? '').split(':').at(0) ?? '';
		path = slash === -1 ? '' : rest.slice(slash + 1);
	} else if (u.includes('@') && u.includes(':')) {
		const hostPart = u.split('@').at(1) ?? '';
		host = hostPart.split(':').at(0) ?? '';
		path = hostPart.slice(hostPart.indexOf(':') + 1);
	} else {
		return null;
	}
	if (!host) return null;
	path = path.replace(/\/+$/, '').replace(/\.git$/i, '');
	return path ? `${host}/${path}` : host;
}

const TTL_MS = 2000;
const listeners = new Set<() => void>();
const cache = new Map<string, { at: number; status: GitStatus | null }>();
const pending = new Map<string, Promise<GitStatus>>();

export function onGitUpdate(fn: () => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

function runGit(args: string[], cwd: string): Promise<string> {
	return runCmd('git', args, cwd, 5000);
}

export function parseNumstat(output: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of output.split('\n')) {
		if (!line.trim()) continue;
		const parts = line.split(/\s+/);
		const a = parts[0] ?? '';
		const r = parts[1] ?? '';
		if (a === '-' || r === '-') continue;
		const an = Number(a);
		const rn = Number(r);
		if (Number.isFinite(an)) added += an;
		if (Number.isFinite(rn)) removed += rn;
	}
	return { added, removed };
}

async function fetchStatus(cwd: string): Promise<GitStatus> {
	const inside = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
	if (inside !== 'true') {
		return {
			branch: null,
			upstream: null,
			staged: 0,
			unstaged: 0,
			untracked: 0,
			conflicted: 0,
			ahead: 0,
			behind: 0,
			stash: 0,
			lastCommit: null,
			remote: null,
			diffAdded: 0,
			diffRemoved: 0,
			isWorktree: false,
			detachedSha: null,
		};
	}
	const [status, stash, log, remoteUrl, numstat, gitDir, commonDir] = await Promise.all([
		runGit(['status', '--porcelain=v2', '--branch'], cwd),
		runGit(['stash', 'list'], cwd),
		runGit(['log', '-1', '--format=%h%x09%s'], cwd),
		runGit(['config', '--get', 'remote.origin.url'], cwd),
		runGit(['diff', '--numstat'], cwd),
		runGit(['rev-parse', '--git-dir'], cwd),
		runGit(['rev-parse', '--git-common-dir'], cwd),
	]);
	const parsed = parseStatusV2(status);
	const { added, removed } = parseNumstat(numstat);
	const isWorktree = Boolean(gitDir && commonDir && gitDir.trim() !== commonDir.trim());
	let detachedSha: string | null = null;
	if (!parsed.branch) {
		const sha = await runGit(['rev-parse', '--short', 'HEAD'], cwd);
		detachedSha = sha || null;
	}
	return {
		...parsed,
		stash: countStash(stash),
		lastCommit: parseLogLine(log),
		remote: parseRemoteHost(remoteUrl),
		diffAdded: added,
		diffRemoved: removed,
		isWorktree,
		detachedSha,
	};
}

/** Returns cached status (may be null on first call); kicks off a background refresh. */
export function getGitStatus(cwd: string): GitStatus | null {
	const now = Date.now();
	const entry = cache.get(cwd);
	if (entry && entry.status && now - entry.at < TTL_MS) {
		return entry.status;
	}
	refresh(cwd);
	return entry ? entry.status : null;
}

function refresh(cwd: string): void {
	if (pending.has(cwd)) return;
	const promise = fetchStatus(cwd)
		.then((status) => {
			cache.set(cwd, { at: Date.now(), status });
			// LRU eviction when unbounded
			if (cache.size > 8) {
				const first = cache.keys().next().value;
				if (first !== undefined && first !== cwd) cache.delete(first);
			}
			pending.delete(cwd);
			for (const fn of listeners) fn();
			return status;
		})
		.catch(() => {
			pending.delete(cwd);
			return {
				branch: null,
				upstream: null,
				staged: 0,
				unstaged: 0,
				untracked: 0,
				conflicted: 0,
				ahead: 0,
				behind: 0,
				stash: 0,
				lastCommit: null,
				remote: null,
				diffAdded: 0,
				diffRemoved: 0,
				isWorktree: false,
				detachedSha: null,
			};
		});
	pending.set(cwd, promise);
}
