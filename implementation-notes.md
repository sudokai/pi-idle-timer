# Implementation notes: scrollback-safe idle status

## Decisions
- **Use a static "idle since" timestamp instead of a ticking elapsed counter** — pi's `setStatus()` unconditionally requests a full TUI render, so any recurring update can interrupt native terminal scrollback. Alternatives considered: slower polling (still interrupts scrollback) and replacing pi's footer (too invasive and duplicates core UI).
- **Keep pi, omp, and prime-agent compatibility.** Pi's built-in footer renders extension statuses, OMP needs a widget for its custom muted layout, and prime-agent's built-in footer is intentionally empty.
- **omp: render an above-editor widget instead of a status.** OMP strips ANSI from status text and does not add the normal `Text` left gutter. Its widget renderer supplies the gutter and preserves the live theme color.
- **prime-agent: render a below-editor widget instead of a footer.** The prime-agent TUI normally runs against the shared daemon, where extension events execute in a daemon worker. There `ctx.ui.setFooter()` is unavailable and `ctx.ui.theme` is not initialized. The daemon-safe channel is `ctx.ui.setWidget()` with plain string lines, so the extension renders the timer below the editor.
- **Style widget rows with the theme's `muted` color.** OMP uses `ctx.ui.theme.fg("muted", ...)`; prime-agent resolves the active theme's `colors.muted` and emits the matching truecolor or 256-color ANSI sequence. Add a trailing newline for bottom margin, but no leading gutter space.
- **Never touch `ctx.ui.theme` unguarded.** In daemon workers the theme proxy can throw; `dimText()` catches the error and falls back to plain text.
- **Detect hosts from runtime exports.** Prime-agent exports `isIpythonToolResult` or `getPythonSkillRuntimeInfo`; omp exports `renderSubagentHudLines`. Override with `PI_IDLE_TIMER_WIDGET=1|0`.
- **Split `formatIdleSeconds` into `extensions/lib/format-idle-seconds.ts`.** The pure formatter stays independent from runtime package imports, and the runtime compatibility test loads the extension through each runtime's loader.

## Deviations
- None.
