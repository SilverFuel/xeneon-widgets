using System.Text.RegularExpressions;

namespace XenonEdgeHost;

public sealed class ActionController
{
    private static readonly Regex QuickActionPathPattern = new("^/api/quick-actions/([^/]+)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex SystemShortcutPathPattern = new("^/api/system-shortcuts/([^/]+)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex HueLightTogglePathPattern = new("^/api/hue/lights/([^/]+)/toggle$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex HueLightBrightnessPathPattern = new("^/api/hue/lights/([^/]+)/brightness$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex HueGroupTogglePathPattern = new("^/api/hue/groups/([^/]+)/toggle$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex HueGroupBrightnessPathPattern = new("^/api/hue/groups/([^/]+)/brightness$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private readonly ConfigStore _configStore;
    private readonly LauncherService _launcherService;
    private readonly ProvisioningService _provisioningService;
    private readonly SystemActionsService _systemActionsService;
    private readonly MediaService _mediaService;
    private readonly HueService _hueService;
    private readonly ClipboardHistoryService _clipboardHistoryService;

    public ActionController(
        ConfigStore configStore,
        LauncherService launcherService,
        ProvisioningService provisioningService,
        SystemActionsService systemActionsService,
        MediaService mediaService,
        HueService hueService,
        ClipboardHistoryService clipboardHistoryService)
    {
        _configStore = configStore;
        _launcherService = launcherService;
        _provisioningService = provisioningService;
        _systemActionsService = systemActionsService;
        _mediaService = mediaService;
        _hueService = hueService;
        _clipboardHistoryService = clipboardHistoryService;
    }

    public ProvisioningSnapshot GetProvisioningSnapshot()
    {
        return _provisioningService.GetSnapshot();
    }

    public ProvisioningSnapshot RunProvisioning()
    {
        return _provisioningService.RunStartupProvisioning(forceLauncherScan: true);
    }

    public ProvisioningSnapshot ApplyLauncherSuggestions(LauncherSuggestionApplyRequest request)
    {
        return _provisioningService.ApplyLauncherSuggestions(request.Ids);
    }

    public LauncherSnapshot GetLaunchers()
    {
        return _launcherService.GetSnapshot(_configStore.Snapshot());
    }

    public LauncherSnapshot UpdateLaunchers(LaunchersUpdateRequest request)
    {
        var entries = _launcherService.NormalizeEntries(request.Entries);
        var updatedConfig = _configStore.Update(current =>
        {
            current.Launchers = entries;
            return current;
        });

        return _launcherService.GetSnapshot(updatedConfig);
    }

    public LauncherLaunchResult Launch(LauncherLaunchRequest request)
    {
        return _launcherService.Launch(_configStore.Snapshot(), request.Id);
    }

    public bool TryGetLauncherIcon(string? id, out LauncherIconAsset asset)
    {
        return _launcherService.TryGetIcon(_configStore.Snapshot(), id, out asset);
    }

    public QuickActionsSnapshot GetQuickActions()
    {
        return _systemActionsService.GetQuickActionsSnapshot();
    }

    public SystemShortcutsSnapshot GetShortcuts()
    {
        return _systemActionsService.GetShortcutsSnapshot();
    }

    public SystemShortcutsSnapshot SetBrightness(BrightnessRequest request)
    {
        return _systemActionsService.SetBrightness(request.Brightness);
    }

    public RestartAdminResult RestartHostAsAdministrator()
    {
        return _systemActionsService.RestartHostAsAdministrator();
    }

    public bool TryExecuteQuickAction(string path, string method, out object? payload)
    {
        payload = null;
        if (!string.Equals(method, "POST", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var match = QuickActionPathPattern.Match(path);
        if (!match.Success)
        {
            return false;
        }

        var actionId = Uri.UnescapeDataString(match.Groups[1].Value);
        payload = _systemActionsService.ExecuteQuickAction(actionId);
        return true;
    }

    public bool TryExecuteSystemShortcut(string path, string method, out object? payload)
    {
        payload = null;
        if (!string.Equals(method, "POST", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var match = SystemShortcutPathPattern.Match(path);
        if (!match.Success || string.Equals(match.Groups[1].Value, "brightness", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var actionId = Uri.UnescapeDataString(match.Groups[1].Value);
        payload = _systemActionsService.ExecuteShortcut(actionId);
        return true;
    }

    public Task<MediaSnapshot> GetMediaAsync(CancellationToken cancellationToken)
    {
        return _mediaService.GetSnapshotAsync(cancellationToken);
    }

    public Task<MediaSnapshot> ExecuteMediaAsync(string action, CancellationToken cancellationToken)
    {
        return _mediaService.ExecuteAsync(action, cancellationToken);
    }

    public Task<HueSnapshot> GetHueAsync(CancellationToken cancellationToken)
    {
        return _hueService.GetSnapshotAsync(_configStore.Snapshot(), cancellationToken);
    }

    public Task<HueSnapshot> LinkHueAsync(HueLinkRequest request, CancellationToken cancellationToken)
    {
        return _hueService.LinkBridgeAsync(request.BridgeIp, cancellationToken);
    }

    public async Task<ActionRouteResult> TryExecuteHueActionAsync(
        string path,
        string method,
        Func<CancellationToken, Task<HueToggleRequest>> readToggleAsync,
        Func<CancellationToken, Task<HueBrightnessRequest>> readBrightnessAsync,
        CancellationToken cancellationToken)
    {
        if (!string.Equals(method, "POST", StringComparison.OrdinalIgnoreCase))
        {
            return ActionRouteResult.NotHandled;
        }

        var lightToggleMatch = HueLightTogglePathPattern.Match(path);
        if (lightToggleMatch.Success)
        {
            var payload = await readToggleAsync(cancellationToken);
            await _hueService.SetLightStateAsync(_configStore.Snapshot(), DecodePathValue(lightToggleMatch), new
            {
                on = payload.State
            }, cancellationToken);
            return ActionRouteResult.Ok(new { ok = true });
        }

        var lightBrightnessMatch = HueLightBrightnessPathPattern.Match(path);
        if (lightBrightnessMatch.Success)
        {
            var payload = await readBrightnessAsync(cancellationToken);
            var brightness = Math.Clamp(payload.Brightness, 0, 100);
            await _hueService.SetLightStateAsync(_configStore.Snapshot(), DecodePathValue(lightBrightnessMatch), new
            {
                on = brightness > 0,
                bri = Math.Clamp((int)Math.Round((brightness / 100d) * 254d), 1, 254)
            }, cancellationToken);
            return ActionRouteResult.Ok(new { ok = true });
        }

        var groupToggleMatch = HueGroupTogglePathPattern.Match(path);
        if (groupToggleMatch.Success)
        {
            var payload = await readToggleAsync(cancellationToken);
            await _hueService.SetGroupStateAsync(_configStore.Snapshot(), DecodePathValue(groupToggleMatch), new
            {
                on = payload.State
            }, cancellationToken);
            return ActionRouteResult.Ok(new { ok = true });
        }

        var groupBrightnessMatch = HueGroupBrightnessPathPattern.Match(path);
        if (groupBrightnessMatch.Success)
        {
            var payload = await readBrightnessAsync(cancellationToken);
            var brightness = Math.Clamp(payload.Brightness, 0, 100);
            await _hueService.SetGroupStateAsync(_configStore.Snapshot(), DecodePathValue(groupBrightnessMatch), brightness > 0
                ? new
                {
                    on = true,
                    bri = Math.Clamp((int)Math.Round((brightness / 100d) * 254d), 1, 254)
                }
                : new
                {
                    on = false
                }, cancellationToken);
            return ActionRouteResult.Ok(new { ok = true });
        }

        return ActionRouteResult.NotHandled;
    }

    public Task<ClipboardHistorySnapshot> GetClipboardAsync(CancellationToken cancellationToken)
    {
        return _clipboardHistoryService.GetSnapshotAsync(cancellationToken);
    }

    public Task<ClipboardHistorySnapshot> CopyClipboardAsync(ClipboardCopyRequest request, CancellationToken cancellationToken)
    {
        return _clipboardHistoryService.CopyItemAsync(request.Id, cancellationToken);
    }

    private static string DecodePathValue(Match match)
    {
        return Uri.UnescapeDataString(match.Groups[1].Value);
    }
}

public sealed record ActionRouteResult(bool Handled, object? Payload)
{
    public static ActionRouteResult NotHandled { get; } = new(false, null);

    public static ActionRouteResult Ok(object payload)
    {
        return new ActionRouteResult(true, payload);
    }
}
