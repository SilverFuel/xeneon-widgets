using System.Diagnostics;
using System.Globalization;
using System.Security.Principal;
using System.Text.Json.Serialization;

namespace XenonEdgeHost;

public sealed class GamePerformanceService : IDisposable
{
    private const string CaptureSessionName = "XenonGameFps";
    private const long MaxActiveCaptureBytes = 4 * 1024 * 1024;
    private const long MaxTelemetryDirectoryBytes = 32 * 1024 * 1024;
    private static readonly TimeSpan RestartCooldown = TimeSpan.FromSeconds(45);
    private static readonly TimeSpan ElevatedBootstrapGrace = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan MaxTelemetryFileAge = TimeSpan.FromHours(6);
    private readonly HostLogger _logger;
    private readonly ConfigStore _configStore;
    private readonly object _sync = new();
    private Process? _captureProcess;
    private int? _captureProcessId;
    private string _captureProcessName = "";
    private string _captureTargetName = "";
    private string _capturePath = "";
    private string _presentMonPath = "";
    private string _lastCaptureFailureMessage = "";
    private DateTimeOffset _lastStartAttemptAt = DateTimeOffset.MinValue;
    private DateTimeOffset _captureStartedAt = DateTimeOffset.MinValue;
    private bool _captureUsesElevatedBootstrap;
    private bool _elevationDeclined;
    private bool _captureNeedsAdminRestart;
    private bool _warnedMissingPresentMon;

    public GamePerformanceService(HostLogger logger, ConfigStore configStore)
    {
        _logger = logger;
        _configStore = configStore;
        PruneTelemetryFiles();
    }

    public GamePerformanceSnapshot EnsureSession(GameActivitySnapshot activity)
    {
        lock (_sync)
        {
            ClearElevationDeclinedCore();
            var game = activity.ActiveGame;
            var processId = game?.ProcessId;
            if (game is null || processId is null || processId <= 0)
            {
                StopCapture();
                return GamePerformanceSnapshot.Idle(game?.ProcessName ?? "");
            }

            EnsureCapture(processId.Value, game.ProcessName);
            return ReadCaptureSnapshot(processId.Value, game.ProcessName);
        }
    }

    public GamePerformanceSnapshot GetSnapshot(GameActivitySnapshot activity)
    {
        lock (_sync)
        {
            var game = activity.ActiveGame;
            var processId = game?.ProcessId;
            if (game is null || processId is null || processId <= 0)
            {
                return GamePerformanceSnapshot.Idle(game?.ProcessName ?? "");
            }

            if (_captureProcessId != processId.Value)
            {
                var source = string.IsNullOrWhiteSpace(ResolvePresentMonPath()) ? "not linked" : "NVIDIA PresentMon";
                return GamePerformanceSnapshot.Unavailable(
                    processId.Value,
                    game.ProcessName,
                    source,
                    "Start a Game Mode performance session to capture main-display FPS.");
            }

            return ReadCaptureSnapshot(processId.Value, game.ProcessName);
        }
    }

    public void Dispose()
    {
        lock (_sync)
        {
            StopCapture();
        }
    }

    public void ClearElevationDeclined()
    {
        lock (_sync)
        {
            ClearElevationDeclinedCore();
        }
    }

    private void EnsureCapture(int processId, string processName)
    {
        var captureTargetName = ResolveCaptureTargetName(processId, processName);
        if (_captureProcessId == processId
            && string.Equals(_captureTargetName, captureTargetName, StringComparison.OrdinalIgnoreCase)
            && _captureProcess is not null
            && !_captureProcess.HasExited)
        {
            return;
        }

        if (DateTimeOffset.UtcNow - _lastStartAttemptAt < RestartCooldown)
        {
            return;
        }

        if (_captureNeedsAdminRestart && !IsRunningElevated())
        {
            _lastCaptureFailureMessage = "FPS capture needs administrator capture access. Click Fix FPS (admin) to restart Auxora with capture access.";
            return;
        }

        if (IsRunningElevated())
        {
            _captureNeedsAdminRestart = false;
        }

        StopCapture();
        _lastStartAttemptAt = DateTimeOffset.UtcNow;

        var presentMonPath = ResolvePresentMonPath();
        if (string.IsNullOrWhiteSpace(presentMonPath))
        {
            if (!_warnedMissingPresentMon)
            {
                _warnedMissingPresentMon = true;
                _logger.Warn("NVIDIA PresentMon was not found; Game Mode FPS telemetry is unavailable.");
            }
            return;
        }

        var telemetryDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "XenonEdgeHost",
            "Telemetry");
        Directory.CreateDirectory(telemetryDirectory);
        PruneTelemetryFiles();
        _capturePath = Path.Combine(telemetryDirectory, $"presentmon-{processId}-{Guid.NewGuid():N}.csv");
        _captureProcessId = processId;
        _captureProcessName = processName ?? "";
        _captureTargetName = captureTargetName;
        _captureStartedAt = DateTimeOffset.UtcNow;
        _captureUsesElevatedBootstrap = false;
        _lastCaptureFailureMessage = "";
        var useElevatedBootstrap = _captureUsesElevatedBootstrap && !_elevationDeclined;

        try
        {
            var arguments = new List<string>
            {
                "--session_name", Quote(CaptureSessionName),
                "--stop_existing_session"
            };
            if (useElevatedBootstrap)
            {
                arguments.Add("--restart_as_admin");
            }

            if (!string.IsNullOrWhiteSpace(captureTargetName))
            {
                arguments.AddRange(new[]
                {
                    "--process_name", Quote(captureTargetName)
                });
            }
            else
            {
                arguments.AddRange(new[]
                {
                    "--process_id", processId.ToString(CultureInfo.InvariantCulture)
                });
            }

            arguments.AddRange(new[]
            {
                "--output_file", Quote(_capturePath),
                "--exclude_dropped",
                "--no_console_stats",
                "--no_track_gpu",
                "--no_track_input",
                "--terminate_on_proc_exit"
            });

            var info = new ProcessStartInfo
            {
                FileName = presentMonPath,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                Arguments = string.Join(' ', arguments)
            };

            _captureProcess = Process.Start(info);
            _captureUsesElevatedBootstrap = useElevatedBootstrap;
            _logger.Info(_captureUsesElevatedBootstrap
                ? $"Requested elevated PresentMon FPS capture for {DescribeCaptureTarget(processId, captureTargetName)}."
                : $"Started PresentMon FPS capture for {DescribeCaptureTarget(processId, captureTargetName)}.");
        }
        catch (Exception error)
        {
            _captureProcess = null;
            _captureUsesElevatedBootstrap = false;
            _lastCaptureFailureMessage = "PresentMon could not start. Check NVIDIA FrameView and capture permissions.";
            _logger.Warn($"Failed to start PresentMon FPS capture: {error.Message}");
        }
    }

    private GamePerformanceSnapshot ReadCaptureSnapshot(int processId, string processName)
    {
        var source = string.IsNullOrWhiteSpace(ResolvePresentMonPath()) ? "not linked" : "NVIDIA PresentMon";

        if (_captureProcess is null)
        {
            var message = string.IsNullOrWhiteSpace(_lastCaptureFailureMessage)
                ? "PresentMon is not capturing this game yet."
                : _lastCaptureFailureMessage;
            return GamePerformanceSnapshot.Unavailable(processId, processName, source, message, NeedsAdminForCapture(message));
        }

        if (!string.IsNullOrWhiteSpace(_capturePath) && File.Exists(_capturePath))
        {
            try
            {
                var header = ReadCsvHeader(_capturePath);
                var rows = ReadRecentLines(_capturePath, 420);
                var analysis = AnalyzeCaptureRows(rows, header, processId, _captureTargetName);
                var frameTimes = analysis.FrameTimes;
                if (frameTimes.Count > 0)
                {
                    var averageFrameTime = frameTimes.Average();
                    var fps = 1000d / averageFrameTime;
                    TrimActiveCaptureIfNeeded();
                    return new GamePerformanceSnapshot
                    {
                        Supported = true,
                        Active = true,
                        Status = "live",
                        ProcessId = processId,
                        ProcessName = processName,
                        Fps = RoundMetric(fps),
                        FrameTimeMs = Math.Round(averageFrameTime, 1),
                        Source = source,
                        Readiness = "live",
                        FpsSource = source,
                        SampledAt = DateTimeOffset.UtcNow,
                        Message = "Main-display frame pacing is live from PresentMon."
                    };
                }

                if (!_captureProcess.HasExited)
                {
                    return GamePerformanceSnapshot.Starting(
                        processId,
                        processName,
                        source,
                        analysis.Message);
                }
            }
            catch (Exception error)
            {
                _logger.Warn($"Failed to read PresentMon FPS capture: {error.Message}");
                return GamePerformanceSnapshot.Unavailable(processId, processName, source, "PresentMon data could not be read.");
            }
        }

        if (_captureProcess.HasExited)
        {
            if (_captureUsesElevatedBootstrap && DateTimeOffset.UtcNow - _captureStartedAt < ElevatedBootstrapGrace)
            {
                return GamePerformanceSnapshot.Starting(
                    processId,
                    processName,
                    source,
                    "Waiting for Windows to approve elevated FPS capture.");
            }

            var message = DescribeStoppedCapture();
            return GamePerformanceSnapshot.Unavailable(processId, processName, source, message, NeedsAdminForCapture(message));
        }

        if (_captureUsesElevatedBootstrap && DateTimeOffset.UtcNow - _captureStartedAt >= ElevatedBootstrapGrace)
        {
            const string message = "Windows is still waiting for elevated FPS capture approval. Approve the admin prompt or click Fix FPS.";
            return GamePerformanceSnapshot.Unavailable(processId, processName, source, message, needsAdmin: true);
        }

        return GamePerformanceSnapshot.Starting(processId, processName, source);
    }

    private string ResolvePresentMonPath()
    {
        if (!string.IsNullOrWhiteSpace(_presentMonPath) && File.Exists(_presentMonPath))
        {
            return _presentMonPath;
        }

        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "NVIDIA Corporation", "FrameViewSDK", "bin", "PresentMon_x64.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "NVIDIA Corporation", "FrameViewSDK", "PresentMon_x64.exe")
        };

        _presentMonPath = candidates.FirstOrDefault(File.Exists) ?? "";
        return _presentMonPath;
    }

    private static string ResolveCaptureTargetName(int processId, string processName)
    {
        var name = "";
        try
        {
            using var process = Process.GetProcessById(processId);
            name = process.ProcessName;
        }
        catch
        {
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            name = processName ?? "";
        }

        name = Path.GetFileName(name.Trim());
        if (string.IsNullOrWhiteSpace(name))
        {
            return "";
        }

        return string.Equals(Path.GetExtension(name), ".exe", StringComparison.OrdinalIgnoreCase)
            ? name
            : name + ".exe";
    }

    private static string DescribeCaptureTarget(int processId, string processName)
    {
        return string.IsNullOrWhiteSpace(processName)
            ? $"PID {processId}"
            : $"{processName} (PID {processId})";
    }

    private void StopCapture()
    {
        if (_captureProcess is not null)
        {
            try
            {
                if (!_captureProcess.HasExited)
                {
                    _captureProcess.Kill(entireProcessTree: true);
                    _captureProcess.WaitForExit(1200);
                }
            }
            catch
            {
            }
            finally
            {
                _captureProcess.Dispose();
                _captureProcess = null;
            }
        }

        var capturePath = _capturePath;
        _captureProcessId = null;
        _captureProcessName = "";
        _captureTargetName = "";
        _capturePath = "";
        _captureStartedAt = DateTimeOffset.MinValue;
        _captureUsesElevatedBootstrap = false;
        CleanupCaptureFile(capturePath);
    }

    private void ClearElevationDeclinedCore()
    {
        if (!_elevationDeclined)
        {
            return;
        }

        _elevationDeclined = false;
        _captureNeedsAdminRestart = false;
        _lastStartAttemptAt = DateTimeOffset.MinValue;
        _lastCaptureFailureMessage = "";
    }

    private void CleanupCaptureFile(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || IsDiagnosticsRetentionEnabled())
        {
            return;
        }

        TryDeleteFile(path);
    }

    private void TrimActiveCaptureIfNeeded()
    {
        if (string.IsNullOrWhiteSpace(_capturePath) || IsDiagnosticsRetentionEnabled())
        {
            return;
        }

        try
        {
            var info = new FileInfo(_capturePath);
            if (info.Exists && info.Length > MaxActiveCaptureBytes)
            {
                _logger.Info("PresentMon capture reached the privacy size cap; rotating capture file.");
                StopCapture();
            }
        }
        catch
        {
        }
    }

    private void PruneTelemetryFiles()
    {
        try
        {
            var directory = GetTelemetryDirectory();
            if (!Directory.Exists(directory))
            {
                return;
            }

            var files = Directory.EnumerateFiles(directory, "presentmon-*.csv", SearchOption.TopDirectoryOnly)
                .Select(path => new FileInfo(path))
                .Where(file => file.Exists)
                .OrderByDescending(file => file.LastWriteTimeUtc)
                .ToList();
            var retainDiagnostics = IsDiagnosticsRetentionEnabled();
            var cutoff = DateTimeOffset.UtcNow.Subtract(MaxTelemetryFileAge);
            var totalBytes = 0L;

            foreach (var file in files)
            {
                var isActive = !string.IsNullOrWhiteSpace(_capturePath)
                    && string.Equals(file.FullName, _capturePath, StringComparison.OrdinalIgnoreCase);
                if (isActive)
                {
                    totalBytes += file.Length;
                    continue;
                }

                totalBytes += file.Length;
                if (!retainDiagnostics || file.LastWriteTimeUtc < cutoff.UtcDateTime || totalBytes > MaxTelemetryDirectoryBytes)
                {
                    TryDeleteFile(file.FullName);
                }
            }
        }
        catch (Exception error)
        {
            _logger.Warn($"Failed to prune PresentMon telemetry files: {error.Message}");
        }
    }

    private bool IsDiagnosticsRetentionEnabled()
    {
        return _configStore.Snapshot().Dashboard.GameTelemetryDiagnosticsRetention;
    }

    private static string GetTelemetryDirectory()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "XenonEdgeHost",
            "Telemetry");
    }

    private static void TryDeleteFile(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
        }
    }

    private string DescribeStoppedCapture()
    {
        if (!string.IsNullOrWhiteSpace(_lastCaptureFailureMessage))
        {
            return _lastCaptureFailureMessage;
        }

        var exitCode = 0;
        try
        {
            exitCode = _captureProcess?.ExitCode ?? 0;
        }
        catch
        {
        }

        if (_captureUsesElevatedBootstrap && !IsRunningElevated())
        {
            _elevationDeclined = true;
            _captureNeedsAdminRestart = true;
            _lastCaptureFailureMessage = "Windows did not approve elevated FPS capture. Click Fix FPS (admin) to restart Auxora as administrator.";
            return _lastCaptureFailureMessage;
        }

        if (exitCode != 0 && !IsRunningElevated())
        {
            _captureNeedsAdminRestart = true;
            _lastCaptureFailureMessage = "PresentMon stopped before reporting frames. Click Fix FPS (admin) to enable main-display FPS capture.";
            return _lastCaptureFailureMessage;
        }

        _lastCaptureFailureMessage = "PresentMon stopped before reporting frames; waiting before retry.";
        return _lastCaptureFailureMessage;
    }

    private static bool NeedsAdminForCapture(string message)
    {
        return !IsRunningElevated()
            && (message.Contains("administrator", StringComparison.OrdinalIgnoreCase)
                || message.Contains("capture permissions", StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsRunningElevated()
    {
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            var principal = new WindowsPrincipal(identity);
            return principal.IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }

    private static string ReadCsvHeader(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var reader = new StreamReader(stream);
        return reader.ReadLine() ?? "";
    }

    private static List<string> ReadRecentLines(string path, int maxLines)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var bytesToRead = (int)Math.Min(stream.Length, 192 * 1024);
        if (bytesToRead <= 0)
        {
            return [];
        }

        stream.Seek(-bytesToRead, SeekOrigin.End);
        using var reader = new StreamReader(stream);
        var text = reader.ReadToEnd();
        var lines = text.Split(["\r\n", "\n"], StringSplitOptions.RemoveEmptyEntries).ToList();
        if (stream.Length > bytesToRead && lines.Count > 0)
        {
            lines.RemoveAt(0);
        }

        return lines.Count <= maxLines ? lines : lines.TakeLast(maxLines).ToList();
    }

    private static CaptureAnalysis AnalyzeCaptureRows(
        IReadOnlyList<string> rows,
        string headerLine,
        int processId,
        string targetProcessName)
    {
        var columns = SplitCsvLine(headerLine);
        var applicationIndex = FindColumn(columns, "Application", "ProcessName", "Process");
        var processIndex = FindColumn(columns, "ProcessID", "ProcessId");
        var displayedIndex = FindColumn(columns, "MsBetweenDisplayChange");
        var presentIndex = FindColumn(columns, "MsBetweenPresents");
        var timeIndex = FindColumn(columns, "TimeInSeconds");
        var droppedIndex = FindColumn(columns, "Dropped");
        var result = new List<double>();
        var matchingRows = 0;
        double? previousTimeSeconds = null;

        if (string.IsNullOrWhiteSpace(headerLine))
        {
            return new CaptureAnalysis(result, "PresentMon is running; waiting for capture output.");
        }

        if (displayedIndex < 0 && presentIndex < 0 && timeIndex < 0)
        {
            return new CaptureAnalysis(result, "PresentMon is running, but its CSV does not include frame timing columns.");
        }

        foreach (var row in rows)
        {
            if (string.IsNullOrWhiteSpace(row) || row.StartsWith("Application,", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var values = SplitCsvLine(row);
            if (!CaptureRowMatches(values, applicationIndex, processIndex, processId, targetProcessName))
            {
                continue;
            }

            matchingRows++;

            if (droppedIndex >= 0
                && TryGetValue(values, droppedIndex, out var dropped)
                && string.Equals(dropped, "1", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var ms = TryReadPositiveDouble(values, displayedIndex) ?? TryReadPositiveDouble(values, presentIndex);
            if (ms is null
                && timeIndex >= 0
                && TryReadPositiveDouble(values, timeIndex) is { } timeSeconds)
            {
                if (previousTimeSeconds is not null)
                {
                    ms = (timeSeconds - previousTimeSeconds.Value) * 1000d;
                }

                previousTimeSeconds = timeSeconds;
            }

            if (ms is > 1 and < 1000)
            {
                result.Add(ms.Value);
            }
        }

        if (result.Count > 0)
        {
            return new CaptureAnalysis(result, "Main-display frame pacing is live from PresentMon.");
        }

        if (rows.Count == 0)
        {
            return new CaptureAnalysis(result, "PresentMon is running; waiting for the game to present frames.");
        }

        return matchingRows == 0
            ? new CaptureAnalysis(result, "PresentMon is running, but no matching game frames have been captured yet.")
            : new CaptureAnalysis(result, "PresentMon is running; waiting for usable displayed-frame timings.");
    }

    private static bool CaptureRowMatches(
        IReadOnlyList<string> values,
        int applicationIndex,
        int processIndex,
        int processId,
        string targetProcessName)
    {
        if (!string.IsNullOrWhiteSpace(targetProcessName)
            && applicationIndex >= 0
            && TryGetValue(values, applicationIndex, out var applicationName)
            && !ProcessNamesMatch(applicationName, targetProcessName))
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(targetProcessName)
            && processIndex >= 0
            && TryGetValue(values, processIndex, out var pidText)
            && int.TryParse(pidText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var rowProcessId)
            && rowProcessId != processId)
        {
            return false;
        }

        return true;
    }

    private static bool ProcessNamesMatch(string left, string right)
    {
        var normalizedLeft = Path.GetFileName(left.Trim());
        var normalizedRight = Path.GetFileName(right.Trim());
        return string.Equals(normalizedLeft, normalizedRight, StringComparison.OrdinalIgnoreCase)
            || string.Equals(Path.GetFileNameWithoutExtension(normalizedLeft), Path.GetFileNameWithoutExtension(normalizedRight), StringComparison.OrdinalIgnoreCase);
    }

    private static int FindColumn(IReadOnlyList<string> columns, params string[] names)
    {
        for (var index = 0; index < columns.Count; index++)
        {
            if (names.Any(name => string.Equals(columns[index], name, StringComparison.OrdinalIgnoreCase)))
            {
                return index;
            }
        }

        return -1;
    }

    private static bool TryGetValue(IReadOnlyList<string> values, int index, out string value)
    {
        if (index >= 0 && index < values.Count)
        {
            value = values[index].Trim();
            return true;
        }

        value = "";
        return false;
    }

    private static double? TryReadPositiveDouble(IReadOnlyList<string> values, int index)
    {
        return TryGetValue(values, index, out var text)
            && double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            && value > 0
            ? value
            : null;
    }

    private static List<string> SplitCsvLine(string line)
    {
        var values = new List<string>();
        var value = new System.Text.StringBuilder();
        var quoted = false;

        foreach (var ch in line)
        {
            if (ch == '"')
            {
                quoted = !quoted;
                continue;
            }

            if (ch == ',' && !quoted)
            {
                values.Add(value.ToString());
                value.Clear();
                continue;
            }

            value.Append(ch);
        }

        values.Add(value.ToString());
        return values;
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"", StringComparison.Ordinal) + "\"";
    }

    private static double RoundMetric(double value)
    {
        return Math.Round(Math.Clamp(value, 0, 1000), value >= 100 ? 0 : 1);
    }

    private readonly record struct CaptureAnalysis(List<double> FrameTimes, string Message);
}

public sealed class GamePerformanceSnapshot
{
    public bool Supported { get; set; } = true;

    public bool Active { get; set; }

    public string Status { get; set; } = "idle";

    public bool Stale { get; set; }

    [JsonIgnore]
    public int? ProcessId { get; set; }

    [JsonIgnore]
    public string ProcessName { get; set; } = "";

    public double? Fps { get; set; }

    public double? FrameTimeMs { get; set; }

    public string Source { get; set; } = "NVIDIA PresentMon";

    public string FpsSource { get; set; } = "NVIDIA PresentMon";

    public string Readiness { get; set; } = "idle";

    public bool NeedsAdmin { get; set; }

    public bool CanRestartAsAdmin { get; set; }

    public string RestartAsAdminEndpoint { get; set; } = "/api/system/restart-admin";

    public DateTimeOffset? SampledAt { get; set; }

    public string Message { get; set; } = "";

    public static GamePerformanceSnapshot Idle(string processName)
    {
        return new GamePerformanceSnapshot
        {
            Status = "idle",
            ProcessName = processName,
            Source = "NVIDIA PresentMon",
            FpsSource = "NVIDIA PresentMon",
            Readiness = "idle",
            SampledAt = DateTimeOffset.UtcNow,
            Message = "Start a game to capture main-display FPS."
        };
    }

    public static GamePerformanceSnapshot Starting(int processId, string processName, string source, string? message = null)
    {
        return new GamePerformanceSnapshot
        {
            Active = true,
            Status = "starting",
            ProcessId = processId,
            ProcessName = processName,
            Source = source,
            FpsSource = source,
            Readiness = "starting",
            SampledAt = DateTimeOffset.UtcNow,
            Message = string.IsNullOrWhiteSpace(message) ? "Waiting for game frames." : message
        };
    }

    public static GamePerformanceSnapshot Unavailable(int processId, string processName, string source, string message, bool needsAdmin = false)
    {
        return new GamePerformanceSnapshot
        {
            Active = true,
            Status = "unavailable",
            Stale = true,
            ProcessId = processId,
            ProcessName = processName,
            Source = source,
            FpsSource = source,
            Readiness = needsAdmin ? "needs-admin" : string.Equals(source, "not linked", StringComparison.OrdinalIgnoreCase) ? "not-linked" : "unavailable",
            NeedsAdmin = needsAdmin,
            CanRestartAsAdmin = needsAdmin,
            SampledAt = DateTimeOffset.UtcNow,
            Message = message
        };
    }
}
