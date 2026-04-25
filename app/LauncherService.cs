using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;

namespace XenonEdgeHost;

public sealed class LauncherService
{
    public LauncherSnapshot GetSnapshot(AppConfig config)
    {
        var entries = (config.Launchers ?? [])
            .Select(MapEntry)
            .ToList();
        var sampledAt = DateTimeOffset.UtcNow;

        return new LauncherSnapshot
        {
            Supported = true,
            Configured = entries.Count > 0,
            Status = entries.Count > 0 ? "live" : "setup",
            SampledAt = sampledAt,
            Stale = false,
            Message = entries.Count > 0
                ? $"{entries.Count} app launcher entr{(entries.Count == 1 ? "y is" : "ies are")} ready."
                : "Add apps or shortcuts to build your launcher grid.",
            Source = "config",
            Entries = entries
        };
    }

    public List<LauncherEntryConfig> NormalizeEntries(IEnumerable<LauncherEntryRequest>? entries)
    {
        var normalized = new List<LauncherEntryConfig>();
        foreach (var entry in entries ?? [])
        {
            var executablePath = entry.ExecutablePath?.Trim() ?? "";
            if (string.IsNullOrWhiteSpace(executablePath))
            {
                continue;
            }

            normalized.Add(new LauncherEntryConfig
            {
                Id = string.IsNullOrWhiteSpace(entry.Id) ? Guid.NewGuid().ToString("N") : entry.Id.Trim(),
                DisplayName = ResolveDisplayName(executablePath, entry.DisplayName),
                IconPath = entry.IconPath?.Trim() ?? "",
                ExecutablePath = executablePath,
                Arguments = entry.Arguments?.Trim() ?? ""
            });
        }

        return normalized;
    }

    public LauncherLaunchResult Launch(AppConfig config, string? id)
    {
        var entry = FindEntry(config, id);
        if (entry is null)
        {
            throw new InvalidOperationException("Launcher entry not found.");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = entry.ExecutablePath,
            UseShellExecute = true
        };

        if (!string.IsNullOrWhiteSpace(entry.Arguments))
        {
            startInfo.Arguments = entry.Arguments;
        }

        if (File.Exists(entry.ExecutablePath))
        {
            var fullPath = Path.GetFullPath(entry.ExecutablePath);
            var workingDirectory = Path.GetDirectoryName(fullPath);
            if (!string.IsNullOrWhiteSpace(workingDirectory))
            {
                startInfo.WorkingDirectory = workingDirectory;
            }
        }

        Process.Start(startInfo);
        return new LauncherLaunchResult
        {
            Ok = true,
            Id = entry.Id,
            Message = $"Launched {entry.DisplayName}.",
            LaunchedAt = DateTimeOffset.UtcNow
        };
    }

    public bool TryGetIcon(AppConfig config, string? id, out LauncherIconAsset asset)
    {
        asset = default;
        var entry = FindEntry(config, id);
        if (entry is null)
        {
            return false;
        }

        var iconPath = entry.IconPath?.Trim() ?? "";
        if (!string.IsNullOrWhiteSpace(iconPath) && File.Exists(iconPath))
        {
            var contentType = GetContentType(iconPath);
            asset = new LauncherIconAsset(contentType, File.ReadAllBytes(iconPath));
            return true;
        }

        var executablePath = entry.ExecutablePath?.Trim() ?? "";
        if (File.Exists(executablePath) && TryExtractAssociatedIcon(executablePath, out var iconBytes))
        {
            asset = new LauncherIconAsset("image/png", iconBytes);
            return true;
        }

        return false;
    }

    private static LauncherEntryPayload MapEntry(LauncherEntryConfig entry)
    {
        return new LauncherEntryPayload
        {
            Id = entry.Id,
            DisplayName = entry.DisplayName,
            IconPath = entry.IconPath,
            ExecutablePath = entry.ExecutablePath,
            Arguments = entry.Arguments,
            IconUrl = ResolveIconUrl(entry),
            TileLabel = ResolveTileLabel(entry.DisplayName)
        };
    }

    private static LauncherEntryConfig? FindEntry(AppConfig config, string? id)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        return (config.Launchers ?? []).FirstOrDefault(entry =>
            string.Equals(entry.Id, id, StringComparison.OrdinalIgnoreCase));
    }

    private static string ResolveDisplayName(string executablePath, string? displayName)
    {
        if (!string.IsNullOrWhiteSpace(displayName))
        {
            return displayName.Trim();
        }

        if (Uri.TryCreate(executablePath, UriKind.Absolute, out var uri) && !uri.IsFile)
        {
            return string.IsNullOrWhiteSpace(uri.Host) ? executablePath : uri.Host;
        }

        var fileName = Path.GetFileNameWithoutExtension(executablePath);
        return string.IsNullOrWhiteSpace(fileName) ? executablePath : fileName;
    }

    private static string ResolveIconUrl(LauncherEntryConfig entry)
    {
        var iconPath = entry.IconPath?.Trim() ?? "";
        if (iconPath.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
            || iconPath.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || iconPath.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            return iconPath;
        }

        if ((!string.IsNullOrWhiteSpace(iconPath) && File.Exists(iconPath))
            || File.Exists(entry.ExecutablePath))
        {
            return "/api/launchers/icon?id=" + Uri.EscapeDataString(entry.Id);
        }

        return "";
    }

    private static string ResolveTileLabel(string displayName)
    {
        var normalized = (displayName ?? "").Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return "?";
        }

        return normalized[..1].ToUpperInvariant();
    }

    private static string GetContentType(string path)
    {
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".jpg" => "image/jpeg",
            ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".svg" => "image/svg+xml",
            ".ico" => "image/x-icon",
            _ => "application/octet-stream"
        };
    }

    private static bool TryExtractAssociatedIcon(string path, out byte[] iconBytes)
    {
        iconBytes = [];

        try
        {
            using var icon = Icon.ExtractAssociatedIcon(path);
            if (icon is null)
            {
                return false;
            }

            using var bitmap = icon.ToBitmap();
            using var stream = new MemoryStream();
            bitmap.Save(stream, ImageFormat.Png);
            iconBytes = stream.ToArray();
            return iconBytes.Length > 0;
        }
        catch
        {
            return false;
        }
    }
}

public sealed class LauncherSnapshot
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; }

    public string Status { get; set; } = "setup";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public string Source { get; set; } = "config";

    public List<LauncherEntryPayload> Entries { get; set; } = [];
}

public sealed class LauncherEntryPayload
{
    public string Id { get; set; } = "";

    public string DisplayName { get; set; } = "";

    public string IconPath { get; set; } = "";

    public string ExecutablePath { get; set; } = "";

    public string Arguments { get; set; } = "";

    public string IconUrl { get; set; } = "";

    public string TileLabel { get; set; } = "?";
}

public sealed class LauncherLaunchResult
{
    public bool Ok { get; set; }

    public string Id { get; set; } = "";

    public string Message { get; set; } = "";

    public DateTimeOffset LaunchedAt { get; set; }
}

public readonly record struct LauncherIconAsset(string ContentType, byte[] Content);
