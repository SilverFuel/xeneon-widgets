namespace XenonEdgeHost;

public sealed class HostLogger : IDisposable
{
    private readonly string _logPath;
    private readonly object _writeLock = new();
    private bool _disposed;

    public HostLogger(string logDirectory)
    {
        Directory.CreateDirectory(logDirectory);
        _logPath = Path.Combine(logDirectory, "host.log");
        TrimLogFile();
    }

    public string LogPath => _logPath;

    public void Info(string message)
    {
        WriteEntry("INFO", message);
    }

    public void Warn(string message)
    {
        WriteEntry("WARN", message);
    }

    public void Error(string message, Exception? exception = null)
    {
        var text = exception is null
            ? message
            : $"{message} — {exception.GetType().Name}: {exception.Message}";
        WriteEntry("ERROR", text);
    }

    public void Dispose()
    {
        _disposed = true;
    }

    private void WriteEntry(string level, string message)
    {
        if (_disposed)
        {
            return;
        }

        var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        var line = $"[{timestamp}] [{level}] {message}";

        lock (_writeLock)
        {
            try
            {
                File.AppendAllText(_logPath, line + Environment.NewLine);
            }
            catch
            {
            }
        }
    }

    private void TrimLogFile()
    {
        const long maxBytes = 512 * 1024;

        try
        {
            if (!File.Exists(_logPath))
            {
                return;
            }

            var info = new FileInfo(_logPath);
            if (info.Length <= maxBytes)
            {
                return;
            }

            var lines = File.ReadAllLines(_logPath);
            var keepFrom = Math.Max(0, lines.Length - 500);
            File.WriteAllLines(_logPath, lines[keepFrom..]);
        }
        catch
        {
        }
    }
}
