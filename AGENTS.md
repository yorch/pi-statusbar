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
| `npm run typecheck`              | `tsc --noEmit` over `extensions/` (strict, `allowImportingTsExtensions`)            |
| `npm test`                       | `node --experimental-strip-types --test tests/**/*.test.ts` (33 tests, node:test)   |
| `npm publish --access public`    | Publish to npm (scoped packages are private by default — the flag is mandatory)     |
| `pi -e <path> -p "…" --no-tools` | Load the local package as a temporary extension; smoke-tests the manifest + factory |

CI (`.github/workflows/ci.yml`) runs typecheck + tests on every push and pull request.

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
  implementation `pi-powerline-footer`). Enforced by prettier via
  `.prettierrc.json` — run `npx prettier --write <file>` if a diff ever looks
  unformatted.
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

## Release process (dev loop)

1. Edit code → `npm run typecheck && npm test`.
2. Bump `version` in `package.json` by hand (no `npm version` — keep the commit, e.g. `git commit -m "vX.Y.Z: <summary>"`).
3. `git add -A && git commit && git push`.
4. `npm publish --access public`.
5. On machines with the package installed: `pi update --extensions`.

Load-test a local change first: `pi -e <repo path> -p "Reply with exactly: OK" --no-tools`.

## Gotchas (each cost real time — don't rediscover them)

- **pi-lens auto-formats files on save with prettier** (it smart-detects
  `printWidth`/tabs from a config or the file's indentation). `.prettierrc.json`
  pins the repo style (120-col, tabs, single quotes); keep edits
  prettier-clean or the formatter reflows them. **Hand-restoring formatting via
  scripts does NOT stick** — the next edit reflows again. Fix the style in the
  file (or run `npx prettier --write`) instead of working around the formatter.
- **npm name-similarity guard** rejected `pi-statusbar` (`pi-status-bar`
  exists). The package is scoped: `@yorch/pi-statusbar`. Don't rename back.
- **Scoped npm packages default to private** → `E402 Payment Required` without
  `--access public`. The flag is always required.
- **npm CLI auth needs a fresh OTP per publish session** (`HttpErrorAuthOTP`).
  `npm whoami` succeeding does not mean publish will. Complete the URL in the
  error or publish interactively.
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

- Do **not** add features beyond the status bar's remit (no stash/queue/vibes —
  that's `pi-powerline-footer`'s territory).
- Keep the bar working in both dark and light themes; prefer `dim`/`muted`/
  `accent` over saturated colors for body text.
