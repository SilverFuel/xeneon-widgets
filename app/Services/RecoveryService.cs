using System.Diagnostics;

namespace XenonEdgeHost;

public sealed class RecoveryService
{
    private readonly HostLogger _logger;
    private readonly string _applicationDirectory;
    private readonly IRecoveryProcessLauncher _processLauncher;

    public RecoveryService(HostLogger logger)
        : this(logger, AppContext.BaseDirectory, new RecoveryProcessLauncher())
    {
    }

    internal RecoveryService(
        HostLogger logger,
        string applicationDirectory,
        IRecoveryProcessLauncher processLauncher)
    {
        _logger = logger;
        _applicationDirectory = Path.GetFullPath(applicationDirectory);
        _processLauncher = processLauncher;
    }

    public event Action? QuitRequested;

    public RecoverySnapshot GetSnapshot()
    {
        var repairScript = GetInstalledScriptPath("repair.ps1");
        var safeModeScript = GetInstalledScriptPath("Launch-XenonSafeMode.ps1");
        var logDirectory = Path.GetDirectoryName(_logger.LogPath) ?? "";
        var display = DisplayManager.BuildDiagnostics();
        var waitingForCompanion = display.CompanionDisplayCount == 0;

        return new RecoverySnapshot
        {
            Status = waitingForCompanion ? "waiting-for-companion-display" : "ready",
            Message = waitingForCompanion
                ? "Auxora is staying hidden because no companion display is active. Connect or extend a non-primary display, then choose Show Auxora Display from the tray."
                : "Recovery actions use the installed Auxora support files when they are available.",
            Actions =
            [
                RecoveryAction.CreateAvailable("retry", "Retry", "Reload the dashboard in this window."),
                RecoveryAction.FromPath("repair", "Repair", "Run the installed per-user repair script.", repairScript),
                RecoveryAction.FromPath("safe-mode", "Restart in Safe Mode", "Restart Auxora on an available companion display with saved display selection ignored.", safeModeScript),
                RecoveryAction.FromPath("open-logs", "Open Logs", "Open the local Auxora log folder.", Directory.Exists(logDirectory) ? logDirectory : null),
                RecoveryAction.CreateAvailable("quit", "Quit", "Close Auxora completely.")
            ]
        };
    }

    public RecoveryActionResult Execute(string? actionId)
    {
        var id = actionId?.Trim().ToLowerInvariant() ?? "";
        var action = GetSnapshot().Actions.FirstOrDefault(candidate => string.Equals(candidate.Id, id, StringComparison.Ordinal));
        if (action is null)
        {
            throw new InvalidOperationException("Unknown recovery action.");
        }

        if (!action.Available)
        {
            return RecoveryActionResult.Unavailable(action.Id, action.Message);
        }

        switch (id)
        {
            case "retry":
                return RecoveryActionResult.Completed(id, "Reload the dashboard to retry.");
            case "repair":
                LaunchPowerShellScript(action.Path);
                return RecoveryActionResult.Completed(id, "The installed repair tool was started.");
            case "safe-mode":
                LaunchPowerShellScript(action.Path);
                return RecoveryActionResult.Completed(id, "Safe Mode restart was started.");
            case "open-logs":
                _processLauncher.Start(new ProcessStartInfo
                {
                    FileName = action.Path,
                    UseShellExecute = true
                });
                return RecoveryActionResult.Completed(id, "The Auxora log folder was opened.");
            case "quit":
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    Thread.Sleep(250);
                    QuitRequested?.Invoke();
                });
                return RecoveryActionResult.Completed(id, "Auxora is quitting.");
            default:
                throw new InvalidOperationException("Unknown recovery action.");
        }
    }

    private void LaunchPowerShellScript(string scriptPath)
    {
        var powershell = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe");
        if (!File.Exists(powershell))
        {
            throw new InvalidOperationException("Windows PowerShell is unavailable on this PC.");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = powershell,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = _applicationDirectory
        };
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(scriptPath);
        startInfo.ArgumentList.Add("-Quiet");
        _processLauncher.Start(startInfo);
    }

    private string? GetInstalledScriptPath(string fileName)
    {
        var candidate = Path.GetFullPath(Path.Combine(_applicationDirectory, fileName));
        if (!candidate.StartsWith(_applicationDirectory, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        return File.Exists(candidate) ? candidate : null;
    }
}

internal interface IRecoveryProcessLauncher
{
    void Start(ProcessStartInfo startInfo);
}

internal sealed class RecoveryProcessLauncher : IRecoveryProcessLauncher
{
    public void Start(ProcessStartInfo startInfo)
    {
        Process.Start(startInfo);
    }
}

public sealed class RecoverySnapshot
{
    public string Status { get; set; } = "unavailable";

    public string Message { get; set; } = "";

    public List<RecoveryAction> Actions { get; set; } = [];
}

public sealed class RecoveryAction
{
    public string Id { get; set; } = "";

    public string Label { get; set; } = "";

    public bool Available { get; set; }

    public string Message { get; set; } = "";

    public string Path { get; set; } = "";

    public static RecoveryAction CreateAvailable(string id, string label, string message) => new()
    {
        Id = id,
        Label = label,
        Available = true,
        Message = message
    };

    public static RecoveryAction FromPath(string id, string label, string message, string? path) => new()
    {
        Id = id,
        Label = label,
        Available = !string.IsNullOrWhiteSpace(path),
        Message = string.IsNullOrWhiteSpace(path)
            ? "Unavailable in this unpackaged development run. Install Auxora to use this action."
            : message,
        Path = path ?? ""
    };
}

public sealed class RecoveryActionResult
{
    public bool Ok { get; set; }

    public string Action { get; set; } = "";

    public string Status { get; set; } = "unavailable";

    public string Message { get; set; } = "";

    public static RecoveryActionResult Completed(string action, string message) => new()
    {
        Ok = true,
        Action = action,
        Status = "started",
        Message = message
    };

    public static RecoveryActionResult Unavailable(string action, string message) => new()
    {
        Ok = false,
        Action = action,
        Status = "unavailable",
        Message = message
    };
}

public sealed class RecoveryActionRequest
{
    public string? Action { get; set; }
}
