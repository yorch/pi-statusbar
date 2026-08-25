# Contributing

Development and release notes for `@yorch/pi-statusbar`.

## Prerequisites

- Node.js 26
- Bun 1.3.14 (`curl -fsSL https://bun.sh/install | bash`)
- `npm` account with access to the `@yorch` scope (for local first publish; CI uses OIDC)
- [pi coding agent](https://github.com/badlogic/pi-mono) installed (for local load-testing)

## Setup

```bash
bun install
```

## Checks

```bash
bun run lint        # biome check .
bun run typecheck   # tsc --noEmit
bun test            # node:test + strip-types, 51 tests
bun run verify      # lint + typecheck + test (CI and release gate)
```

CI runs all of the above on every push and pull request (`.github/workflows/ci.yml`). PRs that touch the package must include a changeset (`bunx changeset`).

## Project layout

```text
biome.json             # Biome config: 2 spaces, 120 cols, single quotes
.config/               # changesets config + release notes
  config.json
  README.md
scripts/
  check-packables.mjs  # guard: refuses 0.0.0 or empty tarball (no dist build)
extensions/            # the pi extension (loaded as a single package)
  index.ts             # entry: config, footer wiring, /statusbar (alias /footer) command, session events
  segments.ts          # segment registry + presets + context fallback estimator
  git-status.ts        # async git status (spawn, TTL cache, listeners) + porcelain v2 parsers
  pr.ts                # async PR lookup via gh (TTL cache, listeners) + parsePrView
  spawn.ts             # shared runCmd helper (git/gh, 5s timeout)
  icons.ts             # Nerd Font glyphs with ASCII fallback + hasNerdFonts() detection
tools/                 # preview-image pipeline (see “Regenerating the preview”)
  render-footer.mjs    # renders the full preset footer via segments.ts, truecolor ANSI
  paint-preview.py     # PIL painter → assets/ + docs/assets/ PNGs (1307x330)
tests/                 # unit tests for the pure logic (node:test)
docs/                  # GitHub Pages landing page (served from main /docs)
assets/                # gallery screenshot (referenced by pi.image manifest, raw.githubusercontent)
package.json           # pi package manifest (pi.extensions, pi.image, pi-package keyword)
.github/workflows/
  ci.yml               # verify + changeset status
  release.yml          # OIDC publish + tag + GitHub Release + dist-tag check
```

## Releasing a new version

Releases are changesets-driven with OIDC trusted publishing (see `repo-release-process.md`).

```bash
# 1. Create a changeset in your PR
bunx changeset
#   pick patch/minor/major, write notes for CHANGELOG.md (for the upgrader)
#   commit .changeset/*.md

# 2. PR checks must pass: verify + changeset status

# 3. Merge PR to main → Release workflow opens/updates
#    PR `chore: version packages` (version bump + CHANGELOG.md)

# 4. Review version numbers (last cheap checkpoint), merge Version Packages PR
#    → Release workflow runs `bun run verify` → `bun run release` publishes
#      to npm via OIDC (no token), creates tag vX.Y.Z + GitHub Release,
#      verifies `latest` dist-tag

# 5. Update the installed copy on machines that already have it
pi update --extensions
```

Conventions: Conventional Commits for PR titles, every PR touching the package needs a changeset (`bunx changeset add --empty` for no-user-visible changes).

### Testing a change in a real pi session

```bash
pi -e /path/to/pi-statusbar -p "Reply with exactly: OK" --no-tools
```

Loads the local package as a temporary extension and exits — a quick smoke test
that the manifest path and factory execute without errors. The extension
guards TUI-only UI with `ctx.hasUI`, so print/RPC modes never crash.

## GitHub Pages

The landing page is served from `docs/index.html` on `main` (repo → Settings →
Pages → Deploy from branch → `/docs`). **Any asset referenced by the page must
live under `docs/`** — Pages only serves the published directory, so
`../assets/...` resolves outside it and 404s. The repo-root `assets/` copy is
for the npm `pi.image` gallery preview only.

## Regenerating the preview image

`assets/statusbar-preview.png` (npm gallery) and `docs/assets/statusbar-preview.png`
(Pages) are generated from the real footer code — update them together whenever
the presets/segments change:

```bash
node --experimental-strip-types tools/render-footer.mjs ~/.pi/agent/themes/<your-theme>.json 170 \
  | python3 tools/paint-preview.py ~/.pi/agent/themes/<your-theme>.json
# e.g. tokyo-night.json; use your active theme file (~/.pi/agent/themes/<theme>.json)
```

`render-footer.mjs` builds a `SegmentContext` with realistic sample data and
renders the `full` preset exactly as `index.ts` does (stub theme emitting
truecolor ANSI from your theme JSON); `paint-preview.py` paints it with a Nerd
Font (auto-detected under `~/Library/Fonts`, Menlo fallback — install a Nerd
Font like Caskaydia Cove or icon glyphs render as tofu). Requires Node 26+
and Pillow (`pip install pillow`). Fonts:
install a Nerd Font (Caskaydia Cove etc.) under `~/Library/Fonts` for icon
glyphs; falls back to Menlo (ASCII). Requires the theme file.

## Adding a segment

1. Add a `Segment { id, render(SegmentContext) }` in `extensions/segments.ts` (use `theme.fg(token, text)` + `withIcon`).
2. Register it in `SEGMENTS`.
3. Wire it into `PRESETS` (`left`/`right`).
4. Add a `tests/segments.test.ts` assertion that the preset ids resolve.
5. Regenerate previews (`tools/render-footer.mjs | tools/paint-preview.py`).

> If your segment needs git/gh, reuse `runCmd` from `./spawn.ts` (don't `spawn` directly) — see `git-status.ts`/`pr.ts`.

## Release guard rails

- `scripts/check-packables.mjs` refuses `0.0.0` and empty tarball (no `dist/` build — checks `extensions/` in tarball).
- `release.yml` is pinned by SHA (`changesets/action@84886... # v2.1.1`), `id-token: write` for OIDC, `--target $GITHUB_SHA` for tags, and polls `latest` dist-tag.

## License

MIT — see `LICENSE`.
