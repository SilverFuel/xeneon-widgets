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
        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"{label} must use HTTPS.");
        }

        if (IsLocalOrPrivateHost(uri.Host) || IsBlockedRemoteHostName(uri.Host))
        {
            throw new InvalidOperationException($"{label} must point to a public HTTPS calendar feed.");
        }

        return uri.ToString();
    }

    internal static async Task<Uri> ValidatePublicHttpsDestinationAsync(
        string? input,
        string label,
        CancellationToken cancellationToken,
        Func<string, CancellationToken, Task<IPAddress[]>>? resolver = null)
    {
        var normalized = NormalizeRemoteHttpUrl(input, label);
        var uri = new Uri(normalized, UriKind.Absolute);
        await ResolvePublicAddressesAsync(uri.Host, label, cancellationToken, resolver);
        return uri;
    }

    internal static async Task<IPAddress[]> ResolvePublicAddressesAsync(
        string host,
        string label,
        CancellationToken cancellationToken,
        Func<string, CancellationToken, Task<IPAddress[]>>? resolver = null)
    {
        IPAddress[] addresses;
        if (IPAddress.TryParse(NormalizeHostName(host), out var literal))
        {
            addresses = [literal];
        }
        else
        {
            addresses = await (resolver ?? Dns.GetHostAddressesAsync)(host, cancellationToken);
        }

        if (addresses.Length == 0)
        {
            throw new InvalidOperationException($"{label} did not resolve to an IP address.");
        }

        if (addresses.Any(address => !IsPublicAddress(address)))
        {
            throw new InvalidOperationException($"{label} resolved to a local, private, reserved, or otherwise non-public address.");
        }

        return addresses;
    }

    internal static async ValueTask<Stream> ConnectPublicHttpsAsync(
        SocketsHttpConnectionContext context,
        CancellationToken cancellationToken)
    {
        return await ConnectPublicHttpsHostAsync(
            context.DnsEndPoint.Host,
            context.DnsEndPoint.Port,
            cancellationToken,
            resolver: null,
            ConnectSocketAsync);
    }

    internal static async ValueTask<Stream> ConnectPublicHttpsHostAsync(
        string host,
        int port,
        CancellationToken cancellationToken,
        Func<string, CancellationToken, Task<IPAddress[]>>? resolver,
        Func<IPAddress, int, CancellationToken, ValueTask<Stream>> connector)
    {
        var addresses = await ResolvePublicAddressesAsync(
            host,
            "Calendar ICS destination",
            cancellationToken,
            resolver);
        Exception? lastError = null;

        foreach (var address in addresses)
        {
            try
            {
                return await connector(address, port, cancellationToken);
            }
            catch (Exception error) when (error is SocketException or OperationCanceledException)
            {
                lastError = error;
                if (error is OperationCanceledException)
                {
                    throw;
                }
            }
        }

        throw new HttpRequestException("Calendar ICS destination could not be reached.", lastError);
    }

    private static async ValueTask<Stream> ConnectSocketAsync(
        IPAddress address,
        int port,
        CancellationToken cancellationToken)
    {
        var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
        try
        {
            await socket.ConnectAsync(new IPEndPoint(address, port), cancellationToken);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
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

    internal static bool IsPublicAddress(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6)
        {
            return IsPublicAddress(address.MapToIPv4());
        }

        if (IPAddress.IsLoopback(address))
        {
            return false;
        }

        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return bytes[0] != 0
                && bytes[0] != 10
                && bytes[0] != 127
                && !(bytes[0] == 100 && bytes[1] is >= 64 and <= 127)
                && !(bytes[0] == 169 && bytes[1] == 254)
                && !(bytes[0] == 172 && bytes[1] is >= 16 and <= 31)
                && !(bytes[0] == 192 && bytes[1] == 0 && bytes[2] == 0)
                && !(bytes[0] == 192 && bytes[1] == 0 && bytes[2] == 2)
                && !(bytes[0] == 192 && bytes[1] == 88 && bytes[2] == 99)
                && !(bytes[0] == 192 && bytes[1] == 168)
                && !(bytes[0] == 198 && bytes[1] is 18 or 19)
                && !(bytes[0] == 198 && bytes[1] == 51 && bytes[2] == 100)
                && !(bytes[0] == 203 && bytes[1] == 0 && bytes[2] == 113)
                && bytes[0] < 224;
        }

        if (address.AddressFamily != AddressFamily.InterNetworkV6
            || address.Equals(IPAddress.IPv6Any)
            || address.Equals(IPAddress.IPv6None)
            || address.IsIPv6LinkLocal
            || address.IsIPv6Multicast
            || address.IsIPv6SiteLocal
            || bytes[0] is < 0x20 or > 0x3f)
        {
            return false;
        }

        var isDocumentation = bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] == 0x0d && bytes[3] == 0xb8;
        var isBenchmarking = bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] == 0x00 && bytes[3] == 0x02;
        var isOrchid = bytes[0] == 0x20
            && bytes[1] == 0x01
            && bytes[2] == 0x00
            && (bytes[3] & 0xf0) is 0x10 or 0x20;
        return !isDocumentation && !isBenchmarking && !isOrchid;
    }
}
