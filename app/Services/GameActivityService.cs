using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace XenonEdgeHost;

public sealed class GameActivityService
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(4);
    private static readonly HashSet<string> IgnoredProcessNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "agent",
        "applicationframehost",
        "battle.net",
        "blizzardbrowser",
        "chrome",
        "cmd",
        "codex",
        "code",
        "conhost",
        "corsair.service",
        "corsaircue",
        "discord",
        "dotnet",
        "eadesktop",
        "epicgameslauncher",
        "epicwebhelper",
        "explorer",
        "firefox",
        "galaxyclient",
        "gamingservices",
        "gamingservicesnet",
        "git",
        "gog galaxy",
        "msedge",
        "msbuild",
        "node",
        "nvidia app",
        "nvcontainer",
        "origin",
        "openconsole",
        "powershell",
        "pwsh",
        "python",
        "riotclientservices",
        "steam",
        "steamwebhelper",
        "systemsettings",
        "windowsterminal",
        "ubisoftconnect",
        "xboxappservices",
        "xenonedgehost"
    };

    private static readonly string[] IgnoredProcessFragments =
    [
        "crashpad",
        "crashreport",
        "helper",
        "installer",
        "launcher",
        "overlay",
        "setup",
        "unins",
        "update"
    ];

    private static readonly string[] GameKeywordFragments =
    [
        "battle.net",
        "blizzard",
        "borderlands",
        "call of duty",
        "civilization",
        "cyberpunk",
        "diablo",
        "ea games",
        "epic games",
        "fallout",
        "fortnite",
        "gog",
        "halo",
        "hearthstone",
        "league of legends",
        "minecraft",
        "no man's sky",
        "overwatch",
        "riot games",
        "roblox",
        "starcraft",
        "steam",
        "steamapps",
        "ubisoft",
        "valorant",
        "warcraft",
        "xboxgames"
    ];

    private static readonly BattleNetKnownGame[] BattleNetKnownGames =
    [
        new("Diablo IV", [@"\diablo iv\", @"\diablo 4\"]),
        new("Diablo Immortal", [@"\diablo immortal\"]),
        new("Diablo III", [@"\diablo iii\", @"\diablo 3\"]),
        new("World of Warcraft", [@"\world of warcraft\"]),
        new("Overwatch 2", [@"\overwatch\", @"\overwatch 2\"]),
        new("Hearthstone", [@"\hearthstone\"]),
        new("StarCraft II", [@"\starcraft ii\", @"\starcraft 2\"]),
        new("StarCraft", [@"\starcraft\"]),
        new("Heroes of the Storm", [@"\heroes of the storm\"]),
        new("Call of Duty", [@"\call of duty\"])
    ];

    private readonly SteamService _steamService;
    private readonly LauncherService _launcherService;
    private readonly ConfigStore _configStore;
    private readonly HostLogger _logger;
    private readonly object _sync = new();
    private GameActivitySnapshot? _cachedSnapshot;
    private DateTimeOffset _cachedAt = DateTimeOffset.MinValue;
    private GameActivityPayload? _lastActiveGame;
    private string _lastActiveGameId = "";
    private DateTimeOffset? _sessionStartedAt;
    private DateTimeOffset? _lastEndedAt;

    public GameActivityService(
        SteamService steamService,
        LauncherService launcherService,
        ConfigStore configStore,
        HostLogger logger)
    {
        _steamService = steamService;
        _launcherService = launcherService;
        _configStore = configStore;
        _logger = logger;
    }

    public GameActivitySnapshot GetSnapshot(bool forceRefresh = false)
    {
        lock (_sync)
        {
            if (!forceRefresh
                && _cachedSnapshot is not null
                && DateTimeOffset.UtcNow - _cachedAt < CacheDuration)
            {
                return _cachedSnapshot;
            }

            _cachedSnapshot = BuildSnapshot(forceRefresh);
            _cachedAt = DateTimeOffset.UtcNow;
            return _cachedSnapshot;
        }
    }

    public GameActivityPinResult PinCandidate(GameActivityPinRequest request)
    {
        var snapshot = GetSnapshot(forceRefresh: true);
        var processId = request.ProcessId.GetValueOrDefault();
        var candidate = snapshot.Candidates.FirstOrDefault(entry =>
                !string.IsNullOrWhiteSpace(request.Id)
                && string.Equals(entry.Id, request.Id.Trim(), StringComparison.OrdinalIgnoreCase))
            ?? snapshot.Candidates.FirstOrDefault(entry =>
                processId > 0 && entry.ProcessId == processId)
            ?? snapshot.ActiveGame;

        if (candidate is null)
        {
            throw new InvalidOperationException("Running app candidate not found.");
        }

        if (string.IsNullOrWhiteSpace(candidate.ExecutablePath) || !File.Exists(candidate.ExecutablePath))
        {
            throw new InvalidOperationException("This app does not expose a launchable executable.");
        }

        var added = false;
        _configStore.Update(current =>
        {
            current.Launchers ??= [];
            var path = NormalizePath(candidate.ExecutablePath);
            var existing = current.Launchers.FirstOrDefault(entry =>
                string.Equals(NormalizePath(entry.ExecutablePath), path, StringComparison.OrdinalIgnoreCase));
            if (existing is not null)
            {
                return current;
            }

            current.Launchers.Add(new LauncherEntryConfig
            {
                Id = "game-" + Guid.NewGuid().ToString("N"),
                DisplayName = TextOr(candidate.Name, TextOr(candidate.ProcessName, "Game")),
                ExecutablePath = path,
                IconPath = "",
                Arguments = ""
            });
            added = true;
            return current;
        });

        lock (_sync)
        {
            _cachedSnapshot = null;
            _cachedAt = DateTimeOffset.MinValue;
        }

        return new GameActivityPinResult
        {
            Ok = true,
            Added = added,
            Game = candidate,
            Message = added
                ? $"{candidate.Name} will be treated as a game from now on."
                : $"{candidate.Name} is already pinned."
        };
    }

    private GameActivitySnapshot BuildSnapshot(bool forceRefresh)
    {
        try
        {
            var sampledAt = DateTimeOffset.UtcNow;
            var config = _configStore.Snapshot();
            var launcherSnapshot = _launcherService.GetSnapshot(config);
            var steamSnapshot = _steamService.GetSnapshot(forceRefresh);
            var epicGames = ReadEpicInstalledGames();
            var launcherEntries = launcherSnapshot.Entries
                .Where(entry => IsUsableExecutablePath(entry.ExecutablePath))
                .ToList();
            var steamInstalledGames = steamSnapshot.Games
                .Where(game => HasExistingInstallPath(game.InstallPath))
                .ToList();
            var candidates = new List<GameActivityPayload>();
            var runningProcesses = ReadRunningProcesses();
            var foregroundProcess = GetForegroundProcess(runningProcesses);

            if (steamSnapshot.ActiveGame is not null)
            {
                candidates.Add(CreateSteamPayload(
                    steamSnapshot.ActiveGame,
                    process: null,
                    confidence: 98,
                    "Steam reports this game is running."));
            }

            foreach (var process in runningProcesses)
            {
                if (IsIgnoredProcess(process))
                {
                    continue;
                }

                AddSteamProcessCandidate(candidates, steamInstalledGames, process);
                AddEpicProcessCandidate(candidates, epicGames, process);
                AddPinnedLauncherCandidate(candidates, launcherEntries, process);
                AddKnownGamePathCandidate(candidates, process);
                AddFallbackProcessCandidate(candidates, process);
            }

            var orderedCandidates = candidates
                .GroupBy(candidate => candidate.Id, StringComparer.OrdinalIgnoreCase)
                .Select(SelectBestCandidate)
                .OrderByDescending(candidate => candidate.Confidence)
                .ThenByDescending(candidate => candidate.StartedAt.HasValue)
                .ThenByDescending(candidate => candidate.StartedAt ?? DateTimeOffset.MinValue)
                .Take(8)
                .ToList();
            var activeGame = orderedCandidates.FirstOrDefault(candidate => candidate.Confidence >= 60);
            var mode = ResolveMode(activeGame, foregroundProcess, sampledAt);
            var lastGame = mode == "ended" ? _lastActiveGame : null;

            return new GameActivitySnapshot
            {
                Supported = true,
                Configured = steamSnapshot.Configured || launcherSnapshot.Configured || epicGames.Count > 0,
                Status = activeGame is null ? mode : "active",
                Mode = mode,
                StateLabel = ModeLabel(mode),
                Active = activeGame is not null,
                ActiveGame = activeGame,
                LastGame = lastGame,
                LastEndedAt = mode == "ended" ? _lastEndedAt : null,
                Candidates = orderedCandidates,
                ForegroundProcessId = foregroundProcess?.ProcessId,
                ForegroundProcessName = foregroundProcess?.ProcessName ?? "",
                Source = "running processes",
                Message = activeGame is null
                    ? mode == "ended" && lastGame is not null
                        ? $"{lastGame.Name} ended."
                        : "No active game detected."
                    : $"{activeGame.Name} is running via {activeGame.Platform}.",
                SampledAt = sampledAt
            };
        }
        catch (Exception ex)
        {
            _logger.Error("Game activity detection failed.", ex);
            return new GameActivitySnapshot
            {
                Supported = true,
                Configured = false,
                Status = "error",
                Active = false,
                Source = "running processes",
                Message = "Game activity detection failed.",
                SampledAt = DateTimeOffset.UtcNow
            };
        }
    }

    private string ResolveMode(GameActivityPayload? activeGame, RunningProcessInfo? foregroundProcess, DateTimeOffset sampledAt)
    {
        if (activeGame is null)
        {
            if (!string.IsNullOrWhiteSpace(_lastActiveGameId))
            {
                _lastEndedAt = sampledAt;
                _lastActiveGameId = "";
                _sessionStartedAt = null;
                return "ended";
            }

            return _lastEndedAt.HasValue && sampledAt - _lastEndedAt.Value < TimeSpan.FromSeconds(12)
                ? "ended"
                : "idle";
        }

        var activeId = TextOr(activeGame.Id, BuildStableId(activeGame.Platform, activeGame.Name, activeGame.ExecutablePath));
        if (!string.Equals(_lastActiveGameId, activeId, StringComparison.OrdinalIgnoreCase))
        {
            _sessionStartedAt = activeGame.StartedAt ?? sampledAt;
            _lastActiveGameId = activeId;
        }
        else
        {
            _sessionStartedAt ??= activeGame.StartedAt ?? sampledAt;
        }

        _lastActiveGame = activeGame;
        _lastEndedAt = null;
        activeGame.SessionStartedAt = _sessionStartedAt;
        activeGame.SessionDurationMs = _sessionStartedAt.HasValue
            ? Math.Max(0, (long)(sampledAt - _sessionStartedAt.Value).TotalMilliseconds)
            : 0;
        activeGame.ForegroundProcessName = foregroundProcess?.ProcessName ?? "";
        activeGame.Focused = IsForegroundGameProcess(activeGame, foregroundProcess);
        activeGame.State = sampledAt - (_sessionStartedAt ?? sampledAt) < TimeSpan.FromSeconds(24)
            ? "launching"
            : activeGame.Focused
                ? "in-game"
                : "background";

        return activeGame.State;
    }

    private static string ModeLabel(string mode)
    {
        return mode switch
        {
            "launching" => "Launching",
            "in-game" => "In game",
            "background" => "Background",
            "ended" => "Ended",
            _ => "Idle"
        };
    }

    private static GameActivityPayload SelectBestCandidate(IEnumerable<GameActivityPayload> candidates)
    {
        var candidateList = candidates.ToList();
        var best = candidateList
            .OrderByDescending(candidate => candidate.Confidence)
            .ThenByDescending(candidate => candidate.StartedAt.HasValue)
            .ThenByDescending(candidate => candidate.StartedAt ?? DateTimeOffset.MinValue)
            .First();
        var runtime = candidateList
            .Where(candidate => candidate.ProcessId.HasValue
                || candidate.StartedAt.HasValue
                || !string.IsNullOrWhiteSpace(candidate.ProcessName))
            .OrderByDescending(candidate => candidate.StartedAt.HasValue)
            .ThenByDescending(candidate => candidate.StartedAt ?? DateTimeOffset.MinValue)
            .FirstOrDefault();

        if (runtime is null || ReferenceEquals(best, runtime))
        {
            return best;
        }

        best.ProcessId ??= runtime.ProcessId;
        if (string.IsNullOrWhiteSpace(best.ProcessName))
        {
            best.ProcessName = runtime.ProcessName;
        }

        best.StartedAt ??= runtime.StartedAt;
        return best;
    }

    private static bool HasExistingInstallPath(string? installPath)
    {
        if (string.IsNullOrWhiteSpace(installPath))
        {
            return false;
        }

        try
        {
            return Directory.Exists(installPath);
        }
        catch
        {
            return false;
        }
    }

    private static void AddSteamProcessCandidate(
        List<GameActivityPayload> candidates,
        IReadOnlyList<SteamGamePayload> games,
        RunningProcessInfo process)
    {
        var game = games.FirstOrDefault(entry =>
            !string.IsNullOrWhiteSpace(entry.InstallPath)
            && IsPathInside(process.ExecutablePath, entry.InstallPath));

        if (game is null)
        {
            return;
        }

        candidates.Add(CreateSteamPayload(game, process, 96, "Matched a running process inside the Steam install folder."));
    }

    private static void AddEpicProcessCandidate(
        List<GameActivityPayload> candidates,
        IReadOnlyList<EpicInstalledGame> games,
        RunningProcessInfo process)
    {
        var game = games.FirstOrDefault(entry =>
            IsPathInside(process.ExecutablePath, entry.InstallLocation)
            || (!string.IsNullOrWhiteSpace(entry.LaunchExecutablePath)
                && string.Equals(NormalizePath(process.ExecutablePath), NormalizePath(entry.LaunchExecutablePath), StringComparison.OrdinalIgnoreCase)));

        if (game is null)
        {
            return;
        }

        candidates.Add(CreatePayload(
            name: game.DisplayName,
            platform: "Epic Games",
            source: "Epic install manifest",
            process,
            confidence: 92,
            reason: "Matched a running process inside the Epic install folder.",
            artworkUrl: "",
            iconUrl: ""));
    }

    private static void AddPinnedLauncherCandidate(
        List<GameActivityPayload> candidates,
        IReadOnlyList<LauncherEntryPayload> launchers,
        RunningProcessInfo process)
    {
        foreach (var launcher in launchers)
        {
            var executablePath = NormalizePath(launcher.ExecutablePath);
            var processPath = NormalizePath(process.ExecutablePath);
            if (string.IsNullOrWhiteSpace(executablePath) || !File.Exists(executablePath))
            {
                continue;
            }

            if (string.Equals(processPath, executablePath, StringComparison.OrdinalIgnoreCase))
            {
                if (!LooksLikeGameLauncherEntry(launcher, process))
                {
                    continue;
                }

                candidates.Add(CreatePayload(
                    name: launcher.DisplayName,
                    platform: InferPlatform(launcher.DisplayName, executablePath),
                    source: "Pinned launcher",
                    process,
                    confidence: 78,
                    reason: "Matched a running process from the pinned launcher list.",
                    artworkUrl: "",
                    iconUrl: launcher.IconUrl));
                continue;
            }

            var launcherRoot = ResolveLauncherRoot(executablePath);
            if (!string.IsNullOrWhiteSpace(launcherRoot)
                && IsPathInside(processPath, launcherRoot)
                && LooksLikeGameLauncherEntry(launcher, process))
            {
                candidates.Add(CreatePayload(
                    name: launcher.DisplayName,
                    platform: InferPlatform(launcher.DisplayName, executablePath),
                    source: "Pinned launcher",
                    process,
                    confidence: 68,
                    reason: "Matched a running process near a pinned game executable.",
                    artworkUrl: "",
                    iconUrl: launcher.IconUrl));
            }
        }
    }

    private static void AddKnownGamePathCandidate(List<GameActivityPayload> candidates, RunningProcessInfo process)
    {
        if (!TryInferKnownGamePath(process.ExecutablePath, out var inferred))
        {
            return;
        }

        candidates.Add(CreatePayload(
            name: inferred.Name,
            platform: inferred.Platform,
            source: inferred.Source,
            process,
            confidence: inferred.Confidence,
            reason: inferred.Reason,
            artworkUrl: "",
            iconUrl: ""));
    }

    private static void AddFallbackProcessCandidate(List<GameActivityPayload> candidates, RunningProcessInfo process)
    {
        if (!LooksLikeManualGameCandidate(process))
        {
            return;
        }

        var displayName = CleanGameName(process.ProcessName);
        if (string.IsNullOrWhiteSpace(displayName))
        {
            displayName = CleanGameName(Path.GetFileNameWithoutExtension(process.ExecutablePath));
        }

        if (string.IsNullOrWhiteSpace(displayName))
        {
            return;
        }

        candidates.Add(CreatePayload(
            name: displayName,
            platform: InferPlatform(displayName, process.ExecutablePath),
            source: "running app",
            process,
            confidence: 44,
            reason: "Running app candidate. Pin it if this should trigger Game Mode.",
            artworkUrl: "",
            iconUrl: ""));
    }

    private static GameActivityPayload CreateSteamPayload(
        SteamGamePayload game,
        RunningProcessInfo? process,
        int confidence,
        string reason)
    {
        return new GameActivityPayload
        {
            Id = $"steam:{game.AppId}",
            Name = TextOr(game.Name, "Steam Game"),
            Platform = "Steam",
            Source = "Steam library",
            ProcessId = process?.ProcessId,
            ProcessName = process?.ProcessName ?? "",
            ExecutablePath = process?.ExecutablePath ?? "",
            Confidence = confidence,
            Reason = reason,
            StartedAt = process?.StartedAt,
            ArtworkUrl = game.ArtworkUrl,
            IconUrl = "",
            TileLabel = TextOr(game.TileLabel, ResolveTileLabel(game.Name))
        };
    }

    private static GameActivityPayload CreatePayload(
        string name,
        string platform,
        string source,
        RunningProcessInfo process,
        int confidence,
        string reason,
        string artworkUrl,
        string iconUrl)
    {
        var displayName = TextOr(CleanGameName(name), TextOr(CleanGameName(process.ProcessName), "Game"));
        return new GameActivityPayload
        {
            Id = BuildStableId(platform, displayName, process.ExecutablePath),
            Name = displayName,
            Platform = TextOr(platform, "Game"),
            Source = TextOr(source, "running process"),
            ProcessId = process.ProcessId,
            ProcessName = process.ProcessName,
            ExecutablePath = process.ExecutablePath,
            Confidence = confidence,
            Reason = reason,
            StartedAt = process.StartedAt,
            ArtworkUrl = artworkUrl,
            IconUrl = iconUrl,
            TileLabel = ResolveTileLabel(displayName)
        };
    }

    private static RunningProcessInfo? GetForegroundProcess(IReadOnlyCollection<RunningProcessInfo> runningProcesses)
    {
        try
        {
            var handle = GetForegroundWindow();
            if (handle == IntPtr.Zero)
            {
                return null;
            }

            _ = GetWindowThreadProcessId(handle, out var processId);
            if (processId == 0)
            {
                return null;
            }

            return runningProcesses.FirstOrDefault(process => process.ProcessId == processId);
        }
        catch
        {
            return null;
        }
    }

    private static bool IsForegroundGameProcess(GameActivityPayload activeGame, RunningProcessInfo? foregroundProcess)
    {
        if (foregroundProcess is null)
        {
            return false;
        }

        if (activeGame.ProcessId.HasValue && activeGame.ProcessId.Value == foregroundProcess.ProcessId)
        {
            return true;
        }

        return !string.IsNullOrWhiteSpace(activeGame.ProcessName)
            && string.Equals(
                Path.GetFileNameWithoutExtension(activeGame.ProcessName),
                Path.GetFileNameWithoutExtension(foregroundProcess.ProcessName),
                StringComparison.OrdinalIgnoreCase);
    }

    private static List<RunningProcessInfo> ReadRunningProcesses()
    {
        var results = new Dictionary<int, RunningProcessInfo>();
        foreach (var process in Process.GetProcesses())
        {
            try
            {
                var executablePath = process.MainModule?.FileName;
                if (string.IsNullOrWhiteSpace(executablePath))
                {
                    continue;
                }

                DateTimeOffset? startedAt = null;
                try
                {
                    startedAt = new DateTimeOffset(process.StartTime);
                }
                catch
                {
                }

                results[process.Id] = new RunningProcessInfo(
                    process.Id,
                    process.ProcessName,
                    NormalizePath(executablePath),
                    startedAt);
            }
            catch
            {
            }
            finally
            {
                process.Dispose();
            }
        }

        AddWmiProcesses(results);
        return results.Values.ToList();
    }

    private static void AddWmiProcesses(Dictionary<int, RunningProcessInfo> results)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT ProcessId, Name, ExecutablePath, CreationDate FROM Win32_Process WHERE ExecutablePath IS NOT NULL");
            using var collection = searcher.Get();
            foreach (ManagementObject item in collection)
            {
                using (item)
                {
                    var processIdValue = item["ProcessId"];
                    if (processIdValue is null)
                    {
                        continue;
                    }

                    var processId = Convert.ToInt32(processIdValue);
                    if (results.ContainsKey(processId))
                    {
                        continue;
                    }

                    var executablePath = NormalizePath(item["ExecutablePath"] as string);
                    if (string.IsNullOrWhiteSpace(executablePath))
                    {
                        continue;
                    }

                    DateTimeOffset? startedAt = null;
                    var creationDate = item["CreationDate"] as string;
                    if (!string.IsNullOrWhiteSpace(creationDate))
                    {
                        try
                        {
                            startedAt = new DateTimeOffset(ManagementDateTimeConverter.ToDateTime(creationDate));
                        }
                        catch
                        {
                        }
                    }

                    results[processId] = new RunningProcessInfo(
                        processId,
                        TextOr(item["Name"] as string, Path.GetFileNameWithoutExtension(executablePath)),
                        executablePath,
                        startedAt);
                }
            }
        }
        catch
        {
        }
    }

    private static bool IsIgnoredProcess(RunningProcessInfo process)
    {
        var processName = process.ProcessName ?? "";
        var processBaseName = Path.GetFileNameWithoutExtension(processName);
        var lowerName = processName.ToLowerInvariant();
        var executablePath = process.ExecutablePath.ToLowerInvariant();
        if (IgnoredProcessNames.Contains(processName)
            || IgnoredProcessNames.Contains(processBaseName)
            || executablePath.Contains(@"\windows\", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return IgnoredProcessFragments.Any(fragment => lowerName.Contains(fragment, StringComparison.OrdinalIgnoreCase));
    }

    private static bool LooksLikeGameLauncherEntry(LauncherEntryPayload launcher, RunningProcessInfo process)
    {
        if (TryInferKnownGamePath(process.ExecutablePath, out _)
            || TryInferKnownGamePath(launcher.ExecutablePath, out _))
        {
            return true;
        }

        var combined = $"{launcher.DisplayName} {launcher.ExecutablePath} {process.ProcessName}".ToLowerInvariant();
        return GameKeywordFragments.Any(fragment => combined.Contains(fragment, StringComparison.OrdinalIgnoreCase));
    }

    private static bool LooksLikeManualGameCandidate(RunningProcessInfo process)
    {
        var executablePath = NormalizePath(process.ExecutablePath);
        var lowerPath = executablePath.ToLowerInvariant();
        var processName = Path.GetFileNameWithoutExtension(process.ProcessName);
        if (string.IsNullOrWhiteSpace(executablePath)
            || string.IsNullOrWhiteSpace(processName)
            || !string.Equals(Path.GetExtension(executablePath), ".exe", StringComparison.OrdinalIgnoreCase)
            || lowerPath.Contains(@"\windows\", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (TryInferKnownGamePath(executablePath, out _))
        {
            return true;
        }

        if (GameKeywordFragments.Any(fragment => lowerPath.Contains(fragment, StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        var lowerName = processName.ToLowerInvariant();
        if (lowerName.Length < 3
            || lowerName.Contains("service", StringComparison.OrdinalIgnoreCase)
            || lowerName.Contains("updater", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return lowerPath.Contains(@"\games\", StringComparison.OrdinalIgnoreCase)
            || lowerPath.Contains(@"\game\", StringComparison.OrdinalIgnoreCase)
            || lowerPath.Contains(@"\xboxgames\", StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryInferKnownGamePath(string executablePath, out InferredGamePath inferred)
    {
        var normalized = NormalizePath(executablePath);
        var lower = normalized.ToLowerInvariant();
        inferred = default;

        if (TryInferFromMarker(normalized, lower, @"\steamapps\common\", "Steam", "Steam library", 86, out inferred))
        {
            return true;
        }

        if (TryInferFromMarker(normalized, lower, @"\epic games\", "Epic Games", "Epic library", 84, out inferred))
        {
            return true;
        }

        if (TryInferFromMarker(normalized, lower, @"\gog games\", "GOG", "GOG library", 82, out inferred)
            || TryInferFromMarker(normalized, lower, @"\gog galaxy\games\", "GOG", "GOG Galaxy library", 82, out inferred))
        {
            return true;
        }

        if (TryInferFromMarker(normalized, lower, @"\xboxgames\", "Xbox", "Xbox games library", 80, out inferred))
        {
            return true;
        }

        if (TryInferFromMarker(normalized, lower, @"\ea games\", "EA", "EA games library", 78, out inferred)
            || TryInferFromMarker(normalized, lower, @"\origin games\", "EA", "EA games library", 78, out inferred))
        {
            return true;
        }

        if (TryInferFromMarker(normalized, lower, @"\riot games\", "Riot", "Riot games library", 78, out inferred))
        {
            return true;
        }

        if (TryInferFromMarker(normalized, lower, @"\ubisoft game launcher\games\", "Ubisoft", "Ubisoft library", 78, out inferred))
        {
            return true;
        }

        if (TryInferBattleNetGamePath(lower, out inferred))
        {
            return true;
        }

        if (TryInferFromMarker(normalized, lower, @"\.minecraft\", "Minecraft", "Minecraft profile", 76, out inferred)
            || TryInferFromMarker(normalized, lower, @"\prismlauncher\instances\", "Minecraft", "Minecraft launcher", 76, out inferred)
            || TryInferFromMarker(normalized, lower, @"\curseforge\minecraft\instances\", "Minecraft", "Minecraft launcher", 76, out inferred))
        {
            inferred = inferred with { Name = "Minecraft" };
            return true;
        }

        foreach (var blizzardName in new[] { "World of Warcraft", "Overwatch", "Diablo", "Hearthstone", "StarCraft", "Call of Duty" })
        {
            var marker = @"\" + blizzardName.ToLowerInvariant() + @"\";
            if (lower.Contains(marker, StringComparison.OrdinalIgnoreCase))
            {
                inferred = new InferredGamePath(
                    blizzardName,
                    "Battle.net",
                    "Battle.net library",
                    82,
                    "Matched a running process inside a Battle.net game folder.");
                return true;
            }
        }

        return false;
    }

    private static bool TryInferBattleNetGamePath(string lowerPath, out InferredGamePath inferred)
    {
        foreach (var game in BattleNetKnownGames)
        {
            if (!game.PathMarkers.Any(marker => lowerPath.Contains(marker, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            inferred = new InferredGamePath(
                game.Name,
                "Battle.net",
                "Battle.net library",
                84,
                $"Matched a running process inside the {game.Name} install folder.");
            return true;
        }

        inferred = default;
        return false;
    }

    private static bool TryInferFromMarker(
        string normalizedPath,
        string lowerPath,
        string marker,
        string platform,
        string source,
        int confidence,
        out InferredGamePath inferred)
    {
        inferred = default;
        var index = lowerPath.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (index < 0)
        {
            return false;
        }

        var tail = normalizedPath[(index + marker.Length)..];
        var name = tail.Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault();
        inferred = new InferredGamePath(
            CleanGameName(name),
            platform,
            source,
            confidence,
            $"Matched a running process inside the {platform} game folder.");
        return !string.IsNullOrWhiteSpace(inferred.Name);
    }

    private static List<EpicInstalledGame> ReadEpicInstalledGames()
    {
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        var manifestsPath = string.IsNullOrWhiteSpace(programData)
            ? ""
            : Path.Combine(programData, "Epic", "EpicGamesLauncher", "Data", "Manifests");
        var games = new List<EpicInstalledGame>();

        if (string.IsNullOrWhiteSpace(manifestsPath) || !Directory.Exists(manifestsPath))
        {
            return games;
        }

        IEnumerable<string> manifestPaths;
        try
        {
            manifestPaths = Directory.EnumerateFiles(manifestsPath, "*.item", SearchOption.TopDirectoryOnly).ToList();
        }
        catch
        {
            return games;
        }

        foreach (var manifestPath in manifestPaths)
        {
            try
            {
                using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
                var root = document.RootElement;
                var displayName = TextOr(GetJsonString(root, "DisplayName"), GetJsonString(root, "AppName"));
                var installLocation = NormalizePath(GetJsonString(root, "InstallLocation"));
                var launchExecutable = GetJsonString(root, "LaunchExecutable");
                var launchExecutablePath = string.IsNullOrWhiteSpace(installLocation) || string.IsNullOrWhiteSpace(launchExecutable)
                    ? ""
                    : NormalizePath(Path.Combine(installLocation, launchExecutable.Replace('/', Path.DirectorySeparatorChar)));

                if (string.IsNullOrWhiteSpace(displayName)
                    || string.IsNullOrWhiteSpace(installLocation)
                    || !Directory.Exists(installLocation))
                {
                    continue;
                }

                games.Add(new EpicInstalledGame(displayName, installLocation, launchExecutablePath));
            }
            catch
            {
            }
        }

        return games;
    }

    private static string GetJsonString(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";
    }

    private static bool IsUsableExecutablePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)
            || path.Contains("://", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(Path.GetExtension(path), ".exe", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        try
        {
            return File.Exists(path);
        }
        catch
        {
            return false;
        }
    }

    private static string ResolveLauncherRoot(string executablePath)
    {
        try
        {
            var directory = Path.GetDirectoryName(executablePath);
            if (string.IsNullOrWhiteSpace(directory))
            {
                return "";
            }

            var lower = directory.ToLowerInvariant();
            foreach (var marker in new[] { @"\steamapps\common\", @"\epic games\", @"\gog games\", @"\xboxgames\", @"\ea games\", @"\riot games\" })
            {
                var index = lower.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
                if (index >= 0)
                {
                    var afterMarker = directory[(index + marker.Length)..];
                    var gameFolder = afterMarker.Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries)
                        .FirstOrDefault();
                    return string.IsNullOrWhiteSpace(gameFolder)
                        ? directory
                        : Path.Combine(directory[..(index + marker.Length)], gameFolder);
                }
            }

            return directory;
        }
        catch
        {
            return "";
        }
    }

    private static string InferPlatform(string displayName, string executablePath)
    {
        var combined = $"{displayName} {executablePath}".ToLowerInvariant();
        if (combined.Contains("steam", StringComparison.OrdinalIgnoreCase))
        {
            return "Steam";
        }

        if (combined.Contains("epic", StringComparison.OrdinalIgnoreCase))
        {
            return "Epic Games";
        }

        if (combined.Contains("gog", StringComparison.OrdinalIgnoreCase))
        {
            return "GOG";
        }

        if (combined.Contains("battle.net", StringComparison.OrdinalIgnoreCase)
            || combined.Contains("blizzard", StringComparison.OrdinalIgnoreCase))
        {
            return "Battle.net";
        }

        if (combined.Contains("xbox", StringComparison.OrdinalIgnoreCase))
        {
            return "Xbox";
        }

        return "Pinned";
    }

    private static bool IsPathInside(string path, string directory)
    {
        if (string.IsNullOrWhiteSpace(path) || string.IsNullOrWhiteSpace(directory))
        {
            return false;
        }

        try
        {
            var normalizedDirectory = NormalizePath(directory)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            var normalizedPath = NormalizePath(path);
            return normalizedPath.StartsWith(normalizedDirectory, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static string NormalizePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return "";
        }

        try
        {
            return Path.GetFullPath(path.Trim());
        }
        catch
        {
            return path.Trim();
        }
    }

    private static string CleanGameName(string? name)
    {
        var value = TextOr(name, "");
        if (string.IsNullOrWhiteSpace(value))
        {
            return "";
        }

        value = Path.GetFileNameWithoutExtension(value)
            .Replace('_', ' ')
            .Replace('-', ' ')
            .Replace('.', ' ');
        foreach (var fragment in new[] { " Win64 Shipping", " Shipping", " Launcher", " Client", " x64", " x86" })
        {
            value = value.Replace(fragment, "", StringComparison.OrdinalIgnoreCase);
        }

        return string.Join(' ', value.Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    private static string ResolveTileLabel(string? name)
    {
        var words = CleanGameName(name).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length >= 2)
        {
            return string.Concat(words.Take(2).Select(word => char.ToUpperInvariant(word[0])));
        }

        var value = TextOr(words.FirstOrDefault(), "G");
        return value.Length >= 2
            ? value[..2].ToUpperInvariant()
            : value[..1].ToUpperInvariant();
    }

    private static string TextOr(string? value, string fallback)
    {
        return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
    }

    private static string BuildStableId(string platform, string name, string executablePath)
    {
        var input = $"{platform}|{name}|{NormalizePath(executablePath)}".ToLowerInvariant();
        const ulong offset = 14695981039346656037;
        const ulong prime = 1099511628211;
        var hash = offset;
        foreach (var ch in input)
        {
            hash ^= ch;
            hash *= prime;
        }

        return $"{TextOr(platform, "game").ToLowerInvariant()}:{hash:x}";
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    private sealed record RunningProcessInfo(
        int ProcessId,
        string ProcessName,
        string ExecutablePath,
        DateTimeOffset? StartedAt);

    private sealed record EpicInstalledGame(
        string DisplayName,
        string InstallLocation,
        string LaunchExecutablePath);

    private sealed record BattleNetKnownGame(
        string Name,
        string[] PathMarkers);

    private readonly record struct InferredGamePath(
        string Name,
        string Platform,
        string Source,
        int Confidence,
        string Reason);
}

public sealed class GameActivitySnapshot
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; }

    public string Status { get; set; } = "idle";

    public string Mode { get; set; } = "idle";

    public string StateLabel { get; set; } = "Idle";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Active { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public string Source { get; set; } = "running processes";

    public GameActivityPayload? ActiveGame { get; set; }

    public GameActivityPayload? LastGame { get; set; }

    public DateTimeOffset? LastEndedAt { get; set; }

    public List<GameActivityPayload> Candidates { get; set; } = [];

    public int? ForegroundProcessId { get; set; }

    public string ForegroundProcessName { get; set; } = "";
}

public sealed class GameActivityPayload
{
    public string Id { get; set; } = "";

    public string Name { get; set; } = "";

    public string Platform { get; set; } = "";

    public string Source { get; set; } = "";

    public int? ProcessId { get; set; }

    public string ProcessName { get; set; } = "";

    public string ExecutablePath { get; set; } = "";

    public int Confidence { get; set; }

    public string Reason { get; set; } = "";

    public string State { get; set; } = "";

    public bool Focused { get; set; }

    public string ForegroundProcessName { get; set; } = "";

    public DateTimeOffset? StartedAt { get; set; }

    public DateTimeOffset? SessionStartedAt { get; set; }

    public long SessionDurationMs { get; set; }

    public string ArtworkUrl { get; set; } = "";

    public string IconUrl { get; set; } = "";

    public string TileLabel { get; set; } = "G";
}

public sealed class GameActivityPinRequest
{
    public string? Id { get; set; }

    public int? ProcessId { get; set; }
}

public sealed class GameActivityPinResult
{
    public bool Ok { get; set; }

    public bool Added { get; set; }

    public string Message { get; set; } = "";

    public GameActivityPayload? Game { get; set; }
}
