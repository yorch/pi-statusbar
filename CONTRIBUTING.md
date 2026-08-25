# Contributing

Development and release notes for `@yorch/pi-statusbar`.

## Prerequisites

- Node.js 20+ (any recent LTS works)
- `npm` account with access to the `@yorch` scope (for publishing)
- [pi coding agent](https://github.com/badlogic/pi-mono) installed (for local load-testing)

## Setup

```bash
npm install
```

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm test            # node:test + strip-types, 33 tests
npx prettier --check .   # code style (see .prettierrc.json: tabs/120-col/single quotes)
```

CI runs both on every push and pull request (`.github/workflows/ci.yml`).

## Project layout

```text
.prettierrc.json       # prettier config: tabs, 120 cols, single quotes (pi auto-formats on save)
extensions/            # the pi extension (loaded as a single package)
  index.ts             # entry: config, footer wiring, /statusbar (alias /footer) command, session events
  segments.ts          # segment registry + presets + context fallback estimator
  git-status.ts        # async git status (spawn, TTL cache, listeners) + porcelain v2 parsers
  pr.ts                # async PR lookup via gh (TTL cache, listeners) + parsePrView
  icons.ts             # Nerd Font glyphs with ASCII fallback + hasNerdFonts() detection
tools/                 # preview-image pipeline (see “Regenerating the preview”)
  render-footer.mjs    # renders the full preset footer via segments.ts, truecolor ANSI
  paint-preview.py     # PIL painter → assets/ + docs/assets/ PNGs (1307x330)
tests/                 # unit tests for the pure logic (node:test)
docs/                  # GitHub Pages landing page (served from main /docs)
assets/                # gallery screenshot (referenced by pi.image manifest, raw.githubusercontent)
package.json           # pi package manifest (pi.extensions, pi.image, pi-package keyword)
```

## Releasing a new version

The loop is: change → check → commit → publish → update the live install.

```bash
# 1. edit code, then
npm run typecheck && npm test

# 2. bump the version
#    (edit "version" in package.json — no npm version, to keep control of the commit)

# 3. commit + push
git add -A && git commit -m "vX.Y.Z: <summary>" && git push

# 4. publish (see "npm publish gotchas" below)
npm publish --access public

# 5. update the installed copy on machines that already have it
pi update --extensions
```

### npm publish gotchas (learned the hard way)

1. **Name collisions:** the unscoped `pi-statusbar` is rejected by npm's
   name-similarity guard (`pi-status-bar` exists). The package is published as
   the scoped `@yorch/pi-statusbar`.
2. **Scoped packages default to private.** Publishing without `--access public`
   fails with `E402 Payment Required`. Always: `npm publish --access public`.
3. **OTP per publish session.** npm's CLI auth requires a fresh browser
   confirmation each time (error: `HttpErrorAuthOTP`). Complete the URL printed
   by the error, or run the publish interactively. `npm whoami` succeeding is
   **not** sufficient for publishing.
4. **Metadata lag after publish.** The tarball URL goes live immediately but the
   registry metadata document can 404 for a couple of minutes (Cloudflare
   negative-cache). `npm view` failing right after publish is usually this —
   wait and retry, it is not a failed publish.

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
Font like Caskaydia Cove or icon glyphs render as tofu). Requires Node 22+
(for `--experimental-strip-types`) and Pillow (`pip install pillow`). Fonts:
install a Nerd Font (Caskaydia Cove etc.) under `~/Library/Fonts` for icon
glyphs; falls back to Menlo (ASCII). Requires the theme file and
prettier-formatted tool sources.

## Adding a segment

1. Add a `Segment { id, render(SegmentContext) }` in `extensions/segments.ts` (use `theme.fg(token, text)` + `withIcon`).
2. Register it in `SEGMENTS`.
3. Wire it into `PRESETS` (`left`/`right`).
4. Add a `tests/segments.test.ts` assertion that the preset ids resolve.
5. Regenerate previews (`tools/render-footer.mjs | tools/paint-preview.py`).

## License

MIT — see `LICENSE`.
