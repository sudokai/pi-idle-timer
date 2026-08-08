# pi-idle-timer

Shows **time since the latest assistant message finished** in a status line.
Works with **pi** (`@earendil-works/pi-coding-agent`), **omp**, and
**prime-agent** (the pi fork with the IPython tool).

## Behavior

| State | Status bar |
|-------|------------|
| Fresh session (no assistant response yet) | hidden |
| Assistant response generating | hidden |
| Assistant message finished | live timer, updates every 1s |
| Tool execution after an assistant message | timer continues |

The timer resets after every completed assistant message, including intermediate
messages in tool-use loops.

**Format**:

- Under 60 seconds: `idle 12s`
- Under 1 hour: `idle 3m 05s`
- 1 hour or more: `idle 1h 02m`

On omp and prime-agent the timer uses a widget row in the theme's **muted**
color (the same shade as secondary TUI text like the agent/session line). OMP
places the widget above the editor and gets its one-cell gutter from the `Text`
component. The timer carries a trailing newline so the TUI renders a blank row
of bottom margin after it.

## How it works on each runtime

| Runtime | Rendering |
|---------|-----------|
| **pi** | The built-in footer already renders extension statuses (pwd, tokens, cost, context %, model, status line). The extension calls `ctx.ui.setStatus()`, so pi's footer stays intact. |
| **omp** | OMP's status renderer strips ANSI styling and does not add Text's normal left gutter. The extension uses an above-editor widget, so OMP supplies the gutter and the live theme supplies the muted color. |
| **prime-agent** | The built-in footer is **intentionally empty** (telemetry hidden by default), so `setStatus()` alone is invisible. Worse, the TUI usually runs against the shared daemon, where extension events execute in a worker process: there `ctx.ui.setFooter()` is a no-op and `ctx.ui.theme` is uninitialized (it throws). The channel that does cross the daemon boundary is `ctx.ui.setWidget()` with plain string lines, so the extension renders the timer as a one-line widget **below the editor** — the row the empty footer would occupy. The line is styled with the theme's **muted** foreground color by embedding the ANSI escape the TUI itself would emit, and carries a trailing newline so the TUI renders a blank row of bottom margin after the timer. |

The host is detected by inspecting the host's `@earendil-works/pi-coding-agent`
package: prime-agent exports IPython-tool symbols (`isIpythonToolResult`,
`getPythonSkillRuntimeInfo`), and omp exports `renderSubagentHudLines`. Override
detection with `PI_IDLE_TIMER_WIDGET=1` (always use the widget) or `=0` (never;
fall back to `setStatus`).

## Install

omp:

```bash
omp plugin install git:github.com/sudokai/pi-idle-timer
```

prime-agent:

```bash
prime-agent package install git:github.com/sudokai/pi-idle-timer
```

pi:

```bash
pi install git:github.com/sudokai/pi-idle-timer
```

Local development:

```bash
omp plugin link /absolute/path/to/pi-idle-timer
# or
pi install /absolute/path/to/pi-idle-timer
# or
prime-agent package install /absolute/path/to/pi-idle-timer
```

One-off test without install:

```bash
omp -e ./extensions/idle-timer.ts
# or
pi -e ./extensions/idle-timer.ts
# or
prime-agent -e ./extensions/idle-timer.ts
```

For hot reload, drop `idle-timer.ts` and the `lib/` directory (the pure
formatter) into the auto-discovered extension directory of your runtime:
`~/.omp/agent/extensions/` (omp), `~/.prime/agent/extensions/`
(prime-agent), or `~/.pi/extensions/` (pi). The `lib/` subdirectory is not
auto-discovered as an extension, so only the timer loads.

## Test

```bash
npm test
```

`tests/runtime-compat.test.ts` loads the extension through each runtime's real
jiti loader (with that runtime's module aliases) and drives the full event
lifecycle against a mock extension API. Set `PI_IDLE_TIMER_PI_DIR` /
`PI_IDLE_TIMER_PRIME_DIR` if your installs live elsewhere; missing runtimes are
skipped.
