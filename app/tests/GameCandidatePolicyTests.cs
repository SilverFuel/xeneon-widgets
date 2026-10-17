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
