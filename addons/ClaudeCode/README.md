# Claude Code on the EDGE

Auxora can show what Claude Code is doing on this PC, so you can play without checking the terminal:

- **Claude needs you**: a wide amber bar in the header that flashes. A session has stopped to ask permission, ask a question, or show a plan. The bar says which project, what it is asking ("Run: git push origin main") and, after a minute, how long it has waited.
- **Claude working**: a quiet chip with the project, how long it has been going, and its latest step ("Ran: npm run check", "Edited: dashboard.js", "Failed: npm test"). If nothing has been reported for five minutes the chip gets an amber edge and says "quiet for 6 min": one long step, or something Claude Code could not report.
- **Claude asks**: an amber-edged chip with the question, when a turn ends on one ("Want me to open the pull request next?"). It glows three times as it appears and stays until you answer or tap it away. It does not flash: nothing is blocked.
- **Claude finished**: a green-edged chip with the first line of what it said, for ten minutes. It glows three times when it appears.
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
| `PostToolUse`, `PostToolUseFailure` | The tool ran, so the wait is over. The command or the file's name becomes the session's latest step. |
| `Stop`, `StopFailure` | Finished, or stopped on an error. If the last line of Claude's message ends in a question mark, the session shows as asking and the line is that question. |
| `SessionStart`, `SessionEnd` | The session is listed, or forgotten. |

## What Auxora keeps

Claude Code posts its whole hook input, which can include a command's output or a file's contents. Auxora reads only the start of each report and keeps, in memory only: the session id, the project folder's name (not its path), the state, and one line of up to 160 characters (the command asked about or just run, a file's name, or the first line of Claude's last message). Nothing is written to disk, nothing leaves the PC, and it is gone when Auxora closes. At most eight sessions are kept, and one that has been silent for twelve hours is dropped.

The reports go to a route that does not need the dashboard's session token, because Claude Code cannot carry it. That route only records these status lines. A request that names a web origin is refused, so a web page cannot use it.

## Limits

- This PC only. Auxora listens on 127.0.0.1, so Claude Code on another computer cannot reach it.
- Claude Code inside WSL reaches Windows' 127.0.0.1 only with WSL's mirrored networking turned on.
- If Auxora is closed, each report fails at once and Claude Code carries on. Whether Claude Code shows a notice for the failed hook is up to Claude Code.
- The bar clears when the tool runs, when the turn ends, or when you send the next prompt. If you deny a request, it can stay up for the few seconds until Claude Code moves on.
