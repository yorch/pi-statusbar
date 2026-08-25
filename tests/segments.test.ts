import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTokens, PRESETS, renderBar, SEGMENTS } from '../extensions/segments.ts';
import { createSegmentContext, makeGit, makePr } from './helpers.ts';

test('formatTokens scales', () => {
	assert.equal(formatTokens(0), '0');
	assert.equal(formatTokens(999), '999');
	assert.equal(formatTokens(1234), '1.2k');
	assert.equal(formatTokens(45000), '45k');
	assert.equal(formatTokens(1_200_000), '1.2M');
	assert.equal(formatTokens(45_000_000), '45M');
});

test('renderBar gradient stays within width', () => {
	assert.deepEqual(renderBar(0, 10), { filled: '', partial: '', empty: '░░░░░░░░░░' });
	assert.deepEqual(renderBar(100, 10), { filled: '██████████', partial: '', empty: '' });
	for (const p of [1, 5, 25, 42, 66, 88]) {
		const b = renderBar(p, 10);
		assert.equal((b.filled + b.partial + b.empty).length, 10, `width invariant at ${p}%`);
	}
});

test('renderBar handles out-of-range percent', () => {
	assert.equal((renderBar(-10, 10).filled + renderBar(-10, 10).partial).length, 0);
	assert.equal(renderBar(150, 10).filled.length, 10);
});

test('renderBar carry when frac === 8', () => {
	// 94.9% with width 10 previously gave width 9 due to frac 8; now invariant
	for (const p of [94.9, 95, 99.9]) {
		const b = renderBar(p, 10);
		assert.equal((b.filled + b.partial + b.empty).length, 10, `carry invariant at ${p}%`);
	}
});

test('every preset segment id resolves to a segment', () => {
	for (const [name, def] of Object.entries(PRESETS)) {
		for (const row of def.rows) {
			for (const id of [...row.left, ...(row.right ?? [])]) {
				assert.ok(
					(SEGMENTS as Record<string, unknown>)[id],
					`preset "${name}" references unknown segment "${id}"`,
				);
			}
		}
	}
});

test('default and full presets have expected rows', () => {
	const def = PRESETS.default;
	assert.equal(def.rows.length, 1);
	assert.ok(def.rows[0].left.includes('context'));
	assert.ok(def.rows[0].right?.includes('session'));

	const full = PRESETS.full;
	assert.equal(full.rows.length, 2);
	assert.ok(full.rows[1].right?.includes('model'));
	assert.equal(full.opts?.pathMode, 'abbreviated');
});

test('full preset carries repo identity and new info segments', () => {
	const full = PRESETS.full;
	assert.ok(full.rows[0].left.includes('pr'));
	assert.ok(full.rows[0].left.includes('remote'));
	assert.ok(full.rows[1].left.includes('stash'));
	assert.ok(full.rows[1].right?.includes('commit'));
});

// ── Segment renderers ───────────────────────────────────────────────────────

test('tokens segment empty vs populated', () => {
	const empty = (SEGMENTS.tokens as unknown as { render(c: unknown): string }).render(
		createSegmentContext({
			usage: { input: 0, output: 0, cost: 0, cacheRead: 0, cacheWrite: 0 },
		}) as unknown as never,
	);
	assert.equal(empty, '');
	const s = SEGMENTS.tokens.render(
		createSegmentContext({ usage: { input: 12400, output: 340, cost: 0, cacheRead: 0, cacheWrite: 0 } }),
	);
	assert.ok(s.includes('↑'), 'contains up arrow');
	assert.ok(s.includes('↓'), 'contains down arrow');
	assert.ok(s.includes('[dim]'), 'uses dim token');
});

test('cache segment empty vs hit calc', () => {
	const empty = SEGMENTS.cache.render(
		createSegmentContext({ usage: { input: 0, output: 0, cost: 0, cacheRead: 0, cacheWrite: 0 } }),
	);
	assert.equal(empty, '');
	const s = SEGMENTS.cache.render(
		createSegmentContext({ usage: { input: 1000, output: 0, cost: 0, cacheRead: 2000, cacheWrite: 500 } }),
	);
	assert.ok(s.includes('W'), 'contains write');
	assert.ok(s.includes('CH'), 'contains hit rate');
	assert.ok(s.includes('[dim]'), 'dim');
	// when only write, still shows CH
	const onlyWrite = SEGMENTS.cache.render(
		createSegmentContext({ usage: { input: 0, output: 0, cost: 0, cacheRead: 0, cacheWrite: 1000 } }),
	);
	assert.ok(onlyWrite.includes('CH'));
});

test('cost segment hidden when 0', () => {
	const empty = SEGMENTS.cost.render(
		createSegmentContext({ usage: { input: 0, output: 0, cost: 0, cacheRead: 0, cacheWrite: 0 } }),
	);
	assert.equal(empty, '');
	const s = SEGMENTS.cost.render(
		createSegmentContext({ usage: { input: 0, output: 0, cost: 0.0043, cacheRead: 0, cacheWrite: 0 } }),
	);
	assert.ok(s.includes('$'), 'cost contains $');
	assert.ok(s.includes('[dim]'), 'dim');
});

test('context segment fallback and thresholds', () => {
	// null usage → ?/? with dim
	const fallback = SEGMENTS.context.render(
		createSegmentContext({
			ctxOverrides: {
				getContextUsage: () =>
					null as unknown as ReturnType<
						import('@earendil-works/pi-coding-agent').ExtensionContext['getContextUsage']
					>,
			},
		}),
	);
	assert.ok(fallback.includes('?'), 'fallback shows ?');
	assert.ok(fallback.includes('[dim]'), 'fallback dim');

	// percent 50 → dim/accent, 75 → warning, 95 → error
	const mk = (percent: number, window: number) =>
		createSegmentContext({
			ctxOverrides: {
				getContextUsage: () =>
					({ percent, contextWindow: window }) as unknown as ReturnType<
						import('@earendil-works/pi-coding-agent').ExtensionContext['getContextUsage']
					>,
			},
		});
	const low = SEGMENTS.context.render(mk(50, 64000));
	assert.ok(low.includes('50%'), '50% display');
	assert.ok(low.includes('[accent]') || low.includes('[dim]'), 'low uses accent/dim bar');
	const mid = SEGMENTS.context.render(mk(75, 64000));
	assert.ok(mid.includes('[warning]'), '75% warning');
	const high = SEGMENTS.context.render(mk(95, 64000));
	assert.ok(high.includes('[error]'), '95% error');

	// window 0 guard → ?/? not Infinity
	const zero = SEGMENTS.context.render(mk(50, 0));
	assert.ok(zero.includes('?'), 'window 0 shows ?');

	// bar off via opts.contextBar false
	const noBar = SEGMENTS.context.render(
		createSegmentContext({
			opts: { contextBar: false },
			ctxOverrides: {
				getContextUsage: () =>
					({ percent: 42, contextWindow: 64000 }) as unknown as ReturnType<
						import('@earendil-works/pi-coding-agent').ExtensionContext['getContextUsage']
					>,
			},
		}),
	);
	assert.ok(noBar.includes('42%'), '42% without bar');
	assert.ok(!noBar.includes('░'), 'no bar glyph when contextBar false');
});

test('git segment clean vs dirty and upstream', () => {
	const none = SEGMENTS.git.render(createSegmentContext({ git: null }));
	assert.equal(none, '');
	const noBranch = SEGMENTS.git.render(createSegmentContext({ git: makeGit({ branch: null }) }));
	assert.equal(noBranch, '');
	const clean = SEGMENTS.git.render(
		createSegmentContext({ git: makeGit({ branch: 'main', staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }) }),
	);
	assert.ok(clean.includes('main'), 'branch name');
	assert.ok(clean.includes('[success]'), 'clean success');
	const dirty = SEGMENTS.git.render(
		createSegmentContext({ git: makeGit({ branch: 'feat', staged: 1, unstaged: 2 }) }),
	);
	assert.ok(dirty.includes('[warning]'), 'dirty warning');
	assert.ok(dirty.includes('+1'), 'staged +');
	assert.ok(dirty.includes('*2'), 'unstaged *');
	const ahead = SEGMENTS.git.render(
		createSegmentContext({ git: makeGit({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 }) }),
	);
	assert.ok(ahead.includes('↑2'), 'ahead');
	assert.ok(ahead.includes('↓1'), 'behind');
	const conflicted = SEGMENTS.git.render(createSegmentContext({ git: makeGit({ branch: 'main', conflicted: 2 }) }));
	assert.ok(conflicted.includes('⚑'), 'conflicted indicator');
	assert.ok(conflicted.includes('[error]'), 'conflicted error color');
	const noDetail = SEGMENTS.git.render(
		createSegmentContext({ git: makeGit({ branch: 'main', staged: 2 }), opts: { gitDetail: false } }),
	);
	assert.ok(!noDetail.includes('+2'), 'gitDetail false hides +');
});

test('pr segment hidden, draft, hyperlink and closed', () => {
	const empty = SEGMENTS.pr.render(createSegmentContext({ pr: null }));
	assert.equal(empty, '');
	const hidden = SEGMENTS.pr.render(createSegmentContext({ pr: makePr(), opts: { showPr: false } }));
	assert.equal(hidden, '');
	const draft = SEGMENTS.pr.render(createSegmentContext({ pr: makePr({ isDraft: true, state: 'OPEN' }) }));
	assert.ok(draft.includes('[warning]'), 'draft warning');
	assert.ok(draft.includes('#12'), 'number');
	const open = SEGMENTS.pr.render(createSegmentContext({ pr: makePr({ state: 'OPEN', isDraft: false }) }));
	assert.ok(open.includes('[success]'), 'open success');
	assert.ok(open.includes('\x1b]8;;'), 'OSC 8 hyperlink');
	const closed = SEGMENTS.pr.render(createSegmentContext({ pr: makePr({ state: 'CLOSED' }) }));
	assert.ok(closed.includes('[error]'), 'closed error');
});

test('path segment basename vs abbreviated', () => {
	const base = SEGMENTS.path.render(
		createSegmentContext({
			ctxOverrides: { cwd: '/Users/yorch/code-personal/pi-statusbar' } as unknown as Partial<
				import('@earendil-works/pi-coding-agent').ExtensionContext
			>,
		}),
	);
	assert.ok(base.includes('pi-statusbar') || base.includes('dir'), 'basename contains folder');
	// abbreviated mode should use ~/ and trailing /
	const abbr = SEGMENTS.path.render(
		createSegmentContext({
			opts: { pathMode: 'abbreviated' },
			ctxOverrides: { cwd: '/Users/yorch/code-personal/pi-statusbar' } as unknown as Partial<
				import('@earendil-works/pi-coding-agent').ExtensionContext
			>,
		}),
	);
	assert.ok(abbr.includes('[accent]'), 'path accent');
});

test('model segment thinking badge', () => {
	const s = SEGMENTS.model.render(
		createSegmentContext({
			ctxOverrides: { thinkingLevel: 'high' } as unknown as Partial<
				import('@earendil-works/pi-coding-agent').ExtensionContext
			>,
		}),
	);
	assert.ok(s.includes('claude-sonnet-4'), 'model name');
	assert.ok(s.includes(':high'), 'thinking badge');
	assert.ok(s.includes('[thinkingHigh]') || s.includes('[muted]'), 'thinking token color');
	const off = SEGMENTS.model.render(
		createSegmentContext({
			ctxOverrides: { thinkingLevel: 'off' } as unknown as Partial<
				import('@earendil-works/pi-coding-agent').ExtensionContext
			>,
		}),
	);
	assert.ok(!off.includes(':off'), 'off hides badge');
	const minimal = SEGMENTS.model.render(
		createSegmentContext({
			opts: { showThinkingLevel: false },
			ctxOverrides: { thinkingLevel: 'high' } as unknown as Partial<
				import('@earendil-works/pi-coding-agent').ExtensionContext
			>,
		}),
	);
	assert.ok(!minimal.includes(':high'), 'showThinkingLevel false hides');
});

test('stash / commit / remote empty suppression', () => {
	assert.equal(SEGMENTS.stash.render(createSegmentContext({ git: makeGit({ stash: 0 }) })), '');
	assert.ok(SEGMENTS.stash.render(createSegmentContext({ git: makeGit({ stash: 3 }) })).includes('3'), 'stash count');
	assert.equal(SEGMENTS.commit.render(createSegmentContext({ git: makeGit({ lastCommit: null }) })), '');
	assert.ok(
		SEGMENTS.commit
			.render(createSegmentContext({ git: makeGit({ lastCommit: 'abc1234 fix thing' }) }))
			.includes('abc1234'),
		'commit',
	);
	// long commit truncated
	assert.ok(
		SEGMENTS.commit.render(createSegmentContext({ git: makeGit({ lastCommit: 'a'.repeat(60) }) })).includes('…'),
		'commit truncation',
	);
	assert.equal(SEGMENTS.remote.render(createSegmentContext({ git: makeGit({ remote: null }) })), '');
	assert.ok(
		SEGMENTS.remote
			.render(createSegmentContext({ git: makeGit({ remote: 'github.com/yorch/pi-statusbar' }) }))
			.includes('github.com'),
		'remote',
	);
});

test('statuses / session / time / hostname', () => {
	const statuses = SEGMENTS.statuses.render(createSegmentContext({ statuses: ['a', 'b'] }));
	assert.ok(statuses.includes('a · b'), 'statuses join');
	assert.equal(SEGMENTS.statuses.render(createSegmentContext({ statuses: [] })), '');
	const sess = SEGMENTS.session.render(createSegmentContext({ elapsedMs: 65000 }));
	assert.ok(sess.includes('1m'), 'session duration');
	const time = SEGMENTS.time.render(createSegmentContext({}));
	assert.ok(time.includes(':'), 'time contains :');
	assert.ok(time.includes('[dim]'), 'time dim');
	const host = SEGMENTS.hostname.render(createSegmentContext({ hostname: 'myhost.local' }));
	assert.ok(host.includes('myhost.local'), 'hostname override');
});

test('context remaining/used modes', () => {
	const mk = (percent: number, window: number, mode: 'percent' | 'remaining' | 'used') =>
		createSegmentContext({
			opts: { contextMode: mode },
			ctxOverrides: {
				getContextUsage: () =>
					({ percent, contextWindow: window }) as unknown as ReturnType<
						import('@earendil-works/pi-coding-agent').ExtensionContext['getContextUsage']
					>,
			},
		});
	const remaining = SEGMENTS.context.render(mk(50, 64000, 'remaining'));
	assert.ok(remaining.includes('left'), 'remaining shows left');
	assert.ok(remaining.includes('64k'), 'remaining shows window');
	const used = SEGMENTS.context.render(mk(50, 64000, 'used'));
	assert.ok(used.includes('32k'), 'used shows tokens');
	assert.ok(used.includes('64k'), 'used shows window');
	const percent = SEGMENTS.context.render(mk(50, 64000, 'percent'));
	assert.ok(percent.includes('50%'), 'percent shows %');
});

test('diff segment hidden vs populated and showDiff', () => {
	assert.equal(SEGMENTS.diff.render(createSegmentContext({ git: makeGit({ diffAdded: 0, diffRemoved: 0 }) })), '');
	assert.equal(SEGMENTS.diff.render(createSegmentContext({ git: null })), '');
	const s = SEGMENTS.diff.render(createSegmentContext({ git: makeGit({ diffAdded: 12, diffRemoved: 3 }) }));
	assert.ok(s.includes('+12'), '+12');
	assert.ok(s.includes('-3'), '-3');
	assert.ok(s.includes('[muted]'), 'muted');
	const hidden = SEGMENTS.diff.render(
		createSegmentContext({ git: makeGit({ diffAdded: 5, diffRemoved: 1 }), opts: { showDiff: false } }),
	);
	assert.equal(hidden, '');
});

test('tokens rate and cost adaptive', () => {
	const withRate = SEGMENTS.tokens.render(
		createSegmentContext({
			usage: { input: 6000, output: 4000, cost: 0, cacheRead: 0, cacheWrite: 0 },
			elapsedMs: 120_000,
		}),
	);
	assert.ok(withRate.includes('/min'), 'rate shows per min');
	const noRate = SEGMENTS.tokens.render(
		createSegmentContext({
			usage: { input: 1000, output: 500, cost: 0, cacheRead: 0, cacheWrite: 0 },
			elapsedMs: 30_000,
		}),
	);
	assert.ok(!noRate.includes('/min'), 'no rate under 60s');
	const cheap = SEGMENTS.cost.render(
		createSegmentContext({ usage: { input: 0, output: 0, cost: 0.0043, cacheRead: 0, cacheWrite: 0 } }),
	);
	assert.ok(cheap.includes('$0.0043'), 'adaptive 4');
	const mid = SEGMENTS.cost.render(
		createSegmentContext({ usage: { input: 0, output: 0, cost: 1.23456, cacheRead: 0, cacheWrite: 0 } }),
	);
	assert.ok(mid.includes('$1.235'), 'adaptive 3');
	const high = SEGMENTS.cost.render(
		createSegmentContext({ usage: { input: 0, output: 0, cost: 12.3456, cacheRead: 0, cacheWrite: 0 } }),
	);
	assert.ok(high.includes('$12.35'), 'adaptive 2');
});

test('git worktree and detachedSha', () => {
	const wt = SEGMENTS.git.render(createSegmentContext({ git: makeGit({ branch: 'main', isWorktree: true }) }));
	assert.ok(wt.includes('⁺'), 'worktree indicator');
	const detached = SEGMENTS.git.render(
		createSegmentContext({ git: makeGit({ branch: null, detachedSha: 'abc1234' }) }),
	);
	assert.ok(detached.includes('detached@abc1234'), 'detached sha');
	assert.equal(SEGMENTS.git.render(createSegmentContext({ git: makeGit({ branch: null, detachedSha: null }) })), '');
});
