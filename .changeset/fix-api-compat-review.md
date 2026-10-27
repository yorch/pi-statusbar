---
'@yorch/pi-statusbar': patch
---

Fix review findings: gate TUI APIs on `ctx.mode === 'tui'` (RPC has `hasUI`), stop false `gh` auth hints and skip `gh` on detached HEAD, re-apply the footer on every `session_start`, use `agent_start`/`agent_end` for the working chip, fix the usage cache, follow theme changes in the working indicator, always-on (cheap) clock timer, error on unknown `/statusbar` args, fewer git spawns (longer TTL, merged rev-parse, invalidate after tools), and width-aware path truncation.
