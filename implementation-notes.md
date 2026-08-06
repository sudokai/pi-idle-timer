# Implementation notes: scrollback-safe idle status

## Decisions
- **Use a static "idle since" timestamp instead of a ticking elapsed counter** — pi's `setStatus()` unconditionally requests a full TUI render, so any recurring update can interrupt native terminal scrollback. Alternatives considered: slower polling (still interrupts scrollback) and replacing pi's footer (too invasive and duplicates core UI).
- **Keep dual-runtime compatibility (pi + prime-agent).** pi's built-in footer renders extension statuses (line 3 of the footer: pwd / tokens+cost+context+model / statuses), so pi only needs `ctx.ui.setStatus()`. prime-agent's built-in footer is intentionally empty (`render()` returns `[]` — "prime brand TUI" hides telemetry by default), so `setStatus()` alone is invisible there.
- **prime-agent: install a minimal custom footer.** The extension detects prime-agent and calls `ctx.ui.setFooter()` with a component that renders every extension status text from `footerData.getExtensionStatuses()`. Installed lazily on first timer display (TUI is fully constructed by then), removed on `session_shutdown`. Since prime-agent's default footer is empty and the custom footer renders all statuses (not just the timer), no other extension's statuses are lost.
- **Detect the host from the host's own package.** Each runtime aliases `@earendil-works/pi-coding-agent` to its own build, so a namespace import plus `typeof` checks on prime-agent-only exports (`isIpythonToolResult`, `getPythonSkillRuntimeInfo`) identify the runtime without parsing `process.argv` (works for npm installs and Bun binaries). Override: `PI_IDLE_TIMER_FOOTER=1|0`.
- **Split `formatIdleSeconds` into `extensions/format-idle-seconds.ts`.** The extension module now value-imports `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` (both bundled by pi and prime-agent), which plain `node --experimental-strip-types` cannot resolve outside a runtime. The pure formatter keeps the unit test dependency-free; the runtime-compat test loads the real module through each runtime's jiti loader.

## Deviations
- None.
