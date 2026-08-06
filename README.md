# pi-idle-timer

Shows **time since the latest assistant message finished** in the footer status bar.
Works with both **pi** (`@earendil-works/pi-coding-agent`) and **prime-agent** (the pi fork
with the IPython tool).

## Behavior

| State | Status bar |
|-------|------------|
| Fresh session (no assistant response yet) | hidden |
| Assistant response generating | hidden |
| Assistant message finished | live timer, updates every 1s |
| Tool execution after an assistant message | timer continues |

The timer resets after every completed assistant message, including intermediate
messages in tool-use loops.

**Format** (dim):

- Under 60 seconds: `idle 12s`
- Under 1 hour: `idle 3m 05s`
- 1 hour or more: `idle 1h 02m`

## How it works on each runtime

| Runtime | Rendering |
|---------|-----------|
| **pi** | The built-in footer already renders extension statuses (pwd, tokens, cost, context %, model, status line). The extension only calls `ctx.ui.setStatus()`, so pi's footer stays intact. |
| **prime-agent** | The built-in footer is **intentionally empty** (telemetry hidden by default), so `setStatus()` alone is invisible. The extension detects prime-agent and installs a minimal custom footer via `ctx.ui.setFooter()` that renders every extension status text — the idle timer among them. |

The host is detected by inspecting the host's `@earendil-works/pi-coding-agent`
package: prime-agent exports IPython-tool symbols (`isIpythonToolResult`,
`getPythonSkillRuntimeInfo`) that pi does not. Override detection with
`PI_IDLE_TIMER_FOOTER=1` (always install the custom footer) or `=0` (never).

> Note: installing the custom footer replaces the default footer. In prime-agent
> the default is empty, so nothing is lost; the footer renders all extensions'
> statuses, not just the timer.

## Install

prime-agent:

```bash
prime-agent package install git:github.com/sudokai/pi-idle-timer
```

pi:

```bash
pi install git:github.com/sudokai/pi-idle-timer
```

Local development (either runtime):

```bash
prime-agent package install /absolute/path/to/pi-idle-timer
# or
pi install /absolute/path/to/pi-idle-timer
```

One-off test without install (either runtime):

```bash
prime-agent -e ./extensions/idle-timer.ts
# or
pi -e ./extensions/idle-timer.ts
```

For hot reload, drop the file into the auto-discovered extension directory of
your runtime: `~/.prime/agent/extensions/` (prime-agent) or `~/.pi/extensions/` (pi).

## Test

```bash
npm test
```

`tests/runtime-compat.test.ts` loads the extension through each runtime's real
jiti loader (with that runtime's module aliases) and drives the full event
lifecycle against a mock extension API. Set `PI_IDLE_TIMER_PI_DIR` /
`PI_IDLE_TIMER_PRIME_DIR` if your installs live elsewhere; missing runtimes are
skipped.
