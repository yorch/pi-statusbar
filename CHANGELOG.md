# @yorch/pi-statusbar

## 0.4.3

### Patch Changes

- [#14](https://github.com/yorch/pi-statusbar/pull/14) [`a8c7487`](https://github.com/yorch/pi-statusbar/commit/a8c74871ffef9b14ce79958dcc37d9d424fca342) Thanks [@yorch](https://github.com/yorch)! - Fix review findings: gate TUI APIs on `ctx.mode === 'tui'` (RPC has `hasUI`), stop false `gh` auth hints and skip `gh` on detached HEAD, re-apply the footer on every `session_start`, use `agent_start`/`agent_end` for the working chip, fix the usage cache, follow theme changes in the working indicator, always-on (cheap) clock timer, error on unknown `/statusbar` args, fewer git spawns (longer TTL, merged rev-parse, invalidate after tools), and width-aware path truncation.

## 0.4.2

### Patch Changes

- [#12](https://github.com/yorch/pi-statusbar/pull/12) [`01f8112`](https://github.com/yorch/pi-statusbar/commit/01f8112f68fa9c4b18fd3aee016f8cd45e85f45c) Thanks [@yorch](https://github.com/yorch)! - chore: support Node 22, 24 and 26

## 0.4.1

### Patch Changes

- [#8](https://github.com/yorch/pi-statusbar/pull/8) [`d2074dd`](https://github.com/yorch/pi-statusbar/commit/d2074dd241ecf59642edff1f4418145b907a356f) Thanks [@yorch](https://github.com/yorch)! - chore: migrate to Bun + Node 26 + Biome + changesets release
  
  Update dependencies to latest: @earendil-works/* 0.84.3, @biomejs/biome 2.5.10, @changesets/cli 3.0.1, @changesets/changelog-github 1.0.0, @types/node 26.3.0, typescript 7.0.2. Switch formatter to 2-space indentation.
