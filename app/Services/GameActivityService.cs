using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace XenonEdgeHost;

public sealed class GameActivityService
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(6);
    private static readonly TimeSpan WmiProcessScanCooldown = TimeSpan.FromSeconds(30);
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
    private readonly GameBlocklistStore _gameBlocklistStore;
    private readonly HostLogger _logger;
    private readonly object _sync = new();
    private GameActivitySnapshot? _cachedSnapshot;
    private DateTimeOffset _cachedAt = DateTimeOffset.MinValue;
    private GameActivityPayload? _lastActiveGame;
    private string _lastActiveGameId = "";
    private DateTimeOffset? _sessionStartedAt;
    private DateTimeOffset? _lastEndedAt;
    private DateTimeOffset _lastWmiProcessScanAt = DateTimeOffset.MinValue;
    private ManualSelection? _manualSelection;

    public GameActivityService(
        SteamService steamService,
        LauncherService launcherService,
        ConfigStore configStore,
        GameBlocklistStore gameBlocklistStore,
        HostLogger logger)
    {
        _steamService = steamService;
        _launcherService = launcherService;
        _configStore = configStore;
        _gameBlocklistStore = gameBlocklistStore;
        _logger = logger;
    }

    public GameActivitySnapshot GetSnapshot(bool forceRefresh = false)
    {
        return GetSnapshot(forceRefresh, steamRefresh: forceRefresh);
    }

    // Blocklist and selection actions need fresh process data, not a Steam library rescan.
    private GameActivitySnapshot GetFreshProcessSnapshot()
    {
        return GetSnapshot(forceRefresh: true, steamRefresh: false);
    }

    private GameActivitySnapshot GetSnapshot(bool forceRefresh, bool steamRefresh)
    {
        lock (_sync)
        {
            if (!forceRefresh
                && _cachedSnapshot is not null
                && DateTimeOffset.UtcNow - _cachedAt < CacheDuration)
            {
                return _cachedSnapshot;
            }

            _cachedSnapshot = BuildSnapshot(steamRefresh);
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
            current.PinnedGames ??= [];
            var path = NormalizePath(candidate.ExecutablePath);
            var existing = current.PinnedGames.FirstOrDefault(entry =>
                string.Equals(NormalizePath(entry.ExecutablePath), path, StringComparison.OrdinalIgnoreCase));
            if (existing is not null)
            {
                return current;
            }

            current.PinnedGames.Add(new LauncherEntryConfig
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

        // A pinned game and a blocked item are mutually exclusive; the newest action wins.
        var unblocked = _gameBlocklistStore.RemoveByExecutablePath(candidate.ExecutablePath);
        InvalidateCache();

        return new GameActivityPinResult
        {
            Ok = true,
            Added = added,
            Unblocked = unblocked,
            Game = candidate,
            Message = added
                ? $"{candidate.Name} will be treated as a game from now on."
                : $"{candidate.Name} is already pinned."
        };
    }

    public GameBlocklistSnapshot GetBlocklist()
    {
        var snapshot = _gameBlocklistStore.Snapshot();
        snapshot.SystemExclusions = SystemGameExclusions.DescribeRules().ToList();
        return snapshot;
    }

    public GameBlocklistSources GetBlocklistSources()
    {
        var snapshot = GetFreshProcessSnapshot();
        var detected = new List<GameBlocklistSourceItem>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var detectedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var candidate in EnumerateDetected(snapshot))
        {
            if (!seen.Add(candidate.Id))
            {
                continue;
            }

            if (!string.IsNullOrWhiteSpace(candidate.ExecutablePath))
            {
                detectedPaths.Add(NormalizePath(candidate.ExecutablePath));
            }

            detected.Add(new GameBlocklistSourceItem
            {
                Ref = "candidate:" + candidate.Id,
                Name = TextOr(candidate.Name, "App"),
                Source = TextOr(candidate.Source, candidate.Platform),
                ExecutableName = string.IsNullOrWhiteSpace(candidate.ExecutablePath) ? "" : Path.GetFileName(candidate.ExecutablePath),
                Confidence = candidate.Confidence,
                Active = snapshot.ActiveGame is not null
                    && string.Equals(snapshot.ActiveGame.Id, candidate.Id, StringComparison.OrdinalIgnoreCase)
            });
        }

        var running = ReadRunningProcesses()
            .Where(process => !string.IsNullOrWhiteSpace(process.ExecutablePath)
                && !SystemGameExclusions.IsExcluded(process.ProcessName, process.ExecutablePath)
                && !_gameBlocklistStore.IsBlocked(process.ExecutablePath, null)
                && !detectedPaths.Contains(NormalizePath(process.ExecutablePath)))
            .GroupBy(process => NormalizePath(process.ExecutablePath), StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Select(process => new GameBlocklistSourceItem
            {
                Ref = "process:" + process.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture),
                Name = TextOr(CleanGameName(process.ProcessName), Path.GetFileNameWithoutExtension(process.ExecutablePath)),
                Source = "Running app",
                ExecutableName = Path.GetFileName(process.ExecutablePath)
            })
            .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new GameBlocklistSources
        {
            Detected = detected,
            Running = running
        };
    }

    public GameBlocklistAddResult AddToBlocklist(GameBlocklistAddRequest request)
    {
        var reference = request.Ref?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(reference))
        {
            throw new ArgumentException("Choose an app to ignore.");
        }

        string displayName;
        string executablePath;
        string launcherId;
        string source;
        if (reference.StartsWith("candidate:", StringComparison.OrdinalIgnoreCase))
        {
            var candidateId = reference["candidate:".Length..];
            var candidate = FindDetected(GetSnapshot(), candidateId)
                ?? FindDetected(GetFreshProcessSnapshot(), candidateId)
                ?? throw new GameBlocklistReferenceNotFoundException();
            displayName = TextOr(candidate.Name, "App");
            executablePath = candidate.ExecutablePath;
            launcherId = GameCandidatePolicy.LauncherIdOf(candidate);
            source = TextOr(candidate.Source, candidate.Platform);
        }
        else if (reference.StartsWith("process:", StringComparison.OrdinalIgnoreCase)
            && int.TryParse(reference["process:".Length..], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var processId)
            && processId > 0)
        {
            var process = ReadRunningProcesses().FirstOrDefault(entry => entry.ProcessId == processId);
            if (process is null || string.IsNullOrWhiteSpace(process.ExecutablePath) || !File.Exists(process.ExecutablePath))
            {
                throw new GameBlocklistReferenceNotFoundException();
            }

            displayName = TextOr(CleanGameName(process.ProcessName), Path.GetFileNameWithoutExtension(process.ExecutablePath));
            executablePath = process.ExecutablePath;
            launcherId = "";
            source = "Running app";
        }
        else
        {
            throw new GameBlocklistReferenceNotFoundException();
        }

        var (entry, added) = _gameBlocklistStore.Add(displayName, executablePath, launcherId, source);

        var unpinned = false;
        var normalizedPath = NormalizePath(executablePath);
        if (!string.IsNullOrWhiteSpace(normalizedPath)
            && _configStore.Snapshot().PinnedGames.Any(pinned =>
                string.Equals(NormalizePath(pinned.ExecutablePath), normalizedPath, StringComparison.OrdinalIgnoreCase)))
        {
            _configStore.Update(current =>
            {
                current.PinnedGames = (current.PinnedGames ?? [])
                    .Where(pinned => !string.Equals(NormalizePath(pinned.ExecutablePath), normalizedPath, StringComparison.OrdinalIgnoreCase))
                    .ToList();
                return current;
            });
            unpinned = true;
        }

        var selectionCleared = false;
        lock (_sync)
        {
            if (_manualSelection is not null
                && (_gameBlocklistStore.IsBlocked(_manualSelection.ExecutablePath, null)
                    || _gameBlocklistStore.IsBlocked(null, LauncherIdOfSelection(_manualSelection))))
            {
                _manualSelection = null;
                selectionCleared = true;
            }

            InvalidateCache();
        }

        return new GameBlocklistAddResult
        {
            Ok = true,
            Added = added,
            Entry = entry,
            Unpinned = unpinned,
            SelectionCleared = selectionCleared,
            Message = added
                ? $"{entry.DisplayName} is now ignored by Game Mode."
                : $"{entry.DisplayName} is already ignored by Game Mode."
        };
    }

    public GameBlocklistRemoveResult RemoveFromBlocklist(GameBlocklistRemoveRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Id))
        {
            throw new ArgumentException("Choose an entry to remove.");
        }

        var removed = _gameBlocklistStore.Remove(request.Id);
        InvalidateCache();
        return new GameBlocklistRemoveResult
        {
            Ok = true,
            Removed = removed
        };
    }

    public GameActivitySnapshot Select(GameActivitySelectRequest request)
    {
        var wantsAuto = string.Equals(request.Mode?.Trim(), "auto", StringComparison.OrdinalIgnoreCase);
        var candidateId = request.CandidateId?.Trim() ?? "";
        if (wantsAuto == !string.IsNullOrWhiteSpace(candidateId)
            || (!wantsAuto && !string.IsNullOrWhiteSpace(request.Mode)))
        {
            throw new ArgumentException("Send either a candidateId or mode \"auto\".");
        }

        lock (_sync)
        {
            if (wantsAuto)
            {
                _manualSelection = null;
            }
            else
            {
                var candidate = FindTrackable(GetSnapshot(), candidateId)
                    ?? FindTrackable(GetFreshProcessSnapshot(), candidateId)
                    ?? throw new GameCandidateNotFoundException();
                _manualSelection = new ManualSelection(
                    candidate.Id,
                    candidate.ProcessId,
                    NormalizePath(candidate.ExecutablePath),
                    DateTimeOffset.UtcNow);
                // Force the next read to treat the choice as a new session, even when the chosen
                // candidate is already the active one.
                _lastActiveGameId = "";
                _sessionStartedAt = null;
            }

            InvalidateCache();
            return GetFreshProcessSnapshot();
        }
    }

    private static GameActivityPayload? FindDetected(GameActivitySnapshot snapshot, string candidateId)
    {
        return EnumerateDetected(snapshot)
            .FirstOrDefault(entry => string.Equals(entry.Id, candidateId, StringComparison.OrdinalIgnoreCase));
    }

    private static GameActivityPayload? FindTrackable(GameActivitySnapshot snapshot, string candidateId)
    {
        return snapshot.Trackable
            .FirstOrDefault(entry => string.Equals(entry.Id, candidateId, StringComparison.OrdinalIgnoreCase));
    }

    private void InvalidateCache()
    {
        lock (_sync)
        {
            _cachedSnapshot = null;
            _cachedAt = DateTimeOffset.MinValue;
        }
    }

    private static IEnumerable<GameActivityPayload> EnumerateDetected(GameActivitySnapshot snapshot)
    {
        if (snapshot.ActiveGame is not null)
        {
            yield return snapshot.ActiveGame;
        }

        foreach (var candidate in snapshot.Trackable)
        {
            yield return candidate;
        }

        foreach (var candidate in snapshot.Candidates)
        {
            yield return candidate;
        }
    }

    private static string LauncherIdOfSelection(ManualSelection selection)
    {
        return GameCandidatePolicy.LauncherIdOf(new GameActivityPayload { Id = selection.CandidateId });
    }

    private GameActivitySnapshot BuildSnapshot(bool steamRefresh)
    {
        try
        {
            var sampledAt = DateTimeOffset.UtcNow;
            var config = _configStore.Snapshot();
            var launcherSnapshot = _launcherService.GetSnapshot(config);
            var steamSnapshot = _steamService.GetSnapshot(steamRefresh);
            var epicGames = ReadEpicInstalledGames();
            var launcherEntries = launcherSnapshot.Entries
                .Where(entry => IsUsableExecutablePath(entry.ExecutablePath))
                .ToList();
            var pinnedGames = config.PinnedGames
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
                AddPinnedGameCandidate(candidates, pinnedGames, process);
                AddPinnedLauncherCandidate(candidates, launcherEntries, process);
                AddKnownGamePathCandidate(candidates, process);
                AddFallbackProcessCandidate(candidates, process);
            }

            var policy = GameCandidatePolicy.Apply(
                candidates,
                _gameBlocklistStore.IsBlocked,
                _manualSelection,
                steamSnapshot.ActiveGame is null ? null : $"steam:{steamSnapshot.ActiveGame.AppId}");
            if (policy.SelectionCleared)
            {
                _manualSelection = null;
            }

            var activeGame = policy.ActiveGame;
            var mode = ResolveMode(activeGame, foregroundProcess, sampledAt);
            var lastGame = mode == "ended" && !GameCandidatePolicy.ShouldSuppressEnded(_lastActiveGame, _gameBlocklistStore.IsBlocked)
                ? _lastActiveGame
                : null;
            if (mode == "ended" && lastGame is null)
            {
                mode = "idle";
            }

            var blocklist = _gameBlocklistStore.Snapshot();

            return new GameActivitySnapshot
            {
                Supported = true,
                Configured = steamSnapshot.Configured || pinnedGames.Count > 0 || launcherSnapshot.Configured || epicGames.Count > 0,
                Status = activeGame is null ? mode : "active",
                Mode = mode,
                StateLabel = ModeLabel(mode),
                Active = activeGame is not null,
                ActiveGame = activeGame,
                LastGame = lastGame,
                LastEndedAt = mode == "ended" ? _lastEndedAt : null,
                Candidates = policy.Candidates,
                Trackable = policy.Trackable,
                BlockedIds = policy.BlockedIds,
                Selection = new GameActivitySelectionState
                {
                    Mode = _manualSelection is null ? "auto" : "manual",
                    CandidateId = _manualSelection?.CandidateId ?? "",
                    SelectedAt = _manualSelection?.SelectedAt
                },
                Blocklist = new GameActivityBlocklistState
                {
                    Status = blocklist.Status,
                    Count = blocklist.Entries.Count
                },
                ForegroundProcessId = foregroundProcess?.ProcessId,
                ForegroundProcessName = foregroundProcess?.ProcessName ?? "",
                ForegroundAppActive = foregroundProcess is not null,
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
            if (GameCandidatePolicy.ShouldSuppressEnded(_lastActiveGame, _gameBlocklistStore.IsBlocked))
            {
                // The game went away because the user blocked it: no "ended" state (FR-002).
                _lastActiveGame = null;
                _lastActiveGameId = "";
                _sessionStartedAt = null;
                _lastEndedAt = null;
                return "idle";
            }

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
            _sessionStartedAt = GameCandidatePolicy.ResolveSessionStart(activeGame, sampledAt);
            _lastActiveGameId = activeId;
        }
        else
        {
            _sessionStartedAt ??= GameCandidatePolicy.ResolveSessionStart(activeGame, sampledAt);
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
                var knownGamePath = IsKnownGamePathMatch(launcher, process);
                if (!knownGamePath && !LooksLikeGameLauncherEntry(launcher, process))
                {
                    continue;
                }

                candidates.Add(CreatePayload(
                    name: launcher.DisplayName,
                    platform: InferPlatform(launcher.DisplayName, executablePath),
                    source: knownGamePath ? "Game library" : "Recent app candidate",
                    process,
                    confidence: knownGamePath ? 78 : 55,
                    reason: knownGamePath
                        ? "Matched a running process from an approved game entry."
                        : "Matched game-like keywords in a recent app. Pin it if this should trigger Game Mode.",
                    artworkUrl: "",
                    iconUrl: launcher.IconUrl));
                continue;
            }

            var launcherRoot = ResolveLauncherRoot(executablePath);
            if (!string.IsNullOrWhiteSpace(launcherRoot)
                && IsPathInside(processPath, launcherRoot))
            {
                var knownGamePath = IsKnownGamePathMatch(launcher, process);
                if (!knownGamePath && !LooksLikeGameLauncherEntry(launcher, process))
                {
                    continue;
                }

                candidates.Add(CreatePayload(
                    name: launcher.DisplayName,
                    platform: InferPlatform(launcher.DisplayName, executablePath),
                    source: knownGamePath ? "Game library" : "Recent app candidate",
                    process,
                    confidence: knownGamePath ? 68 : 55,
                    reason: knownGamePath
                        ? "Matched a running process near an approved game executable."
                        : "Matched game-like keywords near a recent app. Pin it if this should trigger Game Mode.",
                    artworkUrl: "",
                    iconUrl: launcher.IconUrl));
            }
        }
    }

    private static void AddPinnedGameCandidate(
        List<GameActivityPayload> candidates,
        IReadOnlyList<LauncherEntryConfig> pinnedGames,
        RunningProcessInfo process)
    {
        foreach (var pinnedGame in pinnedGames)
        {
            var executablePath = NormalizePath(pinnedGame.ExecutablePath);
            var processPath = NormalizePath(process.ExecutablePath);
            if (string.IsNullOrWhiteSpace(executablePath) || !File.Exists(executablePath))
            {
                continue;
            }

            if (string.Equals(processPath, executablePath, StringComparison.OrdinalIgnoreCase))
            {
                candidates.Add(CreatePayload(
                    name: pinnedGame.DisplayName,
                    platform: InferPlatform(pinnedGame.DisplayName, executablePath),
                    source: "Pinned game",
                    process,
                    confidence: 78,
                    reason: "Matched an explicitly pinned game executable.",
                    artworkUrl: "",
                    iconUrl: ""));
                continue;
            }

            var pinnedRoot = ResolveLauncherRoot(executablePath);
            if (!string.IsNullOrWhiteSpace(pinnedRoot)
                && IsPathInside(processPath, pinnedRoot))
            {
                candidates.Add(CreatePayload(
                    name: pinnedGame.DisplayName,
                    platform: InferPlatform(pinnedGame.DisplayName, executablePath),
                    source: "Pinned game",
                    process,
                    confidence: 68,
                    reason: "Matched a running process near an explicitly pinned game executable.",
                    artworkUrl: "",
                    iconUrl: ""));
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

    private List<RunningProcessInfo> ReadRunningProcesses()
    {
        var results = new Dictionary<int, RunningProcessInfo>();
        var inaccessibleProcessModules = 0;
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
                inaccessibleProcessModules++;
            }
            finally
            {
                process.Dispose();
            }
        }

        if (inaccessibleProcessModules > 0
            && DateTimeOffset.UtcNow - _lastWmiProcessScanAt >= WmiProcessScanCooldown)
        {
            _lastWmiProcessScanAt = DateTimeOffset.UtcNow;
            AddWmiProcesses(results);
        }

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
        return SystemGameExclusions.IsExcluded(process.ProcessName, process.ExecutablePath);
    }

    private static bool LooksLikeGameLauncherEntry(LauncherEntryPayload launcher, RunningProcessInfo process)
    {
        var combined = $"{launcher.DisplayName} {launcher.ExecutablePath} {process.ProcessName}".ToLowerInvariant();
        return ContainsGameKeyword(combined);
    }

    private static bool IsKnownGamePathMatch(LauncherEntryPayload launcher, RunningProcessInfo process)
    {
        return TryInferKnownGamePath(process.ExecutablePath, out _)
            || TryInferKnownGamePath(launcher.ExecutablePath, out _);
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

        if (ContainsGameKeyword(lowerPath))
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

        if (TryInferWindowsAppsGamePath(normalized, lower, out inferred))
        {
            return true;
        }

        return false;
    }

    private static bool TryInferWindowsAppsGamePath(string normalizedPath, string lowerPath, out InferredGamePath inferred)
    {
        inferred = default;
        if (!lowerPath.Contains(@"\windowsapps\", StringComparison.OrdinalIgnoreCase)
            || !ContainsGameKeyword(lowerPath))
        {
            return false;
        }

        var displayName = CleanGameName(Path.GetFileNameWithoutExtension(normalizedPath));
        inferred = new InferredGamePath(
            TextOr(displayName, "Game Pass title"),
            "Xbox",
            "WindowsApps game package",
            62,
            "Matched a WindowsApps package with game keywords.");
        return true;
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
        if (ContainsKeywordWithBoundaries(combined, "steam")
            || ContainsKeywordWithBoundaries(combined, "steamapps"))
        {
            return "Steam";
        }

        if (ContainsKeywordWithBoundaries(combined, "epic")
            || ContainsKeywordWithBoundaries(combined, "epic games"))
        {
            return "Epic Games";
        }

        if (ContainsKeywordWithBoundaries(combined, "gog")
            || ContainsKeywordWithBoundaries(combined, "gog galaxy")
            || ContainsKeywordWithBoundaries(combined, "gog games"))
        {
            return "GOG";
        }

        if (ContainsKeywordWithBoundaries(combined, "battle.net")
            || ContainsKeywordWithBoundaries(combined, "blizzard"))
        {
            return "Battle.net";
        }

        if (ContainsKeywordWithBoundaries(combined, "xbox")
            || ContainsKeywordWithBoundaries(combined, "xboxgames"))
        {
            return "Xbox";
        }

        return "Pinned";
    }

    private static bool ContainsGameKeyword(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        return GameKeywordFragments.Any(fragment => ContainsKeywordWithBoundaries(value, fragment));
    }

    private static bool ContainsKeywordWithBoundaries(string value, string keyword)
    {
        if (string.IsNullOrWhiteSpace(value) || string.IsNullOrWhiteSpace(keyword))
        {
            return false;
        }

        var searchIndex = 0;
        while (searchIndex < value.Length)
        {
            var index = value.IndexOf(keyword, searchIndex, StringComparison.OrdinalIgnoreCase);
            if (index < 0)
            {
                return false;
            }

            var end = index + keyword.Length;
            var startsCleanly = index == 0 || IsKeywordBoundary(value[index - 1]);
            var endsCleanly = end >= value.Length || IsKeywordBoundary(value[end]);
            if (startsCleanly && endsCleanly)
            {
                return true;
            }

            searchIndex = index + 1;
        }

        return false;
    }

    private static bool IsKeywordBoundary(char value)
    {
        return !char.IsLetterOrDigit(value);
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

    public List<GameActivityPayload> Trackable { get; set; } = [];

    public GameActivitySelectionState Selection { get; set; } = new();

    public GameActivityBlocklistState Blocklist { get; set; } = new();

    [JsonIgnore]
    public int? ForegroundProcessId { get; set; }

    [JsonIgnore]
    public string ForegroundProcessName { get; set; } = "";

    [JsonIgnore]
    public HashSet<string> BlockedIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public bool ForegroundAppActive { get; set; }
}

public sealed class GameActivityPayload
{
    public string Id { get; set; } = "";

    public string Name { get; set; } = "";

    public string Platform { get; set; } = "";

    public string Source { get; set; } = "";

    [JsonIgnore]
    public int? ProcessId { get; set; }

    [JsonIgnore]
    public string ProcessName { get; set; } = "";

    [JsonIgnore]
    public string ExecutablePath { get; set; } = "";

    public int Confidence { get; set; }

    public string Reason { get; set; } = "";

    public string State { get; set; } = "";

    public bool Focused { get; set; }

    [JsonIgnore]
    public string ForegroundProcessName { get; set; } = "";

    public bool HasRuntimeIdentity => ProcessId.HasValue || !string.IsNullOrWhiteSpace(ProcessName);

    public bool CanPin => !string.IsNullOrWhiteSpace(ExecutablePath);

    public DateTimeOffset? StartedAt { get; set; }

    public bool Selected { get; set; }

    public bool Manual { get; set; }

    public DateTimeOffset? SessionStartedAt { get; set; }

    public long SessionDurationMs { get; set; }

    public string ArtworkUrl { get; set; } = "";

    public string IconUrl { get; set; } = "";

    public string TileLabel { get; set; } = "G";
}

public sealed class GameActivitySelectionState
{
    public string Mode { get; set; } = "auto";

    public string CandidateId { get; set; } = "";

    public DateTimeOffset? SelectedAt { get; set; }
}

public sealed class GameActivityBlocklistState
{
    public string Status { get; set; } = "ready";

    public int Count { get; set; }
}

public sealed class GameActivitySelectRequest
{
    public string? CandidateId { get; set; }

    public string? Mode { get; set; }
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

    public bool Unblocked { get; set; }

    public string Message { get; set; } = "";

    public GameActivityPayload? Game { get; set; }
}
