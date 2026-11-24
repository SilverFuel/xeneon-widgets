using System.Text;
using System.Text.Json;

namespace XenonEdgeHost;

// One report from a Claude Code hook, cut down to the few fields the dashboard shows.
// Claude Code posts the whole hook input, which for some events carries a file's contents
// or a command's output. Only the start of the body is read, and only these fields are kept.
public sealed class ClaudeCodeEvent
{
    public const int MaxHeadBytes = 64 * 1024;

    private static readonly string[] TopLevelFields =
    {
        "hook_event_name", "session_id", "cwd", "tool_name", "notification_type", "message", "last_assistant_message", "tool_input"
    };

    private static readonly string[] ToolInputFields = { "command", "file_path", "description" };

    public string Name { get; set; } = "";
    public string SessionId { get; set; } = "";
    public string Cwd { get; set; } = "";
    public string ToolName { get; set; } = "";
    public string NotificationType { get; set; } = "";
    public string Message { get; set; } = "";
    public string LastAssistantMessage { get; set; } = "";
    public string Command { get; set; } = "";
    public string FilePath { get; set; } = "";
    public string Description { get; set; } = "";

    public static ClaudeCodeEvent? Parse(byte[] buffer, int count)
    {
        return Parse(new ReadOnlySpan<byte>(buffer, 0, Math.Clamp(count, 0, buffer.Length)));
    }

    // Reads as far as the bytes go. A body cut off part-way still gives the fields that came
    // before the cut, and the common ones (session, event, folder) come first.
    public static ClaudeCodeEvent? Parse(ReadOnlySpan<byte> utf8)
    {
        var parsed = new ClaudeCodeEvent();
        try
        {
            var reader = new Utf8JsonReader(utf8, isFinalBlock: false, state: default);
            if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
            {
                return null;
            }

            var field = "";
            var inToolInput = false;
            while (reader.Read())
            {
                var token = reader.TokenType;
                if (token == JsonTokenType.PropertyName)
                {
                    if (reader.CurrentDepth == 1)
                    {
                        inToolInput = false;
                        field = Match(ref reader, TopLevelFields);
                    }
                    else if (reader.CurrentDepth == 2 && inToolInput)
                    {
                        field = Match(ref reader, ToolInputFields);
                    }
                    else
                    {
                        field = "";
                    }

                    continue;
                }

                if (token == JsonTokenType.StartObject && reader.CurrentDepth == 1 && field == "tool_input")
                {
                    inToolInput = true;
                    field = "";
                    continue;
                }

                if (token == JsonTokenType.StartObject || token == JsonTokenType.StartArray)
                {
                    // Anything else nested is passed over whole. If its end was cut off, stop here.
                    if (!reader.TrySkip())
                    {
                        break;
                    }

                    field = "";
                    continue;
                }

                if (token == JsonTokenType.EndObject)
                {
                    if (reader.CurrentDepth == 1)
                    {
                        inToolInput = false;
                    }

                    field = "";
                    continue;
                }

                if (token == JsonTokenType.String && field.Length > 0)
                {
                    parsed.Set(field, reader.GetString() ?? "");
                }

                field = "";
            }
        }
        catch (JsonException)
        {
        }
        catch (InvalidOperationException)
        {
        }

        return parsed.SessionId.Length > 0 && parsed.Name.Length > 0 ? parsed : null;
    }

    private static string Match(ref Utf8JsonReader reader, string[] names)
    {
        foreach (var name in names)
        {
            if (reader.ValueTextEquals(name))
            {
                return name;
            }
        }

        return "";
    }

    private void Set(string field, string value)
    {
        switch (field)
        {
            case "hook_event_name": Name = value; break;
            case "session_id": SessionId = value; break;
            case "cwd": Cwd = value; break;
            case "tool_name": ToolName = value; break;
            case "notification_type": NotificationType = value; break;
            case "message": Message = value; break;
            case "last_assistant_message": LastAssistantMessage = value; break;
            case "command": Command = value; break;
            case "file_path": FilePath = value; break;
            case "description": Description = value; break;
        }
    }
}

public sealed class ClaudeCodeSessionPayload
{
    public string Id { get; set; } = "";
    public string Project { get; set; } = "";
    public string State { get; set; } = "";
    public string Text { get; set; } = "";
    public long StateSeconds { get; set; }
    public long IdleSeconds { get; set; }
}

public sealed class ClaudeCodePayload
{
    public bool Available { get; set; } = true;
    public List<ClaudeCodeSessionPayload> Sessions { get; set; } = new();
}

// What each Claude Code session on this PC is doing, from the reports its hooks send:
// working, waiting for a decision, finished, or stopped on an error. Kept in memory only.
public sealed class ClaudeCodeService
{
    public const string Ready = "ready";
    public const string Working = "working";
    public const string Waiting = "waiting";
    public const string Done = "done";
    public const string Failed = "error";
    public const string Ended = "ended";

    public const int MaxSessions = 8;
    private const int MaxTextLength = 160;
    private static readonly TimeSpan ForgetAfter = TimeSpan.FromHours(12);

    private sealed class Session
    {
        public string Project = "";
        public string State = "";
        public string Text = "";
        public DateTimeOffset StateSince;
        public DateTimeOffset UpdatedAt;
    }

    private readonly object _sync = new();
    private readonly Dictionary<string, Session> _sessions = new(StringComparer.Ordinal);

    public void Record(ClaudeCodeEvent report, DateTimeOffset now)
    {
        var id = Clean(report.SessionId, 80);
        if (id.Length == 0)
        {
            return;
        }

        lock (_sync)
        {
            _sessions.TryGetValue(id, out var session);
            var next = Next(session?.State ?? "", session?.Text ?? "", report, out var text);
            if (next == Ended)
            {
                _sessions.Remove(id);
                return;
            }

            if (session is null)
            {
                session = new Session { StateSince = now };
                _sessions[id] = session;
            }

            var project = ProjectOf(report.Cwd);
            if (project.Length > 0)
            {
                session.Project = project;
            }

            if (next != session.State)
            {
                session.State = next;
                session.StateSince = now;
            }

            session.Text = text;
            session.UpdatedAt = now;

            while (_sessions.Count > MaxSessions)
            {
                var oldest = _sessions.OrderBy(pair => pair.Value.UpdatedAt).First().Key;
                _sessions.Remove(oldest);
            }
        }
    }

    public ClaudeCodePayload Snapshot(DateTimeOffset now)
    {
        var payload = new ClaudeCodePayload();
        lock (_sync)
        {
            foreach (var stale in _sessions.Where(pair => now - pair.Value.UpdatedAt > ForgetAfter).Select(pair => pair.Key).ToList())
            {
                _sessions.Remove(stale);
            }

            foreach (var pair in _sessions.OrderBy(pair => pair.Value.StateSince))
            {
                payload.Sessions.Add(new ClaudeCodeSessionPayload
                {
                    Id = pair.Key.Length > 8 ? pair.Key[..8] : pair.Key,
                    Project = pair.Value.Project,
                    State = pair.Value.State,
                    Text = pair.Value.Text,
                    StateSeconds = Math.Max(0, (long)(now - pair.Value.StateSince).TotalSeconds),
                    IdleSeconds = Math.Max(0, (long)(now - pair.Value.UpdatedAt).TotalSeconds)
                });
            }
        }

        return payload;
    }

    // The state a session moves to on one report, and the line shown with it.
    public static string Next(string state, string currentText, ClaudeCodeEvent report, out string text)
    {
        text = currentText;
        switch (report.Name)
        {
            case "SessionStart":
                text = "";
                return Ready;
            case "SessionEnd":
                text = "";
                return Ended;
            case "UserPromptSubmit":
                text = "";
                return Working;
            case "PermissionRequest":
                text = Ask(report);
                return Waiting;
            case "PreToolUse":
                if (report.ToolName == "AskUserQuestion")
                {
                    text = "Has a question for you";
                    return Waiting;
                }

                if (report.ToolName == "ExitPlanMode")
                {
                    text = "Has a plan for you to review";
                    return Waiting;
                }

                return state.Length == 0 ? Working : state;
            case "Notification":
                switch (report.NotificationType)
                {
                    case "permission_prompt":
                        if (state != Waiting || currentText.Length == 0)
                        {
                            text = Clean(report.Message, MaxTextLength);
                        }

                        return Waiting;
                    case "elicitation_dialog":
                    case "elicitation_url_dialog":
                    case "agent_needs_input":
                        text = Clean(report.Message, MaxTextLength);
                        if (text.Length == 0)
                        {
                            text = "Needs your input";
                        }

                        return Waiting;
                    case "idle_prompt":
                        return state is Working or Ready or "" ? Done : state;
                    default:
                        return state.Length == 0 ? Ready : state;
                }
            case "PostToolUse":
            case "PostToolUseFailure":
                // The tool ran, so whatever it was waiting on has been answered. The line
                // becomes what it just did, so a glance shows the session is moving.
                if (state == Waiting || state == Working || state.Length == 0)
                {
                    text = Did(report, report.Name == "PostToolUseFailure");
                    return Working;
                }

                return state;
            case "Stop":
                text = FirstLine(report.LastAssistantMessage);
                return Done;
            case "StopFailure":
                text = "Stopped on an error";
                return Failed;
            default:
                return state.Length == 0 ? Ready : state;
        }
    }

    // What Claude Code is asking to do, in a few words.
    public static string Ask(ClaudeCodeEvent report)
    {
        return report.ToolName.Length == 0 && report.FilePath.Length == 0
            ? "Needs your permission"
            : Describe(report, "Run", "Read", "Write", "Edit", "Use");
    }

    // What Claude Code just did, in a few words. Empty when the report names no tool.
    public static string Did(ClaudeCodeEvent report, bool failed)
    {
        if (report.ToolName.Length == 0 && report.FilePath.Length == 0)
        {
            return "";
        }

        return failed
            ? Describe(report, "Failed", "Could not read", "Could not write", "Could not edit", "Failed")
            : Describe(report, "Ran", "Read", "Wrote", "Edited", "Used");
    }

    private static string Describe(ClaudeCodeEvent report, string run, string read, string write, string edit, string use)
    {
        var tool = report.ToolName;
        if (tool == "Bash" && report.Command.Length > 0)
        {
            return Clean(run + ": " + report.Command, MaxTextLength);
        }

        if (report.FilePath.Length > 0)
        {
            var verb = tool == "Read" ? read : tool == "Write" ? write : edit;
            return Clean(verb + ": " + ProjectOf(report.FilePath), MaxTextLength);
        }

        var name = tool.StartsWith("mcp__", StringComparison.Ordinal)
            ? tool[5..].Replace("__", ": ", StringComparison.Ordinal)
            : tool;
        return Clean(report.Description.Length > 0 ? use + " " + name + ": " + report.Description : use + " " + name, MaxTextLength);
    }

    // The last part of a folder or file path. Only this reaches the dashboard, never the path.
    public static string ProjectOf(string path)
    {
        var parts = (path ?? "").Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries);
        return parts.Length == 0 ? "" : Clean(parts[^1], 48);
    }

    public static string FirstLine(string text)
    {
        foreach (var line in (text ?? "").Split('\n'))
        {
            var cleaned = Clean(line.TrimStart('#', '*', '-', '>', '`', ' ', '\t'), MaxTextLength);
            if (cleaned.Length > 0)
            {
                return cleaned;
            }
        }

        return "";
    }

    // One line of plain text: no control characters, runs of space made one, cut to length.
    public static string Clean(string text, int maxLength)
    {
        var builder = new StringBuilder();
        var lastWasSpace = true;
        foreach (var character in text ?? "")
        {
            if (char.IsControl(character) || char.IsWhiteSpace(character))
            {
                if (!lastWasSpace)
                {
                    builder.Append(' ');
                    lastWasSpace = true;
                }

                continue;
            }

            builder.Append(character);
            lastWasSpace = false;
            if (builder.Length >= maxLength + 1)
            {
                break;
            }
        }

        var cleaned = builder.ToString().Trim();
        return cleaned.Length > maxLength ? cleaned[..(maxLength - 1)].TrimEnd() + "…" : cleaned;
    }
}
