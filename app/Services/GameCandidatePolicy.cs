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

    public bool SelectionCleared { get; init; }

    public ManualSelection? Selection { get; init; }
}

// Pure filtering, ordering and selection rules for Game Mode candidates. It performs no I/O so
// the blocklist, manual selection and "ended" suppression rules can be unit tested directly.
public static class GameCandidatePolicy
{
    public const int AutomaticConfidenceThreshold = 60;
    public const int CandidateLimit = 8;

    public static GameCandidatePolicyResult Apply(
        IEnumerable<GameActivityPayload> rawCandidates,
        Func<string?, string?, bool> isBlocked,
        ManualSelection? selection,
        string? steamReportedActiveId)
    {
        var ordered = rawCandidates
            .Where(candidate => !isBlocked(candidate.ExecutablePath, LauncherIdOf(candidate)))
            .GroupBy(candidate => candidate.Id, StringComparer.OrdinalIgnoreCase)
            .Select(SelectBestCandidate)
            .OrderByDescending(candidate => candidate.Confidence)
            .ThenByDescending(candidate => candidate.StartedAt.HasValue)
            .ThenByDescending(candidate => candidate.StartedAt ?? DateTimeOffset.MinValue)
            .ToList();

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
            SelectionCleared = selectionCleared,
            Selection = keptSelection
        };
    }

    internal static string LauncherIdOf(GameActivityPayload candidate)
    {
        // Only real launcher ids qualify: steam:<appid> from the Steam library, or epic:<id>.
        // Path-inferred candidates also start with "steam:" but carry a hash, not an app id.
        var id = candidate.Id ?? "";
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

    private static bool MatchesSelection(GameActivityPayload candidate, ManualSelection selection)
    {
        if (string.Equals(candidate.Id, selection.CandidateId, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return selection.ProcessId.HasValue
            && candidate.ProcessId == selection.ProcessId
            && !string.IsNullOrWhiteSpace(selection.ExecutablePath)
            && string.Equals(candidate.ExecutablePath, selection.ExecutablePath, StringComparison.OrdinalIgnoreCase);
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
