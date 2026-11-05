namespace XenonEdgeHost;

public sealed class RemoteSessionService : IDisposable
{
    // The 0.3.0-beta.1 phone remote is intentionally disabled. The previous
    // implementation exposed its bearer token in clear-text LAN URLs and
    // rendered Scene names as executable HTML.
    internal const bool EnabledForCurrentBeta = false;

    public RemoteSessionService(SceneService sceneService, ActionChainService actionChains, HostLogger logger, int dashboardPort)
    {
        ArgumentNullException.ThrowIfNull(sceneService);
        ArgumentNullException.ThrowIfNull(actionChains);
        ArgumentNullException.ThrowIfNull(logger);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(dashboardPort);
    }

    public object GetSnapshot()
    {
        return new
        {
            supported = EnabledForCurrentBeta,
            active = false,
            url = "",
            qrSvg = "",
            expiresAt = "",
            localNetworkOnly = true,
            accountRequired = false,
            status = "unavailable",
            message = "Phone Remote is unavailable in Auxora 0.3.0-beta.1 while its local-network security is rebuilt."
        };
    }

    public object Start() => GetSnapshot();

    public object Stop() => GetSnapshot();

    public void Dispose()
    {
    }
}
