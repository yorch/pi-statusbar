import type { ExtensionContext, Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import { ASCII } from '../extensions/icons.ts';
import type { PRInfo } from '../extensions/pr.ts';
import type { GitStatus } from '../extensions/git-status.ts';
import type { SegmentContext, SegmentOptions, UsageTotals } from '../extensions/segments.ts';

export const stubTheme: Theme = {
	fg: (token: ThemeColor, text: string) => `[${token}]${text}`,
	// Theme has other helpers but only fg is used in segments; cast to satisfy type
} as Theme;

export function createSegmentContext(
	overrides?: Partial<SegmentContext> & { ctxOverrides?: Partial<ExtensionContext> },
): SegmentContext {
	const baseCtx = {
		cwd: '/Users/yorch/code-personal/pi-statusbar',
		model: { id: 'claude-sonnet-4', name: 'claude-sonnet-4' } as unknown as ExtensionContext['model'],
		thinkingLevel: 'high' as ExtensionContext['thinkingLevel'],
		getContextUsage: () => null as unknown as ReturnType<ExtensionContext['getContextUsage']>,
		sessionManager: {
			buildContextEntries: () => [],
			getBranch: () => [],
		} as unknown as ExtensionContext['sessionManager'],
		hasUI: true,
	} as unknown as ExtensionContext;

	const ctx = { ...baseCtx, ...(overrides?.ctxOverrides ?? {}) } as ExtensionContext;
	// If ctxOverrides supplied getContextUsage/sessionManager separately
	if (overrides?.ctxOverrides?.getContextUsage)
		(ctx as unknown as Record<string, unknown>).getContextUsage = overrides.ctxOverrides.getContextUsage;
	if (overrides?.ctxOverrides?.sessionManager)
		(ctx as unknown as Record<string, unknown>).sessionManager = overrides.ctxOverrides.sessionManager;

	const base: SegmentContext = {
		ctx,
		theme: stubTheme,
		git: null,
		pr: null,
		icons: ASCII,
		statuses: [],
		usage: { input: 0, output: 0, cost: 0, cacheRead: 0, cacheWrite: 0 } satisfies UsageTotals,
		elapsedMs: 0,
		opts: {} satisfies SegmentOptions,
	};

	return {
		...base,
		...overrides,
		// deep merge opts and usage if provided
		usage: overrides?.usage ?? base.usage,
		opts: overrides?.opts ?? base.opts,
		icons: overrides?.icons ?? base.icons,
		theme: overrides?.theme ?? base.theme,
		ctx: overrides?.ctx ?? ctx,
	};
}

export function makeGit(overrides?: Partial<GitStatus>): GitStatus {
	return {
		branch: 'main',
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
		...overrides,
	};
}

export function makePr(overrides?: Partial<PRInfo>): PRInfo {
	return {
		number: 12,
		url: 'https://github.com/yorch/pi-statusbar/pull/12',
		title: 'Add thing',
		state: 'OPEN',
		isDraft: false,
		...overrides,
	};
}
