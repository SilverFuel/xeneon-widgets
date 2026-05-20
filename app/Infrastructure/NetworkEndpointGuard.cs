using System.Net;
using System.Net.Sockets;

namespace XenonEdgeHost;

public static class NetworkEndpointGuard
{
    private static readonly string[] LocalHostSuffixes =
    [
        ".local",
        ".lan",
        ".home",
        ".home.arpa",
        ".localdomain"
    ];

    private static readonly string[] BlockedRemoteHostNames =
    [
        "metadata.google.internal"
    ];

    public static string NormalizeLocalHttpsAuthority(string? input, string label)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return "";
        }

        var uri = ParseHttpUri(input, "https", label);
        if (!IsLocalOrPrivateHost(uri.Host))
        {
            throw new InvalidOperationException($"{label} must be a local/private IP address or local hostname.");
        }

        return FormatAuthority(uri.Host, uri.Port, uri.IsDefaultPort);
    }

    public static string NormalizeRemoteHttpUrl(string? input, string label)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return "";
        }

        var trimmed = input.Trim();
        if (trimmed.StartsWith("webcal://", StringComparison.OrdinalIgnoreCase))
        {
            trimmed = $"https://{trimmed["webcal://".Length..]}";
        }

        var uri = ParseHttpUri(trimmed, "https", label);
        if (IsLocalOrPrivateHost(uri.Host) || IsBlockedRemoteHostName(uri.Host))
        {
            throw new InvalidOperationException($"{label} must point to a public HTTP(S) calendar feed.");
        }

        return uri.ToString();
    }

    public static bool IsLocalOrPrivateHost(string? host)
    {
        var normalized = NormalizeHostName(host);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return false;
        }

        if (string.Equals(normalized, "localhost", StringComparison.OrdinalIgnoreCase)
            || normalized.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (IPAddress.TryParse(normalized, out var address))
        {
            return IsLocalOrPrivateAddress(address);
        }

        if (!normalized.Contains('.', StringComparison.Ordinal))
        {
            return true;
        }

        return LocalHostSuffixes.Any(suffix => normalized.EndsWith(suffix, StringComparison.OrdinalIgnoreCase));
    }

    private static Uri ParseHttpUri(string input, string defaultScheme, string label)
    {
        var trimmed = input.Trim();
        var candidate = trimmed.Contains("://", StringComparison.Ordinal)
            ? trimmed
            : $"{defaultScheme}://{trimmed}";

        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri)
            || string.IsNullOrWhiteSpace(uri.Host))
        {
            throw new InvalidOperationException($"{label} is not a valid HTTP(S) address.");
        }

        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"{label} must use HTTP(S).");
        }

        return uri;
    }

    private static string FormatAuthority(string host, int port, bool isDefaultPort)
    {
        var normalizedHost = NormalizeHostName(host);
        var formattedHost = IPAddress.TryParse(normalizedHost, out var address) && address.AddressFamily == AddressFamily.InterNetworkV6
            ? $"[{address}]"
            : normalizedHost;

        return isDefaultPort ? formattedHost : $"{formattedHost}:{port}";
    }

    private static string NormalizeHostName(string? host)
    {
        return (host ?? "").Trim().Trim('[', ']').TrimEnd('.').ToLowerInvariant();
    }

    private static bool IsBlockedRemoteHostName(string host)
    {
        return BlockedRemoteHostNames.Any(blocked => string.Equals(NormalizeHostName(host), blocked, StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsLocalOrPrivateAddress(IPAddress address)
    {
        if (IPAddress.IsLoopback(address))
        {
            return true;
        }

        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var bytes = address.GetAddressBytes();
            return bytes[0] == 10
                || bytes[0] == 127
                || (bytes[0] == 169 && bytes[1] == 254)
                || (bytes[0] == 172 && bytes[1] is >= 16 and <= 31)
                || (bytes[0] == 192 && bytes[1] == 168)
                || (bytes[0] == 100 && bytes[1] is >= 64 and <= 127);
        }

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            var bytes = address.GetAddressBytes();
            return address.IsIPv6LinkLocal
                || address.IsIPv6SiteLocal
                || bytes[0] is 0xfc or 0xfd;
        }

        return false;
    }
}
