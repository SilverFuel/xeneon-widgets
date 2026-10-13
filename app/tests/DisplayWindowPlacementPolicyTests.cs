using System.Drawing;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class DisplayWindowPlacementPolicyTests
{
    [Test]
    public void LockedStyles_RemoveNativeFrameInsetsWithoutDiscardingOtherStyles()
    {
        Assert.That(DisplayWindowPlacementPolicy.LockedWindowStyle(0x14480000L), Is.EqualTo(0x14080000L));
        Assert.That(DisplayWindowPlacementPolicy.LockedWindowStyle(0x14CF0000L), Is.EqualTo(0x140B0000L));
        Assert.That(DisplayWindowPlacementPolicy.LockedExtendedStyle(0x08000188L), Is.EqualTo(0x08000088L));
        Assert.That(DisplayWindowPlacementPolicy.LockedExtendedStyle(0x00160309L), Is.EqualTo(0x08100088L));
    }

    [TestCase(true, 0x14080000L, 0x08000088L, true)]
    [TestCase(false, 0x14080000L, 0x08000088L, false)]
    [TestCase(true, 0x14480000L, 0x08000088L, false)]
    [TestCase(true, 0x14080000L, 0x08000080L, false)]
    [TestCase(true, 0x14080000L, 0x08000188L, false)]
    [TestCase(true, 0x14080000L, 0x08040088L, false)]
    public void FinalPresentation_RequiresSuccessfulFrameCallAndVerifiedStyles(bool applied, long style, long extendedStyle, bool expected)
    {
        Assert.That(DisplayWindowPlacementPolicy.IsLockedPresentationApplied(applied, style, extendedStyle), Is.EqualTo(expected));
    }

    [Test]
    public void FullscreenAndContainedBounds_OnConfiguredCompanion_AreSafe()
    {
        var target = CreateCompanion();
        Assert.That(DisplayWindowPlacementPolicy.IsContainedByCompanion(target.Bounds, target), Is.True);
        Assert.That(DisplayWindowPlacementPolicy.IsContainedByCompanion(new Rectangle(2000, 20, 500, 400), target), Is.True);
    }

    [Test]
    public void WindowsRelocationOntoPrimary_IsRejected()
    {
        Assert.That(DisplayWindowPlacementPolicy.IsContainedByCompanion(new Rectangle(0, 0, 3840, 2160), CreateCompanion()), Is.False);
    }

    [Test]
    public void LostConfiguredTarget_IsRejectedEvenIfAnotherCompanionRemains()
    {
        Assert.That(DisplayWindowPlacementPolicy.IsContainedByCompanion(CreateCompanion().Bounds, null), Is.False);
    }

    [Test]
    public void ConfiguredTargetPromotedToPrimary_IsRejected()
    {
        var target = CreateCompanion() with { IsPrimary = true };
        Assert.That(DisplayWindowPlacementPolicy.IsContainedByCompanion(target.Bounds, target), Is.False);
    }

    [TestCase(1919, 0, 2560, 720)]
    [TestCase(1920, -1, 2560, 720)]
    [TestCase(1920, 0, 2561, 720)]
    [TestCase(1920, 0, 2560, 721)]
    [TestCase(1920, 0, 0, 720)]
    [TestCase(1920, 0, 2560, 0)]
    [TestCase(-2560, 0, 2560, 720)]
    public void PartialEscapeInvalidSizeOrDifferentCompanion_IsRejected(int x, int y, int width, int height)
    {
        Assert.That(DisplayWindowPlacementPolicy.IsContainedByCompanion(new Rectangle(x, y, width, height), CreateCompanion()), Is.False);
    }

    [Test]
    public void CompanionAtNegativeDesktopCoordinates_IsSupported()
    {
        var target = CreateCompanion() with { Bounds = new Rectangle(-2560, -720, 2560, 720) };
        Assert.That(DisplayWindowPlacementPolicy.IsContainedByCompanion(target.Bounds, target), Is.True);
    }

    [TestCase(0x007Eu, false, true, true)]
    [TestCase(0x007Eu, true, false, true)]
    [TestCase(0x02E0u, false, true, true)]
    [TestCase(0x02E0u, true, false, false)]
    [TestCase(0x02E0u, false, false, false)]
    [TestCase(0x0046u, false, true, false)]
    public void TopologyNotifications_ExcludeOurOwnHiddenDpiChanges(uint message, bool placing, bool visible, bool expected)
    {
        Assert.That(DisplayWindowPlacementPolicy.IsTopologyNotification(message, placing, visible), Is.EqualTo(expected));
    }

    [Test]
    public void HiddenPresenterImplicitShow_IsSuppressedWithoutRejectingPreparationGeometry()
    {
        var flags = Filter(0x0040, visible: false, authorized: false, placing: true,
            new Rectangle(0, 0, 4480, 1260), out var recover);
        Assert.That(flags & 0x0040, Is.Zero);
        Assert.That(flags & 0x0080, Is.Not.Zero);
        Assert.That(flags & 0x0003, Is.Zero, "hidden preparation can still move/resize before verification");
        Assert.That(recover, Is.False, "our own presentation work must not restart recovery");
    }

    [TestCase(0u)]
    [TestCase(0x0040u)]
    [TestCase(0x0010u)]
    public void VisiblePrimaryRelocation_IsHiddenAndMoveResizeRejected(uint incomingFlags)
    {
        var flags = Filter(incomingFlags, visible: true, authorized: false, placing: false,
            new Rectangle(0, 0, 3840, 2160), out var recover);
        Assert.That(flags & 0x0040, Is.Zero);
        Assert.That(flags & 0x0083, Is.EqualTo(0x0083));
        Assert.That(recover, Is.True);
    }

    [Test]
    public void ExplicitFinalReveal_RequiresVerifiedBoundsEvenInsidePlacementScope()
    {
        var accepted = Filter(0x0050, visible: false, authorized: true, placing: true, CreateCompanion().Bounds, out var recover);
        Assert.That(accepted, Is.EqualTo(0x0050));
        Assert.That(recover, Is.False);
        var rejected = Filter(0x0050, visible: false, authorized: true, placing: true,
            new Rectangle(0, 0, 3840, 2160), out recover);
        Assert.That(rejected & 0x0040, Is.Zero);
        Assert.That(rejected & 0x0080, Is.Not.Zero);
        Assert.That(recover, Is.True);
    }

    [Test]
    public void ExplicitFinalReveal_WithoutCurrentVerifiedTarget_IsRejected()
    {
        var flags = DisplayWindowPlacementPolicy.FilterNativePositionFlags(0x0040, false, true, false,
            true, CreateCompanion().Bounds, null, out var recover);
        Assert.That(flags & 0x0083, Is.EqualTo(0x0083));
        Assert.That(flags & 0x0040, Is.Zero);
        Assert.That(recover, Is.True);
    }

    [Test]
    public void PickerReveal_AlsoRequiresACurrentVerifiedTarget()
    {
        var flags = DisplayWindowPlacementPolicy.FilterNativePositionFlags(0x0040, false, true, false,
            false, CreateCompanion().Bounds, null, out var recover);
        Assert.That(flags & 0x0083, Is.EqualTo(0x0083));
        Assert.That(flags & 0x0040, Is.Zero);
        Assert.That(recover, Is.True);
    }

    [Test]
    public void VerifiedPicker_AllowsDeliberateMovementAndFinalReveal()
    {
        var bounds = new Rectangle(2000, 20, 500, 400);
        var flags = DisplayWindowPlacementPolicy.FilterNativePositionFlags(0x0010, true, false, false,
            false, bounds, CreateCompanion().Bounds, out var recover);
        Assert.That(flags, Is.EqualTo(0x0010));
        Assert.That(recover, Is.False);
        flags = DisplayWindowPlacementPolicy.FilterNativePositionFlags(0x0050, false, true, true,
            false, bounds, CreateCompanion().Bounds, out recover);
        Assert.That(flags, Is.EqualTo(0x0050));
        Assert.That(recover, Is.False);
    }

    [Test]
    public void PickerFinalReveal_OutsideVerifiedCompanion_IsRejected()
    {
        var flags = DisplayWindowPlacementPolicy.FilterNativePositionFlags(0x0050, false, true, true,
            false, new Rectangle(0, 0, 3840, 2160), CreateCompanion().Bounds, out var recover);
        Assert.That(flags & 0x0040, Is.Zero);
        Assert.That(flags & 0x0080, Is.Not.Zero);
        Assert.That(recover, Is.True);
    }

    [Test]
    public void NestedHideDuringTopologyNotification_CannotResurrectShowOrQueueMoreRecovery()
    {
        var flags = Filter(0x00C0, visible: true, authorized: false, placing: false,
            new Rectangle(0, 0, 3840, 2160), out var recover);
        Assert.That(flags, Is.EqualTo(0x0080));
        Assert.That(recover, Is.False);
    }

    [Test]
    public void OrdinarySafeVisibleGeometryAndHiddenMoves_ArePreserved()
    {
        Assert.That(Filter(0x0010, true, false, false, CreateCompanion().Bounds, out var recover), Is.EqualTo(0x0010));
        Assert.That(recover, Is.False);
        Assert.That(Filter(0x0010, false, false, true, new Rectangle(0, 0, 10, 10), out recover), Is.EqualTo(0x0010));
        Assert.That(recover, Is.False);
    }

    private static uint Filter(uint flags, bool visible, bool authorized, bool placing, Rectangle proposed, out bool recover)
        => DisplayWindowPlacementPolicy.FilterNativePositionFlags(flags, visible, authorized, placing,
            true, proposed, CreateCompanion().Bounds, out recover);

    private static DisplayTarget CreateCompanion() => new(
        Bounds: new Rectangle(1920, 0, 2560, 720), DeviceName: @"\\.\DISPLAY2",
        DeviceId: @"MONITOR\EDGE", FriendlyName: "EDGE", ModeWidth: 2560, ModeHeight: 720,
        RefreshRate: 60, IsPrimary: false, Score: 2000, BaseScore: 2000,
        ContainsXeneonName: true, MatchesEdgeResolution: true, MatchesEdgeAspect: true,
        MatchReasons: ["companion"]);
}
