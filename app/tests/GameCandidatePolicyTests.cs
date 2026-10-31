using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class GameCandidatePolicyTests
{
    private static readonly Func<string?, string?, bool> NothingBlocked = (_, _) => false;

    private static GameActivityPayload Candidate(
        string id,
        int confidence,
        int? processId = null,
        string path = "",
        int startedMinutesAgo = 10)
    {
        return new GameActivityPayload
        {
            Id = id,
            Name = id,
            Platform = "Game",
            Source = "test",
            Confidence = confidence,
            ProcessId = processId,
            ExecutablePath = path,
            StartedAt = processId.HasValue ? DateTimeOffset.UtcNow.AddMinutes(-startedMinutesAgo) : null
        };
    }

    private static Func<string?, string?, bool> BlockPath(string blockedPath) =>
        (path, _) => string.Equals(path, blockedPath, StringComparison.OrdinalIgnoreCase);

    private static Func<string?, string?, bool> BlockLauncher(string blockedLauncherId) =>
        (_, launcherId) => string.Equals(launcherId, blockedLauncherId, StringComparison.OrdinalIgnoreCase);

    [Test]
    public void Apply_PicksHighestConfidenceAtOrAboveThreshold()
    {
        var result = GameCandidatePolicy.Apply(
            [Candidate("game:low", 44, 1, @"C:\Games\Low.exe"), Candidate("steam:1", 96, 2, @"C:\Steam\A.exe"), Candidate("game:mid", 78, 3, @"C:\Games\Mid.exe")],
            NothingBlocked,
            selection: null,
            steamReportedActiveId: null);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.ActiveGame?.Id, Is.EqualTo("steam:1"));
            Assert.That(result.ActiveGame?.Manual, Is.False);
            Assert.That(result.Trackable.Select(candidate => candidate.Id), Is.EqualTo(new[] { "steam:1", "game:mid", "game:low" }));
            Assert.That(result.Trackable.Count(candidate => candidate.Selected), Is.EqualTo(1));
        }));
    }

    [Test]
    public void Apply_NeverAutoSelectsLowConfidenceCandidates()
    {
        var result = GameCandidatePolicy.Apply([Candidate("game:low", 44, 1, @"C:\Games\Low.exe")], NothingBlocked, null, null);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.ActiveGame, Is.Null);
            Assert.That(result.Trackable, Has.Count.EqualTo(1));
        }));
    }

    [Test]
    public void Apply_CapsCandidatesButNotTrackable()
    {
        var raw = Enumerable.Range(1, 12)
            .Select(index => Candidate($"game:{index}", 50 + index, index, $@"C:\Games\G{index}.exe"))
            .ToList();

        var result = GameCandidatePolicy.Apply(raw, NothingBlocked, null, null);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.Candidates, Has.Count.EqualTo(GameCandidatePolicy.CandidateLimit));
            Assert.That(result.Trackable, Has.Count.EqualTo(12));
            Assert.That(result.Trackable.First().Id, Is.EqualTo("game:12"));
        }));
    }

    [Test]
    public void Apply_RemovesBlockedPathEverywhere()
    {
        const string wallpaper = @"D:\SteamLibrary\steamapps\common\wallpaper_engine\wallpaper64.exe";
        var result = GameCandidatePolicy.Apply(
            [Candidate("steam:hash1", 86, 1, wallpaper), Candidate("game:real", 78, 2, @"D:\Games\Real.exe")],
            BlockPath(wallpaper),
            null,
            null);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.ActiveGame?.Id, Is.EqualTo("game:real"));
            Assert.That(result.Candidates.Select(candidate => candidate.Id), Has.None.EqualTo("steam:hash1"));
            Assert.That(result.Trackable.Select(candidate => candidate.Id), Has.None.EqualTo("steam:hash1"));
        }));
    }

    [Test]
    public void Apply_DropsPathLessSteamFragment_WhenRunningFragmentIsBlockedByPath()
    {
        const string wallpaper = @"D:\SteamLibrary\steamapps\common\wallpaper_engine\wallpaper64.exe";
        var result = GameCandidatePolicy.Apply(
            [Candidate("steam:431960", 98), Candidate("steam:431960", 96, 1, wallpaper)],
            BlockPath(wallpaper),
            null,
            "steam:431960");

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.ActiveGame, Is.Null);
            Assert.That(result.Trackable, Is.Empty);
            Assert.That(result.Candidates, Is.Empty);
            Assert.That(result.BlockedIds, Is.EquivalentTo(new[] { "steam:431960" }));
        }));
    }

    [Test]
    public void Apply_BlockedIdsIsEmptyWhenNothingIsBlocked()
    {
        var result = GameCandidatePolicy.Apply([Candidate("steam:1", 96, 2, @"C:\Steam\A.exe")], NothingBlocked, null, null);

        Assert.That(result.BlockedIds, Is.Empty);
    }

    [Test]
    public void Apply_BlockedSteamAppIdRemovesSteamReportedCandidateWithoutProcess()
    {
        var steamReported = Candidate("steam:431960", 98);
        var result = GameCandidatePolicy.Apply([steamReported], BlockLauncher("steam:431960"), null, "steam:431960");

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.ActiveGame, Is.Null);
            Assert.That(result.Trackable, Is.Empty);
        }));
    }

    [Test]
    public void Apply_SteamReportedGameWithoutProcessIsTrackable()
    {
        var result = GameCandidatePolicy.Apply([Candidate("steam:1086940", 98)], NothingBlocked, null, "steam:1086940");

        Assert.That(result.Trackable.Single().Id, Is.EqualTo("steam:1086940"));
    }

    [Test]
    public void Apply_BlockingActiveGameFallsThroughToNextValidCandidateOrNone()
    {
        const string first = @"C:\Games\First.exe";
        var fallsThrough = GameCandidatePolicy.Apply(
            [Candidate("game:first", 96, 1, first), Candidate("game:second", 78, 2, @"C:\Games\Second.exe")],
            BlockPath(first),
            null,
            null);
        var none = GameCandidatePolicy.Apply([Candidate("game:first", 96, 1, first)], BlockPath(first), null, null);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(fallsThrough.ActiveGame?.Id, Is.EqualTo("game:second"));
            Assert.That(none.ActiveGame, Is.Null);
        }));
    }

    [Test]
    public void Apply_ManualSelectionOverridesHigherConfidence()
    {
        var selection = new ManualSelection("game:mid", 3, @"C:\Games\Mid.exe", DateTimeOffset.UtcNow);
        var result = GameCandidatePolicy.Apply(
            [Candidate("steam:1", 96, 2, @"C:\Steam\A.exe"), Candidate("game:mid", 78, 3, @"C:\Games\Mid.exe")],
            NothingBlocked,
            selection,
            null);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.ActiveGame?.Id, Is.EqualTo("game:mid"));
            Assert.That(result.ActiveGame?.Manual, Is.True);
            Assert.That(result.SelectionCleared, Is.False);
            Assert.That(result.Selection, Is.EqualTo(selection));
            Assert.That(result.Trackable.Single(candidate => candidate.Selected).Id, Is.EqualTo("game:mid"));
        }));
    }

    [Test]
    public void Apply_ManualSelectionOfLowConfidenceKeepsItsConfidence()
    {
        var selection = new ManualSelection("game:low", 1, @"C:\Games\Low.exe", DateTimeOffset.UtcNow);
        var result = GameCandidatePolicy.Apply(
            [Candidate("game:low", 44, 1, @"C:\Games\Low.exe"), Candidate("steam:1", 96, 2, @"C:\Steam\A.exe")],
            NothingBlocked,
            selection,
            null);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.ActiveGame?.Id, Is.EqualTo("game:low"));
            Assert.That(result.ActiveGame?.Confidence, Is.EqualTo(44));
            Assert.That(result.ActiveGame?.Manual, Is.True);
        }));
    }

    [Test]
    public void ResolveSessionStart_KeepsGameStartForManualCandidate()
    {
        var sampledAt = DateTimeOffset.UtcNow;
        var longRunning = Candidate("game:long", 70, 1, @"C:\Games\Long.exe", startedMinutesAgo: 300);
        longRunning.Manual = true;

        var start = GameCandidatePolicy.ResolveSessionStart(longRunning, sampledAt);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(start, Is.EqualTo(longRunning.StartedAt));
            Assert.That(sampledAt - start, Is.GreaterThan(TimeSpan.FromMinutes(299)));
        }));
    }

    [Test]
    public void ResolveSessionStart_UsesProcessStartForAutomaticCandidate()
    {
        var sampledAt = DateTimeOffset.UtcNow;
        var automatic = Candidate("game:auto", 96, 1, @"C:\Games\Auto.exe", startedMinutesAgo: 30);

        var start = GameCandidatePolicy.ResolveSessionStart(automatic, sampledAt);

        Assert.That(start, Is.EqualTo(automatic.StartedAt));
        Assert.That(
            GameCandidatePolicy.ResolveSessionStart(Candidate("steam:2", 98), sampledAt),
            Is.EqualTo(sampledAt));
    }

    private static GameActivityPayload Named(
        string id,
        string name,
        string platform,
        int confidence,
        int? processId = null,
        string path = "")
    {
        var fragment = Candidate(id, confidence, processId, path);
        fragment.Name = name;
        fragment.Platform = platform;
        return fragment;
    }

    [Test]
    public void Apply_MergesFragmentsOfTheSameProcessIntoOneCandidate()
    {
        const string path = @"D:\Steam\steamapps\common\Dota 2\dota2.exe";
        var result = GameCandidatePolicy.Apply(
            [
                Named("steam:570", "Dota 2", "Steam", 96, 7, path),
                Named("steam:9f3ab2", "dota2", "Steam", 86, 7, path),
                Named("game:77aa", "Dota2", "Game", 44, 7, path)
            ],
            NothingBlocked,
            null,
            null);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.Candidates, Has.Count.EqualTo(1));
            Assert.That(result.Trackable, Has.Count.EqualTo(1));
            Assert.That(result.ActiveGame?.Id, Is.EqualTo("steam:570"));
            Assert.That(result.ActiveGame?.Name, Is.EqualTo("Dota 2"));
            Assert.That(result.ActiveGame?.ProcessId, Is.EqualTo(7));
        }));
    }

    [Test]
    public void Apply_MergesPathlessSteamReportWithTheSameNamedSteamProcess()
    {
        const string path = @"E:\Library\steamapps\common\Dota\dota2.exe";
        var result = GameCandidatePolicy.Apply(
            [
                Named("steam:570", "Dota 2", "Steam", 98),
                Named("steam:9f3ab2", "dota2", "Steam", 86, 9, path)
            ],
            NothingBlocked,
            null,
            "steam:570");

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.Candidates, Has.Count.EqualTo(1));
            Assert.That(result.ActiveGame?.Id, Is.EqualTo("steam:570"));
            Assert.That(result.ActiveGame?.ProcessId, Is.EqualTo(9));
            Assert.That(result.ActiveGame?.ExecutablePath, Is.EqualTo(path));
        }));
    }

    [Test]
    public void Apply_MergesPathlessSteamReportByNameWhenSeveralSteamProcessesRun()
    {
        var result = GameCandidatePolicy.Apply(
            [
                Named("steam:570", "Dota 2", "Steam", 98),
                Named("steam:aaa111", "Other Game", "Steam", 86, 4, @"D:\steamapps\common\Other\other.exe"),
                Named("steam:bbb222", "Dota-2", "Steam", 86, 5, @"D:\steamapps\common\Dota\dota2.exe")
            ],
            NothingBlocked,
            null,
            "steam:570");

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.Candidates, Has.Count.EqualTo(2));
            Assert.That(result.Candidates.Single(candidate => candidate.ProcessId == 5).Id, Is.EqualTo("steam:570"));
            Assert.That(result.Candidates.Single(candidate => candidate.ProcessId == 4).Id, Is.EqualTo("steam:aaa111"));
        }));
    }

    [Test]
    public void Apply_KeepsPathlessSteamReportSeparate_WhenSeveralSteamProcessesAreAmbiguous()
    {
        var result = GameCandidatePolicy.Apply(
            [
                Named("steam:570", "Dota 2", "Steam", 98),
                Named("steam:aaa111", "Alpha", "Steam", 86, 4, @"D:\steamapps\common\Alpha\a.exe"),
                Named("steam:bbb222", "Beta", "Steam", 86, 5, @"D:\steamapps\common\Beta\b.exe")
            ],
            NothingBlocked,
            null,
            "steam:570");

        Assert.That(result.Candidates, Has.Count.EqualTo(3));
    }

    [Test]
    public void Apply_DoesNotAttachABlockedSteamReportToAnUnrelatedSteamProcess()
    {
        // Steam still reports the blocked dock app while a different, folder-recognised Steam game runs.
        var result = GameCandidatePolicy.Apply(
            [
                Named("steam:1787090", "MyDockFinder", "Steam", 98),
                Named("steam:9f3ab2", "Real Game", "Steam", 86, 9, @"D:\steamapps\common\Real Game\real.exe")
            ],
            BlockLauncher("steam:1787090"),
            null,
            "steam:1787090");

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.ActiveGame?.Name, Is.EqualTo("Real Game"));
            Assert.That(result.Candidates.Select(candidate => candidate.Name), Is.EqualTo(new[] { "Real Game" }));
            Assert.That(result.Trackable, Has.Count.EqualTo(1));
        }));
    }

    [Test]
    public void Apply_KeepsDuplicateOpenInstancesAsDistinctCandidates()
    {
        const string path = @"C:\Games\Twin\twin.exe";
        var result = GameCandidatePolicy.Apply(
            [
                Named("game:abc", "Twin", "Game", 78, 11, path),
                Named("game:abc", "Twin", "Game", 78, 12, path)
            ],
            NothingBlocked,
            null,
            null);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.Candidates, Has.Count.EqualTo(2));
            Assert.That(result.Trackable, Has.Count.EqualTo(2));
            Assert.That(result.Candidates.Select(candidate => candidate.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count(), Is.EqualTo(2));
            Assert.That(result.Candidates.All(candidate => candidate.Id.StartsWith("game:abc", StringComparison.Ordinal)), Is.True);
        }));
    }

    [Test]
    public void Apply_KeepsSeparateInstallsAsDistinctCandidates()
    {
        var result = GameCandidatePolicy.Apply(
            [
                Named("game:aaa", "Twin", "Game", 78, 11, @"C:\Games\Twin\twin.exe"),
                Named("game:bbb", "Twin", "Game", 78, 12, @"D:\Other\Twin\twin.exe")
            ],
            NothingBlocked,
            null,
            null);

        Assert.That(result.Candidates, Has.Count.EqualTo(2));
    }

    [Test]
    public void Apply_BlocksEveryInstanceOfALauncherId()
    {
        var result = GameCandidatePolicy.Apply(
            [
                Named("steam:570", "Dota 2", "Steam", 96, 1, @"D:\steamapps\common\Dota\dota2.exe"),
                Named("steam:570", "Dota 2", "Steam", 96, 2, @"D:\steamapps\common\Dota\dota2.exe")
            ],
            BlockLauncher("steam:570"),
            null,
            null);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.Candidates, Is.Empty);
            Assert.That(result.BlockedIds, Is.EquivalentTo(new[] { "steam:570" }));
        }));
    }

    [Test]
    public void LauncherIdOf_IgnoresTheInstanceSuffix()
    {
        Assert.Multiple((Action)(() =>
        {
            Assert.That(GameCandidatePolicy.LauncherIdOf(new GameActivityPayload { Id = "steam:570#12" }), Is.EqualTo("steam:570"));
            Assert.That(GameCandidatePolicy.LauncherIdOf(new GameActivityPayload { Id = "game:abc#12" }), Is.EqualTo(""));
        }));
    }

    [Test]
    public void Apply_ManualSelectionClearsWhenProcessIsGone()
    {
        var selection = new ManualSelection("game:closed", 9, @"C:\Games\Closed.exe", DateTimeOffset.UtcNow);
        var result = GameCandidatePolicy.Apply([Candidate("steam:1", 96, 2, @"C:\Steam\A.exe")], NothingBlocked, selection, null);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.SelectionCleared, Is.True);
            Assert.That(result.Selection, Is.Null);
            Assert.That(result.ActiveGame?.Id, Is.EqualTo("steam:1"));
        }));
    }

    [Test]
    public void Apply_ManualSelectionClearsWhenItemBecomesBlocked()
    {
        const string chosen = @"C:\Games\Chosen.exe";
        var selection = new ManualSelection("game:chosen", 3, chosen, DateTimeOffset.UtcNow);
        var result = GameCandidatePolicy.Apply(
            [Candidate("game:chosen", 70, 3, chosen), Candidate("steam:1", 96, 2, @"C:\Steam\A.exe")],
            BlockPath(chosen),
            selection,
            null);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.SelectionCleared, Is.True);
            Assert.That(result.ActiveGame?.Id, Is.EqualTo("steam:1"));
        }));
    }

    [Test]
    public void ShouldSuppressEnded_ReturnsTrue_WhenLastGameIsBlockedByPath()
    {
        const string path = @"D:\Apps\Dock.exe";
        Assert.That(GameCandidatePolicy.ShouldSuppressEnded(Candidate("game:dock", 80, 1, path), BlockPath(path)), Is.True);
    }

    [Test]
    public void ShouldSuppressEnded_ReturnsTrue_WhenLastGameIsBlockedByLauncherId()
    {
        Assert.That(GameCandidatePolicy.ShouldSuppressEnded(Candidate("steam:431960", 98), BlockLauncher("steam:431960")), Is.True);
    }

    [Test]
    public void ShouldSuppressEnded_ReturnsFalse_WhenLastGameIsNotBlocked()
    {
        Assert.That(GameCandidatePolicy.ShouldSuppressEnded(Candidate("game:real", 96, 1, @"D:\Games\Real.exe"), BlockPath(@"D:\Apps\Dock.exe")), Is.False);
    }

    [Test]
    public void ShouldSuppressEnded_ReturnsFalse_WhenLastGameIsNull()
    {
        Assert.That(GameCandidatePolicy.ShouldSuppressEnded(null, (_, _) => true), Is.False);
    }

    [Test]
    public void LauncherIdOf_ReturnsIdOnlyForSteamAppIdsAndEpic()
    {
        Assert.Multiple((Action)(() =>
        {
            Assert.That(GameCandidatePolicy.LauncherIdOf(Candidate("steam:1", 90)), Is.EqualTo("steam:1"));
            Assert.That(GameCandidatePolicy.LauncherIdOf(Candidate("epic:x", 90)), Is.EqualTo("epic:x"));
            Assert.That(GameCandidatePolicy.LauncherIdOf(Candidate("steam:a1b2c3", 86)), Is.Empty);
            Assert.That(GameCandidatePolicy.LauncherIdOf(Candidate("game:abc", 44)), Is.Empty);
        }));
    }
}
