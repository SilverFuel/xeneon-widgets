using System.Diagnostics;
using System.Globalization;
using System.Security.Principal;

namespace XenonEdgeHost;

public sealed class GamePerformanceService : IDisposable
{
    private const string CaptureSessionName = "XenonGameFps";
    private static readonly TimeSpan RestartCooldown = TimeSpan.FromSeconds(45);
    private readonly HostLogger _logger;
    private readonly object _sync = new();
    private Process? _captureProcess;
    private int? _captureProcessId;
    private string _captureProcessName = "";
    private string _capturePath = "";
    private string _presentMonPath = "";
    private string _lastCaptureFailureMessage = "";
    private DateTimeOffset _lastStartAttemptAt = DateTimeOffset.MinValue;
    private bool _warnedMissingPresentMon;

    public GamePerformanceService(HostLogger logger)
    {
        _logger = logger;
    }

    public GamePerformanceSnapshot EnsureSession(GameActivitySnapshot activity)
    {
        lock (_sync)
        {
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

    private void EnsureCapture(int processId, string processName)
    {
        if (_captureProcessId == processId
            && _captureProcess is not null
            && !_captureProcess.HasExited)
        {
            return;
        }

        if (DateTimeOffset.UtcNow - _lastStartAttemptAt < RestartCooldown)
        {
            return;
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
        _capturePath = Path.Combine(telemetryDirectory, $"presentmon-{processId}-{Guid.NewGuid():N}.csv");
        _captureProcessId = processId;
        _captureProcessName = processName ?? "";
        _lastCaptureFailureMessage = "";

        try
        {
            var info = new ProcessStartInfo
            {
                FileName = presentMonPath,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                Arguments = string.Join(' ', new[]
                {
                    "--session_name", Quote(CaptureSessionName),
                    "--stop_existing_session",
                    "--process_id", processId.ToString(CultureInfo.InvariantCulture),
                    "--output_file", Quote(_capturePath),
                    "--exclude_dropped",
                    "--no_console_stats",
                    "--no_track_gpu",
                    "--no_track_input",
                    "--terminate_on_proc_exit"
                })
            };

            _captureProcess = Process.Start(info);
            _logger.Info($"Started PresentMon FPS capture for PID {processId}.");
        }
        catch (Exception error)
        {
            _captureProcess = null;
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

        if (_captureProcess.HasExited)
        {
            var message = DescribeStoppedCapture();
            return GamePerformanceSnapshot.Unavailable(processId, processName, source, message, NeedsAdminForCapture(message));
        }

        if (string.IsNullOrWhiteSpace(_capturePath) || !File.Exists(_capturePath))
        {
            return GamePerformanceSnapshot.Starting(processId, processName, source);
        }

        try
        {
            var header = ReadCsvHeader(_capturePath);
            var rows = ReadRecentLines(_capturePath, 420);
            var frameTimes = ExtractFrameTimes(rows, header, processId);
            if (frameTimes.Count == 0)
            {
                return GamePerformanceSnapshot.Starting(processId, processName, source);
            }

            var averageFrameTime = frameTimes.Average();
            var fps = 1000d / averageFrameTime;
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
        catch (Exception error)
        {
            _logger.Warn($"Failed to read PresentMon FPS capture: {error.Message}");
            return GamePerformanceSnapshot.Unavailable(processId, processName, source, "PresentMon data could not be read.");
        }
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

        _captureProcessId = null;
        _captureProcessName = "";
        _capturePath = "";
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

        if (exitCode != 0 && !IsRunningElevated())
        {
            _lastCaptureFailureMessage = "PresentMon stopped before reporting frames. Start Xenon as administrator to enable main-display FPS capture.";
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

    private static List<double> ExtractFrameTimes(IReadOnlyList<string> rows, string headerLine, int processId)
    {
        var columns = SplitCsvLine(headerLine);
        var processIndex = FindColumn(columns, "ProcessID", "ProcessId");
        var displayedIndex = FindColumn(columns, "MsBetweenDisplayChange");
        var presentIndex = FindColumn(columns, "MsBetweenPresents");
        var droppedIndex = FindColumn(columns, "Dropped");
        var result = new List<double>();

        if (displayedIndex < 0 && presentIndex < 0)
        {
            return result;
        }

        foreach (var row in rows)
        {
            if (string.IsNullOrWhiteSpace(row) || row.StartsWith("Application,", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var values = SplitCsvLine(row);
            if (processIndex >= 0
                && TryGetValue(values, processIndex, out var pidText)
                && int.TryParse(pidText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var rowProcessId)
                && rowProcessId != processId)
            {
                continue;
            }

            if (droppedIndex >= 0
                && TryGetValue(values, droppedIndex, out var dropped)
                && string.Equals(dropped, "1", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var ms = TryReadPositiveDouble(values, displayedIndex) ?? TryReadPositiveDouble(values, presentIndex);
            if (ms is > 1 and < 1000)
            {
                result.Add(ms.Value);
            }
        }

        return result;
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
}

public sealed class GamePerformanceSnapshot
{
    public bool Supported { get; set; } = true;

    public bool Active { get; set; }

    public string Status { get; set; } = "idle";

    public bool Stale { get; set; }

    public int? ProcessId { get; set; }

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

    public static GamePerformanceSnapshot Starting(int processId, string processName, string source)
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
            Message = "Waiting for game frames."
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
