namespace XenonEdgeHost;

public sealed record ManualSelection(
    string CandidateId,
    int? ProcessId,
    string ExecutablePath,
    DateTimeOffset SelectedAt);

public sealed class GameCandidatePolicyResult
{
    public GameActivityPayload? ActiveGame { get; init; }

    public List<GameActivityPayload> Trackable { get; init; } = [];

    public List<GameActivityPayload> Candidates { get; init; } = [];

    // Ids of the candidate groups dropped by the blocklist, so other Steam-derived views of the
    // same app (SteamService.ActiveGame) can be hidden too.
    public HashSet<string> BlockedIds { get; init; } = new(StringComparer.OrdinalIgnoreCase);

    public bool SelectionCleared { get; init; }

    public ManualSelection? Selection { get; init; }
}

// Pure filtering, ordering and selection rules for Game Mode candidates. It performs no I/O so
// the blocklist, manual selection and "ended" suppression rules can be unit tested directly.
public static class GameCandidatePolicy
{
    public const int AutomaticConfidenceThreshold = 60;
    public const int CandidateLimit = 8;

    private const char InstanceSeparator = '#';

    public static GameCandidatePolicyResult Apply(
        IEnumerable<GameActivityPayload> rawCandidates,
        Func<string?, string?, bool> isBlocked,
        ManualSelection? selection,
        string? steamReportedActiveId)
    {
        var clusters = MergeFragments(rawCandidates);
        // Block per cluster: a path-only entry matches just the process fragment, so a path-less
        // Steam-reported fragment of the same app would otherwise survive.
        var blockedClusters = clusters
            .Where(cluster => cluster.Any(candidate => isBlocked(candidate.ExecutablePath, LauncherIdOf(candidate))))
            .ToList();
        var blockedIds = blockedClusters
            .SelectMany(cluster => cluster)
            .Select(candidate => candidate.Id)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var ordered = clusters
            .Where(cluster => !blockedClusters.Contains(cluster))
            .Select(SelectBestCandidate)
            .OrderByDescending(candidate => candidate.Confidence)
            .ThenByDescending(candidate => candidate.StartedAt.HasValue)
            .ThenByDescending(candidate => candidate.StartedAt ?? DateTimeOffset.MinValue)
            .ToList();
        MakeInstanceIdsUnique(ordered);

        var trackable = ordered
            .Where(candidate => candidate.ProcessId.HasValue
                || (!string.IsNullOrWhiteSpace(steamReportedActiveId)
                    && string.Equals(candidate.Id, steamReportedActiveId, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        GameActivityPayload? activeGame = null;
        var selectionCleared = false;
        var keptSelection = selection;
        if (selection is not null)
        {
            activeGame = trackable.FirstOrDefault(candidate => MatchesSelection(candidate, selection));
            if (activeGame is null)
            {
                selectionCleared = true;
                keptSelection = null;
            }
            else
            {
                activeGame.Manual = true;
            }
        }

        activeGame ??= ordered.FirstOrDefault(candidate => candidate.Confidence >= AutomaticConfidenceThreshold);
        if (activeGame is not null)
        {
            foreach (var candidate in trackable)
            {
                candidate.Selected = ReferenceEquals(candidate, activeGame);
            }
        }

        return new GameCandidatePolicyResult
        {
            ActiveGame = activeGame,
            Trackable = trackable,
            Candidates = ordered.Take(CandidateLimit).ToList(),
            BlockedIds = blockedIds,
            SelectionCleared = selectionCleared,
            Selection = keptSelection
        };
    }

    internal static string LauncherIdOf(GameActivityPayload candidate)
    {
        // Only real launcher ids qualify: steam:<appid> from the Steam library, or epic:<id>.
        // Path-inferred candidates also start with "steam:" but carry a hash, not an app id.
        // The "#<pid>" instance suffix (see MakeInstanceIdsUnique) is not part of the launcher id.
        var id = candidate.Id ?? "";
        var suffix = id.IndexOf(InstanceSeparator);
        if (suffix >= 0)
        {
            id = id[..suffix];
        }

        if (id.StartsWith("steam:", StringComparison.OrdinalIgnoreCase))
        {
            var appId = id["steam:".Length..];
            return appId.Length > 0 && appId.All(char.IsAsciiDigit) ? id : "";
        }

        return id.StartsWith("epic:", StringComparison.OrdinalIgnoreCase) && id.Length > "epic:".Length ? id : "";
    }

    // Single decision point for "a blocked game never shows as ended" (FR-002).
    internal static bool ShouldSuppressEnded(GameActivityPayload? lastActiveGame, Func<string?, string?, bool> isBlocked)
    {
        return lastActiveGame is not null
            && isBlocked(lastActiveGame.ExecutablePath, LauncherIdOf(lastActiveGame));
    }

    // The session always counts from when the game itself started, also for a manual selection,
    // so choosing a candidate never resets its time (FR-021).
    internal static DateTimeOffset ResolveSessionStart(GameActivityPayload activeGame, DateTimeOffset sampledAt)
    {
        return activeGame.StartedAt ?? sampledAt;
    }

    // Groups the fragments that describe one running thing into clusters. Fragments of the same
    // process always merge, whatever Id each detector gave them (steam:<appid>, steam:<hash>,
    // running app). Different processes never merge, so duplicate open instances stay separate;
    // different install paths stay separate too. Path-less fragments (Steam-reported games) join
    // the process cluster that shares their Id or, for Steam, the one folder-recognised process
    // with the same name. Anything less certain stays separate.
    private static List<List<GameActivityPayload>> MergeFragments(IEnumerable<GameActivityPayload> rawCandidates)
    {
        var clusters = new List<List<GameActivityPayload>>();
        var byProcess = new Dictionary<int, List<GameActivityPayload>>();
        var pathless = new List<GameActivityPayload>();
        foreach (var fragment in rawCandidates)
        {
            if (!fragment.ProcessId.HasValue)
            {
                pathless.Add(fragment);
                continue;
            }

            if (!byProcess.TryGetValue(fragment.ProcessId.Value, out var cluster))
            {
                cluster = [];
                byProcess[fragment.ProcessId.Value] = cluster;
                clusters.Add(cluster);
            }

            cluster.Add(fragment);
        }

        var processClusters = clusters.ToList();
        foreach (var group in pathless.GroupBy(fragment => fragment.Id, StringComparer.OrdinalIgnoreCase))
        {
            var target = FindProcessCluster(group.First(), processClusters);
            if (target is null)
            {
                clusters.Add(group.ToList());
            }
            else
            {
                target.AddRange(group);
            }
        }

        return clusters;
    }

    private static List<GameActivityPayload>? FindProcessCluster(
        GameActivityPayload pathless,
        List<List<GameActivityPayload>> processClusters)
    {
        var sameId = processClusters
            .Where(cluster => cluster.Any(fragment => string.Equals(fragment.Id, pathless.Id, StringComparison.OrdinalIgnoreCase)))
            .OrderByDescending(cluster => cluster.Max(fragment => fragment.Confidence))
            .ThenBy(cluster => cluster.Min(fragment => fragment.StartedAt ?? DateTimeOffset.MaxValue))
            .FirstOrDefault();
        if (sameId is not null || LauncherIdOf(pathless).Length == 0 || !IsSteam(pathless))
        {
            return sameId;
        }

        // A Steam-reported app whose process was only recognised by its folder (steam:<hash>). Only
        // an unambiguous name match links them: guessing would attach a blocked or unrelated Steam
        // app to a different game and hide or rename it.
        var pathlessName = NormalizeName(pathless.Name);
        if (pathlessName.Length == 0)
        {
            return null;
        }

        var byName = processClusters
            .Where(cluster => cluster.Any(IsSteam)
                && cluster.All(fragment => LauncherIdOf(fragment).Length == 0)
                && cluster.Any(fragment => NormalizeName(fragment.Name) == pathlessName))
            .ToList();
        return byName.Count == 1 ? byName[0] : null;
    }

    private static bool IsSteam(GameActivityPayload fragment)
    {
        return string.Equals(fragment.Platform, "Steam", StringComparison.OrdinalIgnoreCase)
            || (fragment.Id ?? "").StartsWith("steam:", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeName(string? name)
    {
        return new string((name ?? "").Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
    }

    // Two clusters can still share an Id (the same app opened twice). Each needs its own Id so the
    // user can pick one; an unambiguous Id is left untouched, so single instances keep stable Ids.
    private static void MakeInstanceIdsUnique(List<GameActivityPayload> ordered)
    {
        foreach (var duplicated in ordered
            .GroupBy(candidate => candidate.Id, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1))
        {
            foreach (var candidate in duplicated.Where(candidate => candidate.ProcessId.HasValue))
            {
                candidate.Id = $"{candidate.Id}{InstanceSeparator}{candidate.ProcessId!.Value}";
            }
        }
    }

    private static bool MatchesSelection(GameActivityPayload candidate, ManualSelection selection)
    {
        var sameId = string.Equals(candidate.Id, selection.CandidateId, StringComparison.OrdinalIgnoreCase);
        if (!selection.ProcessId.HasValue)
        {
            return sameId;
        }

        // Ids come from the path or Steam app id, so a relaunched app reuses them. When the choice
        // was bound to a process, a different process is a different run and must not inherit it.
        if (candidate.ProcessId != selection.ProcessId)
        {
            return false;
        }

        return sameId
            || (!string.IsNullOrWhiteSpace(selection.ExecutablePath)
                && string.Equals(candidate.ExecutablePath, selection.ExecutablePath, StringComparison.OrdinalIgnoreCase));
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

        if (string.IsNullOrWhiteSpace(best.ExecutablePath))
        {
            best.ExecutablePath = runtime.ExecutablePath;
        }

        best.StartedAt ??= runtime.StartedAt;
        return best;
    }
}
