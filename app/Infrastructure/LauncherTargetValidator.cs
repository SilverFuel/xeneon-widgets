namespace XenonEdgeHost;

public enum LauncherTargetKind
{
    File,
    Uri
}

public sealed record LauncherTargetValidation(
    LauncherTargetKind Kind,
    string Target,
    string Arguments,
    string? WorkingDirectory);

public static class LauncherTargetValidator
{
    private static readonly HashSet<string> AllowedUriSchemes = new(StringComparer.OrdinalIgnoreCase)
    {
        "steam",
        "ms-xbl",
        "ms-gamebar",
        "xbox"
    };

    private static readonly HashSet<string> AllowedFileExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe",
        ".lnk"
    };

    public static LauncherTargetValidation ValidateAndNormalizeTarget(string? target, string? arguments)
    {
        var normalizedTarget = (target ?? "").Trim();
        var normalizedArguments = (arguments ?? "").Trim();
        if (string.IsNullOrWhiteSpace(normalizedTarget))
        {
            throw new InvalidOperationException("Launcher target is required.");
        }

        if (IsSteamAppId(normalizedTarget))
        {
            RejectUriArguments(normalizedArguments);
            return new LauncherTargetValidation(
                LauncherTargetKind.Uri,
                $"steam://rungameid/{normalizedTarget}",
                "",
                null);
        }

        if (Uri.TryCreate(normalizedTarget, UriKind.Absolute, out var uri) && !uri.IsFile)
        {
            RejectUriArguments(normalizedArguments);
            var normalizedUri = NormalizeAllowedUri(uri);
            return new LauncherTargetValidation(
                LauncherTargetKind.Uri,
                normalizedUri,
                "",
                null);
        }

        var fullPath = Path.GetFullPath(Environment.ExpandEnvironmentVariables(normalizedTarget));
        if (!File.Exists(fullPath))
        {
            throw new InvalidOperationException("Launcher target must be an existing .exe or .lnk file, a Steam app ID, or an allowed URI.");
        }

        var extension = Path.GetExtension(fullPath);
        if (!AllowedFileExtensions.Contains(extension))
        {
            throw new InvalidOperationException("Launcher file targets must be .exe or .lnk files.");
        }

        return new LauncherTargetValidation(
            LauncherTargetKind.File,
            fullPath,
            normalizedArguments,
            Path.GetDirectoryName(fullPath));
    }

    public static bool TryValidateAndNormalizeTarget(string? target, string? arguments, out LauncherTargetValidation validation)
    {
        try
        {
            validation = ValidateAndNormalizeTarget(target, arguments);
            return true;
        }
        catch
        {
            validation = new LauncherTargetValidation(LauncherTargetKind.File, "", "", null);
            return false;
        }
    }

    private static string NormalizeAllowedUri(Uri uri)
    {
        if (!AllowedUriSchemes.Contains(uri.Scheme))
        {
            throw new InvalidOperationException("Launcher URI scheme is not allowed.");
        }

        if (string.Equals(uri.Scheme, "steam", StringComparison.OrdinalIgnoreCase)
            && !IsAllowedSteamUri(uri))
        {
            throw new InvalidOperationException("Steam launcher URIs must use steam://rungameid/{appId}.");
        }

        return uri.AbsoluteUri;
    }

    private static bool IsAllowedSteamUri(Uri uri)
    {
        if (!string.Equals(uri.Host, "rungameid", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var appId = uri.AbsolutePath.Trim('/');
        return IsSteamAppId(appId);
    }

    private static bool IsSteamAppId(string value)
    {
        return value.Length is > 0 and <= 12 && value.All(char.IsDigit);
    }

    private static void RejectUriArguments(string arguments)
    {
        if (!string.IsNullOrWhiteSpace(arguments))
        {
            throw new InvalidOperationException("URI launcher targets cannot include extra arguments.");
        }
    }
}
