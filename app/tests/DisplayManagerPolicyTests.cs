using System.Drawing;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class DisplayManagerPolicyTests
{
    [Test]
    public void ListCompanionDisplays_FiltersPrimaryBeforeApplyingSavedPreference()
    {
        var primary = CreateDisplay("PRIMARY", isPrimary: true, baseScore: 1000);
        var companion = CreateDisplay("COMPANION", isPrimary: false, baseScore: 2000);

        var result = DisplayManager.ListCompanionDisplays([primary, companion], primary.StableId);

        Assert.That(result, Has.Count.EqualTo(1));
        Assert.That(result[0].StableId, Is.EqualTo(companion.StableId));
        Assert.That(result[0].IsPrimary, Is.False);
        Assert.That(result[0].IsPreferred, Is.False);
        Assert.That(result[0].Score, Is.EqualTo(companion.BaseScore));
    }

    [Test]
    public void ListCompanionDisplays_AppliesValidPreferenceAfterFiltering()
    {
        var first = CreateDisplay("FIRST", isPrimary: false, baseScore: 2000);
        var preferred = CreateDisplay("PREFERRED", isPrimary: false, baseScore: 2000);

        var result = DisplayManager.ListCompanionDisplays([first, preferred], preferred.StableId);

        Assert.That(result[0].StableId, Is.EqualTo(preferred.StableId));
        Assert.That(result[0].IsPreferred, Is.True);
        Assert.That(result[0].Score, Is.EqualTo(preferred.BaseScore + 120000));
    }

    [Test]
    public void BuildDiagnostics_PrimaryOnly_WaitsForCompanionDisplay()
    {
        var primary = CreateDisplay("PRIMARY", isPrimary: true, baseScore: 1000);

        var diagnostics = DisplayManager.BuildDiagnostics([primary], primary.StableId);

        Assert.That(diagnostics.Status, Is.EqualTo("waiting-for-companion-display"));
        Assert.That(diagnostics.ActiveDisplayCount, Is.EqualTo(1));
        Assert.That(diagnostics.CompanionDisplayCount, Is.Zero);
        Assert.That(diagnostics.EdgeCandidateCount, Is.Zero);
        Assert.That(diagnostics.SelectedDisplayId, Is.Empty);
        Assert.That(diagnostics.Displays, Is.Empty);
        Assert.That(diagnostics.Message, Does.Contain("will not open on the Windows primary display"));
    }

    [Test]
    public void BuildDiagnostics_SingleCompanion_IsReadyAndSelected()
    {
        var primary = CreateDisplay("PRIMARY", isPrimary: true, baseScore: 1000);
        var companion = CreateDisplay("COMPANION", isPrimary: false, baseScore: 2000);

        var diagnostics = DisplayManager.BuildDiagnostics([primary, companion]);

        Assert.That(diagnostics.Status, Is.EqualTo("ready"));
        Assert.That(diagnostics.ActiveDisplayCount, Is.EqualTo(2));
        Assert.That(diagnostics.CompanionDisplayCount, Is.EqualTo(1));
        Assert.That(diagnostics.EdgeCandidateCount, Is.EqualTo(1));
        Assert.That(diagnostics.SelectedDisplayId, Is.EqualTo(companion.StableId));
        Assert.That(diagnostics.Displays.Select(display => display.Id), Is.EqualTo(new[] { companion.StableId }));
        Assert.That(diagnostics.Displays, Has.All.Matches<DisplayDiagnosticsItem>(display => !display.Primary));
    }

    [Test]
    public void BuildDiagnostics_XeneonEdgeAtWrongMode_RequiresNativeModeRepair()
    {
        var xeneon = CreateDisplay("CRXED00", isPrimary: false, baseScore: 2000) with
        {
            Bounds = new Rectangle(413, 1440, 853, 683),
            FriendlyName = "Generic PnP Monitor",
            ModeWidth = 1280,
            ModeHeight = 1024,
            ContainsXeneonName = true,
            MatchesEdgeResolution = false,
            MatchesEdgeAspect = false
        };

        var diagnostics = DisplayManager.BuildDiagnostics([xeneon]);

        Assert.That(diagnostics.Status, Is.EqualTo("display-mode-mismatch"));
        Assert.That(ConfigController.IsCompanionDisplayReady(diagnostics), Is.False);
        Assert.That(diagnostics.Message, Does.Contain("1280x1024"));
        Assert.That(diagnostics.Message, Does.Contain("2560x720 at 60 Hz"));
        Assert.That(diagnostics.RepairActions, Has.Some.Contains("Display resolution"));
        Assert.That(diagnostics.Displays.Single().RequiresNativeModeCorrection, Is.True);
        Assert.That(diagnostics.SelectedDisplayName, Does.StartWith("XENEON EDGE"));
        Assert.That(diagnostics.Displays.Single().FriendlyName, Is.EqualTo("XENEON EDGE"));
        Assert.That(diagnostics.Displays.Single().Label, Does.StartWith("XENEON EDGE"));
    }

    [Test]
    public void BuildDiagnostics_XeneonHardwareId_PreservesSpecificWindowsFriendlyName()
    {
        var xeneon = CreateDisplay("CRXED00", isPrimary: false, baseScore: 2000) with
        {
            FriendlyName = "CORSAIR XENEON EDGE"
        };

        var diagnostics = DisplayManager.BuildDiagnostics([xeneon]);

        Assert.That(diagnostics.SelectedDisplayName, Does.StartWith("CORSAIR XENEON EDGE"));
        Assert.That(diagnostics.Displays.Single().FriendlyName, Is.EqualTo("CORSAIR XENEON EDGE"));
    }

    [Test]
    public void BuildDiagnostics_GenericCompanionAtNonEdgeMode_RemainsEligible()
    {
        var companion = CreateDisplay("GENERIC", isPrimary: false, baseScore: 2000) with
        {
            Bounds = new Rectangle(1920, 0, 1280, 1024),
            ModeWidth = 1280,
            ModeHeight = 1024,
            ContainsXeneonName = false,
            MatchesEdgeResolution = false,
            MatchesEdgeAspect = false
        };

        var diagnostics = DisplayManager.BuildDiagnostics([companion]);

        Assert.That(diagnostics.Status, Is.EqualTo("ready"));
        Assert.That(ConfigController.IsCompanionDisplayReady(diagnostics), Is.True);
        Assert.That(diagnostics.Displays.Single().RequiresNativeModeCorrection, Is.False);
    }

    [Test]
    public void BuildDiagnostics_SavedPrimaryIsInvalidWhenMultipleCompanionsExist()
    {
        var primary = CreateDisplay("PRIMARY", isPrimary: true, baseScore: 1000);
        var first = CreateDisplay("FIRST", isPrimary: false, baseScore: 2000);
        var second = CreateDisplay("SECOND", isPrimary: false, baseScore: 2000);

        var diagnostics = DisplayManager.BuildDiagnostics([primary, first, second], primary.StableId);

        Assert.That(diagnostics.Status, Is.EqualTo("selection-required"));
        Assert.That(diagnostics.ActiveDisplayCount, Is.EqualTo(3));
        Assert.That(diagnostics.CompanionDisplayCount, Is.EqualTo(2));
        Assert.That(diagnostics.SelectedDisplayId, Is.Empty);
        Assert.That(diagnostics.Displays, Has.None.Matches<DisplayDiagnosticsItem>(display => display.Preferred));
        Assert.That(diagnostics.Displays, Has.None.Matches<DisplayDiagnosticsItem>(display => display.Primary));
    }

    [Test]
    public void BuildDiagnostics_ValidSavedCompanionIsReadyWhenMultipleCompanionsExist()
    {
        var primary = CreateDisplay("PRIMARY", isPrimary: true, baseScore: 1000);
        var first = CreateDisplay("FIRST", isPrimary: false, baseScore: 2000);
        var selected = CreateDisplay("SELECTED", isPrimary: false, baseScore: 2000);

        var diagnostics = DisplayManager.BuildDiagnostics([primary, first, selected], selected.StableId);

        Assert.That(diagnostics.Status, Is.EqualTo("ready"));
        Assert.That(diagnostics.SelectedDisplayId, Is.EqualTo(selected.StableId));
        Assert.That(diagnostics.Displays.Single(display => display.Preferred).Id, Is.EqualTo(selected.StableId));
    }

    [Test]
    public void ResolveCompanionDisplay_RejectsPrimaryAndStaleTargets()
    {
        var primary = CreateDisplay("PRIMARY", isPrimary: true, baseScore: 1000);
        var companion = CreateDisplay("COMPANION", isPrimary: false, baseScore: 2000);
        Action selectPrimary = () => DisplayManager.ResolveCompanionDisplay([primary, companion], primary.StableId);
        Action selectStale = () => DisplayManager.ResolveCompanionDisplay([primary, companion], "MONITOR\\STALE");

        var primaryError = Assert.Throws<InvalidOperationException>(selectPrimary);
        var staleError = Assert.Throws<InvalidOperationException>(selectStale);

        Assert.That(primaryError!.Message, Does.Contain("primary display cannot host Auxora"));
        Assert.That(staleError!.Message, Does.Contain("selected display is not active"));
    }

    [Test]
    public void ResolveCompanionDisplay_PreservesSupportedIdentifierAliases()
    {
        var companion = CreateDisplay("COMPANION", isPrimary: false, baseScore: 2000);

        var byStableId = DisplayManager.ResolveCompanionDisplay([companion], companion.StableId);
        var byDeviceName = DisplayManager.ResolveCompanionDisplay([companion], companion.DeviceName);
        var byDeviceId = DisplayManager.ResolveCompanionDisplay([companion], companion.DeviceId);

        Assert.That(byStableId.StableId, Is.EqualTo(companion.StableId));
        Assert.That(byDeviceName.StableId, Is.EqualTo(companion.StableId));
        Assert.That(byDeviceId.StableId, Is.EqualTo(companion.StableId));
    }

    [Test]
    public void ValidateActiveCompanionDisplay_ReturnsCanonicalActiveTargetByStableId()
    {
        var active = CreateDisplay("COMPANION", isPrimary: false, baseScore: 2000);
        var requested = active with
        {
            FriendlyName = "Old friendly name",
            Score = 999999,
            MatchReasons = ["stale caller data"]
        };

        var selected = DisplayManager.ValidateActiveCompanionDisplay([active], requested);

        Assert.That(selected.StableId, Is.EqualTo(active.StableId));
        Assert.That(selected.FriendlyName, Is.EqualTo(active.FriendlyName));
        Assert.That(selected.Score, Is.EqualTo(active.BaseScore + 120000));
        Assert.That(selected.IsPreferred, Is.True);
    }

    [Test]
    public void ValidateActiveCompanionDisplay_RejectsPrimaryEvenWhenItIsStale()
    {
        var activeCompanion = CreateDisplay("COMPANION", isPrimary: false, baseScore: 2000);
        var stalePrimary = CreateDisplay("OLD-PRIMARY", isPrimary: true, baseScore: 1000);
        Action selectPrimary = () => DisplayManager.ValidateActiveCompanionDisplay([activeCompanion], stalePrimary);

        var error = Assert.Throws<InvalidOperationException>(selectPrimary);

        Assert.That(error!.Message, Does.Contain("primary display cannot host Auxora"));
    }

    [Test]
    public void BuildDiagnostics_MissingSavedDisplay_NeverFallsBackToPrimary()
    {
        var primary = CreateDisplay("PRIMARY", isPrimary: true, baseScore: 1000);

        var diagnostics = DisplayManager.BuildDiagnostics([primary], "MONITOR\\DISCONNECTED");

        Assert.That(diagnostics.Status, Is.EqualTo("waiting-for-companion-display"));
        Assert.That(diagnostics.SelectedDisplayId, Is.Empty);
        Assert.That(diagnostics.Displays, Is.Empty);
    }

    [Test]
    public void BuildDiagnostics_SavedSecondaryThatBecomesPrimary_IsImmediatelyIneligible()
    {
        var promoted = CreateDisplay("PROMOTED", isPrimary: true, baseScore: 2000);
        var remainingCompanion = CreateDisplay("REMAINING", isPrimary: false, baseScore: 1500);

        var diagnostics = DisplayManager.BuildDiagnostics([promoted, remainingCompanion], promoted.StableId);

        Assert.That(diagnostics.Status, Is.EqualTo("ready"));
        Assert.That(diagnostics.SelectedDisplayId, Is.EqualTo(remainingCompanion.StableId));
        Assert.That(diagnostics.Displays, Has.Count.EqualTo(1));
        Assert.That(diagnostics.Displays[0].Primary, Is.False);
        Assert.That(diagnostics.Displays[0].Preferred, Is.False);
    }

    [Test]
    public void ListCompanionDisplays_EnumerationOrderChanges_StableSavedIdentityStillWins()
    {
        var first = CreateDisplay("FIRST", isPrimary: false, baseScore: 2000);
        var saved = CreateDisplay("SAVED", isPrimary: false, baseScore: 1500);

        var originalOrder = DisplayManager.ListCompanionDisplays([first, saved], saved.StableId);
        var reversedOrder = DisplayManager.ListCompanionDisplays([saved, first], saved.StableId);

        Assert.That(originalOrder[0].StableId, Is.EqualTo(saved.StableId));
        Assert.That(reversedOrder[0].StableId, Is.EqualTo(saved.StableId));
        Assert.That(originalOrder[0].IsPreferred, Is.True);
        Assert.That(reversedOrder[0].IsPreferred, Is.True);
    }

    private static DisplayTarget CreateDisplay(string id, bool isPrimary, int baseScore)
    {
        return new DisplayTarget(
            Bounds: new Rectangle(isPrimary ? 0 : 1920, 0, isPrimary ? 1920 : 2560, isPrimary ? 1080 : 720),
            DeviceName: $@"\\.\DISPLAY_{id}",
            DeviceId: $@"MONITOR\{id}",
            FriendlyName: isPrimary ? $"Primary {id}" : $"Companion {id}",
            ModeWidth: isPrimary ? 1920 : 2560,
            ModeHeight: isPrimary ? 1080 : 720,
            RefreshRate: 60,
            IsPrimary: isPrimary,
            Score: baseScore,
            BaseScore: baseScore,
            ContainsXeneonName: !isPrimary,
            MatchesEdgeResolution: !isPrimary,
            MatchesEdgeAspect: !isPrimary,
            MatchReasons: [isPrimary ? "primary display" : "secondary display"]);
    }
}
