# AGENTS.md

Guidance for AI coding agents working in this repository.

`@yorch/pi-statusbar` is a [pi coding agent](https://github.com/badlogic/pi-mono)
extension: a theme-aware status bar (footer) rendered through pi's TUI extension
API. It ships as an npm package (`pi-package` keyword) installed with
`pi install npm:@yorch/pi-statusbar`, and is served on GitHub Pages.

> `CLAUDE.md` is a symlink to `AGENTS.md` — keep them in sync if you add one.

## Commands

| Command                          | What it does                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `bun run typecheck`              | `tsc --noEmit` over `extensions/` (strict, `allowImportingTsExtensions`)            |
| `bun test`                       | `node --experimental-strip-types --test tests/**/*.test.ts` (51 tests, node:test)   |
| `bun run lint`                   | `biome check .` (tabs, 120 cols, single quotes)                                      |
| `bun run lint:fix`               | `biome check --write .`                                                              |
| `bun run verify`                 | `lint && typecheck && test` — CI and release gate                                    |
| `bunx changeset`                 | Create a changeset for the PR (required)                                             |
| `pi -e <path> -p "…" --no-tools` | Load the local package as a temporary extension; smoke-tests the manifest + factory |

CI (`.github/workflows/ci.yml`) runs lint + typecheck + tests on every push and pull request; `changeset status` fails PRs that touch the package without a changeset.

## Architecture

- `extensions/index.ts` — entry. Default-exports the extension factory. Reads
  `statusbar` config from `~/.pi/agent/settings.json`, wires `ctx.ui.setFooter`
  (the status bar), `setWorkingIndicator`, `/statusbar` (alias `/footer`) command, and
  `turn_start`/`turn_end` status chips.
- `extensions/segments.ts` — the heart. `SEGMENTS` is a registry of
  `{ id, render(SegmentContext) }`; `PRESETS` maps preset names to rows
  (`{ left: string[], right?: string[] }` — right-aligned groups pad to the
  right edge and truncate first on narrow terminals). Context segment has an
  estimator fallback (`buildContextEntries` + `estimateTokens`) when
  `getContextUsage()` returns null (post-compaction).
- `extensions/spawn.ts` — shared `runCmd` helper for `git`/`gh` spawns (5s timeout, `stdio ['ignore','pipe','ignore']`).
- `extensions/git-status.ts` — async `git` via `runCmd` with a 3s TTL cache;
  `getGitStatus()` returns cached/null and triggers a background refresh;
  listeners fire on fresh data so the TUI re-renders. One
  `git status --porcelain=v2 --branch` call supplies branch/upstream/ahead/
  behind + file counts; stash count, last commit, origin URL, diff `--numstat`,
  worktree check and detached `HEAD` sha come from parallel calls. `parseStatusV2`/`parsePorcelain`/`countStash`/
  `parseLogLine`/`parseRemoteHost`/`parseNumstat` are pure and unit-tested.
- `extensions/pr.ts` — async `gh pr view` lookup with a 5 min TTL cache +
  listeners, keyed on cwd+branch so branch changes invalidate it naturally.
  The remote host is checked (`isGitHubHost`) before spawn, so non-GitHub
  forges/bare repos never invoke gh. `parsePrView`/`isGitHubHost` are pure and
  unit-tested; no `gh`, non-GitHub remote, or a branch without a PR resolves
  to null (segment renders nothing). One-time `gh auth` hint surfaces via `shouldShowGhHint()`.
- `extensions/icons.ts` — `hasNerdFonts()`: env force (`STATUSBAR_NERD_FONTS`),
  then `GHOSTTY_RESOURCES_DIR`, then `TERM_PROGRAM` match (iterm/wezterm/kitty/
  ghostty/alacritty).

## Conventions

- **Tabs** for indentation, single quotes, 120-col lines (matches the reference
  implementation `pi-powerline-footer`). Enforced by Biome via `biome.json`
  — run `bun run lint:fix` if a diff ever looks unformatted.
- TypeScript strict; explicit types on exported functions.
- Relative imports between extension files **must include the `.ts` extension**
  (`./git-status.ts`) — pi runs extensions through jiti, and tsc requires
  `allowImportingTsExtensions` (already in `tsconfig.json`).
- **Colors go through pi theme tokens** (`theme.fg("dim", …)`,
  `theme.fg(THINKING_TOKENS[level], …)`), never hardcoded hex — the bar must
  re-skin with the user's theme. `ThemeColor` is a literal union; type
  segment-color maps as `Record<string, ThemeColor>`, not `string`.
- New segments go in the `SEGMENTS` registry and are wired into presets; add a
  test asserting preset segment ids resolve (`tests/segments.test.ts` does this).
- **Guard TUI-only APIs with `ctx.hasUI`.** `ctx.ui.setFooter/setWidget` are
  no-ops or errors in print/rpc/json modes — `apply()` returns early
  (`if (!ctx.hasUI) return;`). Never regress this.
- The `statusbar` config shape lives in `index.ts` (`StatusBarConfig`): preset,
  nerd, separator, contextBar, pr, contextMode, enabled. Defaults: `default` preset, nerd
  auto-detect, dot separator, bar on (`contextBar: true`, `pr: true`, `contextMode: 'percent'`), disabled until `enabled: true`.

## Release process

Changesets + OIDC trusted publishing (see `repo-release-process.md` and `CONTRIBUTING.md`).

1. Every PR touching the package needs a changeset: `bunx changeset` (or `bunx changeset add --empty` for no-user-visible changes).
2. Merge to `main` → Release workflow opens/updates `chore: version packages` PR (bumps version + CHANGELOG).
3. Review version numbers, merge that PR → Release workflow publishes to npm (`bun run release` → `changeset publish` via OIDC), creates `vX.Y.Z` tag + GitHub Release, verifies `latest` dist-tag.
4. `bun run verify` (lint + typecheck + test) is the gate for both CI and release; publishing is the only irreversible action.

Load-test a local change first: `pi -e <repo path> -p "Reply with exactly: OK" --no-tools`.

## Gotchas (each cost real time — don't rediscover them)

- **npm name-similarity guard** rejected `pi-statusbar` (`pi-status-bar`
  exists). The package is scoped: `@yorch/pi-statusbar`. Don't rename back.
- **Scoped npm packages default to private** → `E402 Payment Required` without
  `--access public` on first publish. OIDC + changesets handles `access: public`.
- **Registry metadata lags ~2 min after publish** — tarball is live immediately,
  `npm view` may 404. Wait; it is not a failed publish.
- **GitHub Pages serves only the published dir.** Page assets must live under
  `docs/`; `../assets/…` from the page resolves to the site root and 404s.
  Repo-root `assets/` exists solely for the npm `pi.image` gallery preview
  (raw.githubusercontent URL).
- **Peer deps are `"*"`** (`@earendil-works/pi-ai`, `-pi-coding-agent`,
  `-pi-tui`) — pi bundles them; never add them to `dependencies`.
- The npm tarball (`files` in package.json) ships only `extensions/`,
  `README.md`, `LICENSE` — tests live in the repo but not the published package.

## Scope notes

- Do **not** add features beyond the status bar's remit (no queue/vibes —
  stash is intentionally supported; that's `pi-powerline-footer`'s territory).
- Keep the bar working in both dark and light themes; prefer `dim`/`muted`/
  `accent` over saturated colors for body text.
