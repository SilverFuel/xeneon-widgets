using System.Diagnostics;

namespace XenonEdgeHost;

// TMOG remains a separately installed application. No binaries, licences, or
// private TMOG settings are copied or used as a telemetry source.
public sealed class TmogCompanionService
{
    private readonly string[] _installRoots;
    private readonly Func<string, string?> _readVersion;
    private readonly Action<string> _launch;

    public TmogCompanionService() : this(
        [Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
         Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
         Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs")],
        ReadTmogVersion,
        LaunchExecutable)
    {
    }

    internal TmogCompanionService(IEnumerable<string> installRoots, Func<string, string?> readVersion, Action<string> launch)
    {
        _installRoots = installRoots.Where(root => !string.IsNullOrWhiteSpace(root)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        _readVersion = readVersion;
        _launch = launch;
    }

    public TmogCompanionSnapshot GetSnapshot()
    {
        var installation = FindInstallation();
        return new TmogCompanionSnapshot
        {
            Installed = installation.HasValue,
            Version = installation?.Version ?? "",
            Message = installation.HasValue
                ? "Open TMOG for processes and advanced inspection."
                : "TMOG was not found in a standard installation folder. Live monitoring still works in Auxora."
        };
    }

    public void Open()
    {
        var installation = FindInstallation()
            ?? throw new InvalidOperationException("TMOG is not installed in a standard installation folder. Install it from tmog.org, then refresh this page.");
        _launch(installation.Path);
    }

    private (string Path, string Version)? FindInstallation()
    {
        foreach (var root in _installRoots)
        {
            foreach (var fileName in new[] { "Task Manager Launcher.exe", "Task Manager.exe" })
            {
                var path = Path.Combine(root, "Task Manager TMOG", fileName);
                try
                {
                    var version = _readVersion(path);
                    if (!string.IsNullOrWhiteSpace(version)) return (path, version);
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
                {
                    // An inaccessible candidate is not an installed, launchable app.
                }
            }
        }
        return null;
    }

    private static string? ReadTmogVersion(string path)
    {
        if (!File.Exists(path)) return null;
        var info = FileVersionInfo.GetVersionInfo(path);
        return string.Equals(info.ProductName, "Task Manager TMOG", StringComparison.OrdinalIgnoreCase)
            ? info.ProductVersion : null;
    }

    private static void LaunchExecutable(string path)
    {
        if (Process.Start(new ProcessStartInfo
        {
            FileName = path,
            WorkingDirectory = Path.GetDirectoryName(path)!,
            UseShellExecute = true
        }) is null)
        {
            throw new InvalidOperationException("Windows could not open TMOG. Try opening it from the Start menu.");
        }
    }
}

public sealed class TmogCompanionSnapshot
{
    public bool Installed { get; set; }
    public string Version { get; set; } = "";
    public string Message { get; set; } = "";
}
