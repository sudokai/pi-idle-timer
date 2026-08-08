# Implementation notes: scrollback-safe idle status

## Runtime behavior

- Store the time when the latest assistant message ends. Update the displayed
  duration once per second. Clear the timer when a new assistant turn starts or
  the session shuts down.
- Use `ctx.ui.setStatus()` on pi. Pi renders extension statuses in its built-in
  footer.
- Use a below-editor widget on omp. OMP's status renderer removes ANSI styling
  and does not add the normal `Text` left gutter. OMP's widget renderer adds the
  gutter and preserves the live theme color.
- Use a below-editor widget on prime-agent. Its footer is empty, and extension
  events can run in a daemon worker where `ctx.ui.setFooter()` is unavailable
  and `ctx.ui.theme` is not initialized.

## Color and layout

- Render the OMP widget with `ctx.ui.theme.fg("muted", ...)`.
- Render the prime-agent widget with an ANSI foreground sequence generated from
  the active theme's `colors.muted`. Resolve the theme name from
  `~/.prime/agent/settings.json` and custom theme files. Select truecolor or
  256-color output from the terminal environment.
- Add one explicit left gutter to prime-agent widget strings. OMP and pi widget
  rows use the `Text` component's normal gutter.
- Add a trailing newline to widget content so the timer has a blank bottom
  margin.
- Detect hosts from runtime-specific exports in
  `@earendil-works/pi-coding-agent`: prime-agent exposes
  `isIpythonToolResult` or `getPythonSkillRuntimeInfo`; omp exposes
  `renderSubagentHudLines`. `PI_IDLE_TIMER_WIDGET=1|0` overrides detection.

## Test structure

- Keep `formatIdleSeconds` in `extensions/lib/format-idle-seconds.ts` so the
  formatter tests do not load a runtime package.
- Load the extension through pi and prime-agent's real jiti loaders in
  `tests/runtime-compat.test.ts`. Exercise the full event lifecycle with a
  deterministic clock.
