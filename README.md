# pi-idle-timer

Shows **time since the agent last settled** in the pi footer status bar.

## Behavior

| State | Status bar |
|-------|------------|
| Fresh session (no agent run yet) | hidden |
| Agent working | hidden |
| Agent idle (settled) | live timer, updates every 1s |

**Format** (dim):

- Under 60 seconds: `idle 12s`
- Under 1 hour: `idle 3m 05s`
- 1 hour or more: `idle 1h 02m`

## Install

```bash
pi install git:github.com/sudokai/pi-idle-timer
```

Local development:

```bash
pi install /absolute/path/to/pi-idle-timer
```

One-off test without install:

```bash
pi -e ./extensions/idle-timer.ts
```