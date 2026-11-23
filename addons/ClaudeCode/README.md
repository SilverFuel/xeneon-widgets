# Claude Code on the EDGE

Auxora can show what Claude Code is doing on this PC, so you can play without checking the terminal:

- **Claude needs you**: a wide amber bar in the header that flashes. A session has stopped to ask permission, ask a question, or show a plan. The bar says which project and what it is asking ("Run: git push origin main").
- **Claude working**: a quiet chip with the project and how long it has been going.
- **Claude finished**: a green-edged chip with the first line of what it said, for ten minutes.
- **Claude stopped**: a red-edged chip when a turn ended on an error.

A tap on the bar says "seen": the flashing stops and the bar stays until you answer in the terminal. A tap on a finished or stopped chip puts it away. You still answer Claude Code in its own window; Auxora only shows.

## Set up

Auxora has to be a build with this feature, and Claude Code has to be recent enough to have HTTP hooks (update it first).

```powershell
powershell -ExecutionPolicy Bypass -File addons\ClaudeCode\Install-ClaudeCodeHooks.ps1
```

Then start a new Claude Code session. To see the bar without Claude Code:

```powershell
powershell -ExecutionPolicy Bypass -File addons\ClaudeCode\Install-ClaudeCodeHooks.ps1 -Test
```

To take it out again, add `-Remove`.

## What it does

The script adds hooks to `%USERPROFILE%\.claude\settings.json`, so they apply to every project on this PC. Hooks you already have are kept, and the file is backed up beside itself first. Each hook is of type `http` and posts Claude Code's own event to `http://127.0.0.1:8976/api/claude-code/event`.

| Event | What Auxora does with it |
|---|---|
| `UserPromptSubmit` | The session is working. |
| `PermissionRequest` | The session is waiting; the line shows the command or the file's name. |
| `PreToolUse` for `AskUserQuestion`, `ExitPlanMode` | The session is waiting with a question or a plan. |
| `Notification` (permission, input needed) | The session is waiting. |
| `PostToolUse`, `PostToolUseFailure` | The tool ran, so the wait is over. |
| `Stop`, `StopFailure` | Finished, or stopped on an error. |
| `SessionStart`, `SessionEnd` | The session is listed, or forgotten. |

## What Auxora keeps

Claude Code posts its whole hook input, which can include a command's output or a file's contents. Auxora reads only the start of each report and keeps, in memory only: the session id, the project folder's name (not its path), the state, and one line of up to 160 characters (the command asked about, a file's name, or the first line of Claude's last message). Nothing is written to disk, nothing leaves the PC, and it is gone when Auxora closes. At most eight sessions are kept, and one that has been silent for twelve hours is dropped.

The reports go to a route that does not need the dashboard's session token, because Claude Code cannot carry it. That route only records these status lines. A request that names a web origin is refused, so a web page cannot use it.

## Limits

- This PC only. Auxora listens on 127.0.0.1, so Claude Code on another computer cannot reach it.
- Claude Code inside WSL reaches Windows' 127.0.0.1 only with WSL's mirrored networking turned on.
- If Auxora is closed, each report fails at once and Claude Code carries on. Whether Claude Code shows a notice for the failed hook is up to Claude Code.
- The bar clears when the tool runs, when the turn ends, or when you send the next prompt. If you deny a request, it can stay up for the few seconds until Claude Code moves on.
