using System.Text;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

[TestFixture]
public sealed class ClaudeCodeServiceTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 23, 20, 0, 0, TimeSpan.Zero);

    private static ClaudeCodeEvent Report(string name, string session = "session-one-0001")
    {
        return new ClaudeCodeEvent { Name = name, SessionId = session, Cwd = @"C:\Users\someone\code\auxora" };
    }

    [Test]
    public void Parse_KeepsOnlyTheFieldsTheDashboardShows()
    {
        var json = """
            {"session_id":"abc123","transcript_path":"C:\\Users\\someone\\.claude\\t.jsonl","cwd":"C:\\Users\\someone\\code\\auxora",
             "permission_mode":"default","hook_event_name":"PermissionRequest","tool_name":"Bash",
             "tool_input":{"command":"git push origin main","description":"Push the branch","timeout":120000,"nested":{"command":"not this one"}},
             "permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash"}]}]}
            """;
        var report = ClaudeCodeEvent.Parse(Encoding.UTF8.GetBytes(json));

        Assert.That(report, Is.Not.Null);
        Assert.That(report!.Name, Is.EqualTo("PermissionRequest"));
        Assert.That(report.SessionId, Is.EqualTo("abc123"));
        Assert.That(report.Cwd, Is.EqualTo(@"C:\Users\someone\code\auxora"));
        Assert.That(report.ToolName, Is.EqualTo("Bash"));
        Assert.That(report.Command, Is.EqualTo("git push origin main"));
        Assert.That(report.Description, Is.EqualTo("Push the branch"));
    }

    [Test]
    public void Parse_ReadsWhatCameBeforeTheCutWhenTheBodyIsCutOff()
    {
        var json = "{\"session_id\":\"abc123\",\"cwd\":\"/home/someone/auxora\",\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Read\","
            + "\"tool_input\":{\"file_path\":\"/home/someone/auxora/big.txt\"},\"tool_response\":{\"content\":\"" + new string('x', 5000);
        var report = ClaudeCodeEvent.Parse(Encoding.UTF8.GetBytes(json));

        Assert.That(report, Is.Not.Null);
        Assert.That(report!.Name, Is.EqualTo("PostToolUse"));
        Assert.That(report.SessionId, Is.EqualTo("abc123"));
        Assert.That(report.FilePath, Is.EqualTo("/home/someone/auxora/big.txt"));
    }

    [Test]
    public void Parse_GivesNothingForWhatIsNotAReport()
    {
        Assert.That(ClaudeCodeEvent.Parse(Encoding.UTF8.GetBytes("")), Is.Null);
        Assert.That(ClaudeCodeEvent.Parse(Encoding.UTF8.GetBytes("not json")), Is.Null);
        Assert.That(ClaudeCodeEvent.Parse(Encoding.UTF8.GetBytes("[1,2,3]")), Is.Null);
        Assert.That(ClaudeCodeEvent.Parse(Encoding.UTF8.GetBytes("{\"hook_event_name\":\"Stop\"}")), Is.Null, "no session");
        Assert.That(ClaudeCodeEvent.Parse(Encoding.UTF8.GetBytes("{\"session_id\":\"abc\"}")), Is.Null, "no event");
        Assert.That(ClaudeCodeEvent.Parse(Encoding.UTF8.GetBytes("{\"session_id\":7,\"hook_event_name\":true}")), Is.Null);
    }

    [Test]
    public void ASessionMovesFromWorkingToWaitingAndBackWhenTheToolRuns()
    {
        var service = new ClaudeCodeService();
        service.Record(Report("UserPromptSubmit"), Start);
        var ask = Report("PermissionRequest");
        ask.ToolName = "Bash";
        ask.Command = "git push origin main";
        service.Record(ask, Start.AddSeconds(30));

        var waiting = service.Snapshot(Start.AddSeconds(42)).Sessions.Single();
        Assert.That(waiting.State, Is.EqualTo("waiting"));
        Assert.That(waiting.Text, Is.EqualTo("Run: git push origin main"));
        Assert.That(waiting.Project, Is.EqualTo("auxora"));
        Assert.That(waiting.StateSeconds, Is.EqualTo(12));
        Assert.That(waiting.Id, Is.EqualTo("session-"));

        var ran = Report("PostToolUse");
        ran.ToolName = "Bash";
        ran.Command = "git push origin main";
        service.Record(ran, Start.AddSeconds(50));
        var working = service.Snapshot(Start.AddSeconds(51)).Sessions.Single();
        Assert.That(working.State, Is.EqualTo("working"));
        Assert.That(working.Text, Is.EqualTo("Ran: git push origin main"));
        Assert.That(working.StateSeconds, Is.EqualTo(1));

        // Each tool after that changes the line but not how long the session has been working.
        var edited = Report("PostToolUse");
        edited.ToolName = "Edit";
        edited.FilePath = @"C:\Users\someone\code\auxora\js\dashboard.js";
        service.Record(edited, Start.AddSeconds(70));
        var moving = service.Snapshot(Start.AddSeconds(75)).Sessions.Single();
        Assert.That(moving.Text, Is.EqualTo("Edited: dashboard.js"));
        Assert.That(moving.StateSeconds, Is.EqualTo(25));
        Assert.That(moving.IdleSeconds, Is.EqualTo(5));

        var stop = Report("Stop");
        stop.LastAssistantMessage = "\n## Pushed the branch.\nNext I would open the pull request.";
        service.Record(stop, Start.AddSeconds(90));
        var done = service.Snapshot(Start.AddSeconds(95)).Sessions.Single();
        Assert.That(done.State, Is.EqualTo("done"));
        Assert.That(done.Text, Is.EqualTo("Pushed the branch."));

        service.Record(Report("SessionEnd"), Start.AddSeconds(100));
        Assert.That(service.Snapshot(Start.AddSeconds(101)).Sessions, Is.Empty);
    }

    [Test]
    public void TheSixSecondNoticeDoesNotReplaceWhatWasAlreadyAsked()
    {
        var notice = Report("Notification");
        notice.NotificationType = "permission_prompt";
        notice.Message = "Claude needs your permission to use Bash";

        Assert.That(ClaudeCodeService.Next("waiting", "Run: npm test", notice, out var kept), Is.EqualTo("waiting"));
        Assert.That(kept, Is.EqualTo("Run: npm test"));
        Assert.That(ClaudeCodeService.Next("working", "", notice, out var fresh), Is.EqualTo("waiting"));
        Assert.That(fresh, Is.EqualTo("Claude needs your permission to use Bash"));
    }

    [Test]
    public void QuestionsPlansAndErrorsEachHaveTheirOwnLine()
    {
        var question = Report("PreToolUse");
        question.ToolName = "AskUserQuestion";
        Assert.That(ClaudeCodeService.Next("working", "", question, out var asked), Is.EqualTo("waiting"));
        Assert.That(asked, Is.EqualTo("Has a question for you"));

        var plan = Report("PreToolUse");
        plan.ToolName = "ExitPlanMode";
        Assert.That(ClaudeCodeService.Next("working", "", plan, out var planned), Is.EqualTo("waiting"));
        Assert.That(planned, Is.EqualTo("Has a plan for you to review"));

        Assert.That(ClaudeCodeService.Next("working", "", Report("StopFailure"), out var failed), Is.EqualTo("error"));
        Assert.That(failed, Is.EqualTo("Stopped on an error"));

        var idle = Report("Notification");
        idle.NotificationType = "idle_prompt";
        Assert.That(ClaudeCodeService.Next("waiting", "Run: npm test", idle, out _), Is.EqualTo("waiting"), "still waiting on the decision");
        Assert.That(ClaudeCodeService.Next("done", "All set.", Report("PostToolUse"), out var stray), Is.EqualTo("done"));
        Assert.That(stray, Is.EqualTo("All set."));
    }

    [Test]
    public void Ask_NamesTheFileButNeverItsFolder()
    {
        var edit = Report("PermissionRequest");
        edit.ToolName = "Edit";
        edit.FilePath = @"C:\Users\someone\code\auxora\js\dashboard.js";
        Assert.That(ClaudeCodeService.Ask(edit), Is.EqualTo("Edit: dashboard.js"));

        var tool = Report("PermissionRequest");
        tool.ToolName = "mcp__github__create_issue";
        Assert.That(ClaudeCodeService.Ask(tool), Is.EqualTo("Use github: create_issue"));

        Assert.That(ClaudeCodeService.Ask(Report("PermissionRequest")), Is.EqualTo("Needs your permission"));
        Assert.That(ClaudeCodeService.ProjectOf("/home/someone/code/auxora/"), Is.EqualTo("auxora"));
        Assert.That(ClaudeCodeService.ProjectOf(""), Is.Empty);
    }

    [Test]
    public void Did_SaysWhatJustHappenedAndWhenItFailed()
    {
        var test = Report("PostToolUseFailure");
        test.ToolName = "Bash";
        test.Command = "npm run check";
        Assert.That(ClaudeCodeService.Did(test, failed: false), Is.EqualTo("Ran: npm run check"));
        Assert.That(ClaudeCodeService.Did(test, failed: true), Is.EqualTo("Failed: npm run check"));
        Assert.That(ClaudeCodeService.Next("working", "", test, out var line), Is.EqualTo("working"));
        Assert.That(line, Is.EqualTo("Failed: npm run check"));

        var read = Report("PostToolUse");
        read.ToolName = "Read";
        read.FilePath = "/home/someone/auxora/README.md";
        Assert.That(ClaudeCodeService.Did(read, failed: false), Is.EqualTo("Read: README.md"));

        var search = Report("PostToolUse");
        search.ToolName = "WebSearch";
        Assert.That(ClaudeCodeService.Did(search, failed: false), Is.EqualTo("Used WebSearch"));
        Assert.That(ClaudeCodeService.Did(Report("PostToolUse"), failed: false), Is.Empty);
    }

    [Test]
    public void Clean_MakesOneShortLine()
    {
        Assert.That(ClaudeCodeService.Clean("  a\r\n\tb \u0007 c  ", 20), Is.EqualTo("a b c"));
        var longLine = ClaudeCodeService.Clean(new string('x', 500), 40);
        Assert.That(longLine.Length, Is.EqualTo(40));
        Assert.That(longLine, Does.EndWith("…"));
    }

    [Test]
    public void OldAndSurplusSessionsAreDropped()
    {
        var service = new ClaudeCodeService();
        for (var index = 0; index < ClaudeCodeService.MaxSessions + 3; index += 1)
        {
            service.Record(Report("UserPromptSubmit", "session-" + index), Start.AddSeconds(index));
        }

        Assert.That(service.Snapshot(Start.AddMinutes(1)).Sessions, Has.Count.EqualTo(ClaudeCodeService.MaxSessions));
        Assert.That(service.Snapshot(Start.AddHours(13)).Sessions, Is.Empty);
    }

    [Test]
    public void OnlyAPostWithNoWebOriginSkipsTheSessionToken()
    {
        Assert.That(BridgeManager.IsClaudeCodeHookRequest("POST", "/api/claude-code/event", null), Is.True);
        Assert.That(BridgeManager.IsClaudeCodeHookRequest("POST", "/api/claude-code/event", ""), Is.True);
        Assert.That(BridgeManager.IsClaudeCodeHookRequest("POST", "/api/claude-code/event", "http://127.0.0.1:8976"), Is.False);
        Assert.That(BridgeManager.IsClaudeCodeHookRequest("POST", "/api/claude-code/event", "https://example.com"), Is.False);
        Assert.That(BridgeManager.IsClaudeCodeHookRequest("POST", "/api/claude-code/event", "null"), Is.False);
        Assert.That(BridgeManager.IsClaudeCodeHookRequest("POST", "/api/claude-code/event/", null), Is.False);
        Assert.That(BridgeManager.IsClaudeCodeHookRequest("POST", "/api/config/reset", null), Is.False);
        Assert.That(BridgeManager.IsClaudeCodeHookRequest("DELETE", "/api/claude-code/event", null), Is.False);
    }
}
