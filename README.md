# @yorch/pi-statusbar

Theme-aware status bar (footer) for the [pi coding agent](https://github.com/badlogic/pi-mono).

Renders a live status bar in the pi footer: token usage, cache, cost, a context progress bar, git status, working directory, model + thinking level, session clock, and extension statuses — all colored through **pi's theme tokens**, so it re-skins automatically with whatever theme you're using (Tokyo Night, light, or any custom theme).

```text
default:  ↑1.2k ↓340 W0.5k CH92.1% $0.004 ██████░░░░ 42%/64k · ● working… · ⎇main · tradr · model:high
full:     ~/code-personal/tradr/ (⎇main ↑2 ↓5 +1) #12 github.com/yorch/tradr        mbp2024.local · ◷ 12m · 14:32
          ↑1.2k ↓340 W0.5k CH92.1% $0.004 ██████░░░░ 42%/64k ≡1     ● working… · model:high · c921a07 Fix thing
```

## Install

```bash
pi install npm:@yorch/pi-statusbar
# or directly from git
pi install git:github.com/yorch/pi-statusbar
```

Restart pi (or `/reload`) to activate. The bar installs automatically once enabled (see below).

## Usage

- `/statusbar` — toggle the bar
- `/statusbar minimal|compact|default|full` — switch preset (saved to `settings.json`)

To have the bar **on by default**, add to `~/.pi/agent/settings.json`:

```json
{
	"statusbar": {
		"enabled": true,
		"preset": "full"
	}
}
```

All config is optional:

```json
{
	"statusbar": {
		"enabled": true,
		"preset": "full",
		"nerd": true,
		"separator": "dot",
		"contextBar": true
	}
}
```

| Key          | Default   | Description                                                                                                                                                                                            |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`    | `false`   | Install the footer automatically on session start                                                                                                                                                      |
| `preset`     | `default` | `minimal` · `compact` · `default` · `full`                                                                                                                                                             |
| `nerd`       | auto      | Force Nerd Font glyphs (`true`/`false`). Auto-detects iTerm, WezTerm, Kitty, Ghostty, Alacritty (`TERM_PROGRAM`), Ghostty inside tmux (`GHOSTTY_RESOURCES_DIR`); force with `STATUSBAR_NERD_FONTS=1/0` |
| `separator`  | `dot`     | `dot` (`·`) · `pipe` (`│`) · `space`                                                                                                                                                                   |
| `contextBar` | `true`    | Show the context progress bar (eighth-block gradient, `accent`→`warning` >70%→`error` >90%)                                                                                                            |
| `pr`         | `true`    | Show the PR segment (clickable `#n` via OSC 8 hyperlink, looked up with `gh`). Set `false` to hide                                                                                                     |

## Presets & segments

Segments render through pi theme tokens (`dim`, `muted`, `accent`, `success`, `warning`, `error`, `thinkingLow`…`thinkingMax`), so they follow your active theme.

| Segment                         | Shows                                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens`                        | cumulative `↑input ↓output` (smart `1.2k`/`45M` formatting)                                                                                                                            |
| `cache`                         | `W…` cache write, `CH…%` hit rate                                                                                                                                                      |
| `cost`                          | cumulative cost                                                                                                                                                                        |
| `context`                       | context bar + `42%/64k`; `?/64k` with an estimator fallback after compaction                                                                                                           |
| `statuses`                      | chips from `ctx.ui.setStatus()` (used by other extensions)                                                                                                                             |
| `git`                           | branch (`success` clean / `warning` dirty) + `↑ahead ↓behind` vs upstream + `+staged` `*unstaged` `?untracked`; async, 2s cache                                                        |
| `pr`                            | clickable `#n` for the current branch's PR (`gh pr view`), colored by state — draft `warning`, open/merged `success`, closed `error`. Only in the `full` preset; hide with `pr: false` |
| `stash`                         | stash entry count (`≡ n`), hidden when empty                                                                                                                                           |
| `commit`                        | last commit as `shortSha subject` (`git log -1`), hidden without commits                                                                                                               |
| `remote`                        | origin as `host/owner/repo`, e.g. `github.com/yorch/pi-statusbar`, hidden without a parseable remote                                                                                   |
| `path`                          | cwd — basename, or `~/full/path/` in `full`                                                                                                                                            |
| `model`                         | model id + `:thinking` badge colored by its own theme token                                                                                                                            |
| `hostname` / `time` / `session` | machine name, wall clock, elapsed session time                                                                                                                                         |

| Preset    | Lines | Segments                                                                                                                                                      |
| --------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimal` | 1     | `path · git · context`                                                                                                                                        |
| `compact` | 1     | `model · git · cost · context`                                                                                                                                |
| `default` | 1     | `tokens · cache · cost · context · statuses · git · path · model` + right-aligned `session`                                                                   |
| `full`    | 2     | line 1: `path · git · pr · remote` + right `hostname · session · time`; line 2: `tokens · cache · cost · context · stash` + right `statuses · model · commit` |

## Development

```bash
npm install
npm run typecheck
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout, the release
dev-loop, and the npm publish gotchas. Agents working in this repo should read
[AGENTS.md](AGENTS.md).

## Credits

Inspired by [pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer) and [oh-my-pi](https://github.com/can1357/oh-my-pi). Built on [pi's TUI extension API](https://github.com/badlogic/pi-mono).

## License

MIT
