using System.Drawing;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class TouchCursorPolicyTests
{
    private static readonly Point Parked = new(400, 300);
    private static readonly Point Touched = new(3000, 400);

    [Test]
    public void ParkedCursorMovedByATouch_IsRestoredOnceTheTouchSettles()
    {
        var policy = new TouchCursorPolicy();
        policy.OnCursorMoved(Parked, nowMs: 0);
        policy.OnCursorMoved(Touched, nowMs: 5_000);
        policy.OnTouch(down: true, pointerId: 1, nowMs: 5_020, Touched);
        policy.OnTouch(down: false, pointerId: 1, nowMs: 5_100, Touched);

        Assert.That(policy.Tick(5_100 + TouchCursorPolicy.SettleMilliseconds - 1, Touched), Is.Null);
        Assert.That(policy.Tick(5_100 + TouchCursorPolicy.SettleMilliseconds, Touched), Is.EqualTo(Parked));
        Assert.That(policy.Tick(6_000, Parked), Is.Null, "Restoration happens once per touch.");
    }

    [Test]
    public void CursorThatNeverMoved_IsLeftAlone()
    {
        var policy = new TouchCursorPolicy();
        policy.OnCursorMoved(Parked, nowMs: 0);
        policy.OnTouch(true, 1, nowMs: 5_000, Parked);
        policy.OnTouch(false, 1, nowMs: 5_050, Parked);

        Assert.That(policy.Tick(5_500, Parked), Is.Null);
    }

    [Test]
    public void MouseMovementWithoutATouch_IsNeverUndone()
    {
        var policy = new TouchCursorPolicy();
        for (var step = 0; step < 50; step++)
        {
            policy.OnCursorMoved(new Point(2400 + step * 40, 300), nowMs: step * 8);
        }

        Assert.That(policy.Tick(10_000, new Point(4400, 300)), Is.Null, "Without a reported touch the policy does nothing.");
    }

    [Test]
    public void TouchNextToTheParkedCursor_IsStillRestored()
    {
        // The distance between cursor and touch is irrelevant: the page, not
        // the size of the jump, says it was a touch.
        var policy = new TouchCursorPolicy();
        policy.OnCursorMoved(Touched, nowMs: 0);
        var near = new Point(Touched.X + 40, Touched.Y + 30);
        policy.OnCursorMoved(near, nowMs: 5_000);
        policy.OnTouch(true, 1, nowMs: 5_030, near);
        policy.OnTouch(false, 1, nowMs: 5_080, near);

        Assert.That(policy.Tick(5_400, near), Is.EqualTo(Touched));
    }

    [Test]
    public void DragMovesAreNotMistakenForThePreTouchPosition()
    {
        var policy = new TouchCursorPolicy();
        policy.OnCursorMoved(Parked, nowMs: 0);
        policy.OnCursorMoved(Touched, nowMs: 5_000);
        policy.OnTouch(true, 1, nowMs: 5_020, Touched);
        for (var step = 1; step <= 20; step++)
        {
            policy.OnCursorMoved(new Point(3000 + step * 30, 400), nowMs: 5_020 + step * 16);
        }

        policy.OnTouch(false, 1, nowMs: 5_400, new Point(3600, 400));

        Assert.That(policy.Tick(5_600, new Point(3600, 400)), Is.EqualTo(Parked));
    }

    [Test]
    public void HeldFinger_PostponesRestorationUntilRelease()
    {
        var policy = new TouchCursorPolicy();
        policy.OnCursorMoved(Parked, nowMs: 0);
        policy.OnCursorMoved(Touched, nowMs: 5_000);
        policy.OnTouch(true, 1, nowMs: 5_020, Touched);

        Assert.That(policy.Tick(8_000, Touched), Is.Null, "A long press must not be interrupted.");

        policy.OnTouch(false, 1, nowMs: 8_100, Touched);
        Assert.That(policy.Tick(8_100 + TouchCursorPolicy.SettleMilliseconds, Touched), Is.EqualTo(Parked));
    }

    [Test]
    public void MultiTouch_RestoresOnlyAfterTheLastFingerLeaves()
    {
        var policy = new TouchCursorPolicy();
        policy.OnCursorMoved(Parked, nowMs: 0);
        policy.OnCursorMoved(Touched, nowMs: 5_000);
        policy.OnTouch(true, 1, nowMs: 5_020, Touched);
        policy.OnTouch(true, 2, nowMs: 5_100, Touched);
        policy.OnTouch(false, 1, nowMs: 5_200, Touched);

        Assert.That(policy.Tick(5_800, Touched), Is.Null);

        policy.OnTouch(false, 2, nowMs: 5_900, Touched);
        Assert.That(policy.Tick(5_900 + TouchCursorPolicy.SettleMilliseconds, Touched), Is.EqualTo(Parked));
    }

    [Test]
    public void SecondTouchRightAfterARestore_AnchorsOnTheRestoredCursor()
    {
        var policy = new TouchCursorPolicy();
        policy.OnCursorMoved(Parked, nowMs: 0);
        policy.OnCursorMoved(Touched, nowMs: 5_000);
        policy.OnTouch(true, 1, nowMs: 5_020, Touched);
        policy.OnTouch(false, 1, nowMs: 5_060, Touched);
        Assert.That(policy.Tick(5_300, Touched), Is.EqualTo(Parked));

        // Windows reports the move SetCursorPos produced, then the user taps again.
        policy.OnCursorMoved(Parked, nowMs: 5_310);
        policy.OnCursorMoved(Touched, nowMs: 5_350);
        policy.OnTouch(true, 2, nowMs: 5_370, Touched);
        policy.OnTouch(false, 2, nowMs: 5_420, Touched);

        Assert.That(policy.Tick(5_800, Touched), Is.EqualTo(Parked));
    }

    [Test]
    public void ReleaseThatNeverArrives_DoesNotKeepTheSessionOpenForever()
    {
        var policy = new TouchCursorPolicy();
        policy.OnCursorMoved(Parked, nowMs: 0);
        policy.OnCursorMoved(Touched, nowMs: 5_000);
        policy.OnTouch(true, 1, nowMs: 5_020, Touched);

        Assert.That(policy.Tick(5_020 + TouchCursorPolicy.StuckTouchMilliseconds - 1, Touched), Is.Null);
        Assert.That(policy.Tick(5_020 + TouchCursorPolicy.StuckTouchMilliseconds, Touched), Is.EqualTo(Parked));
    }

    [Test]
    public void TouchWithoutAnyCursorHistory_DoesNothingHarmful()
    {
        var policy = new TouchCursorPolicy();
        policy.OnTouch(true, 1, nowMs: 100, Touched);
        policy.OnTouch(false, 1, nowMs: 150, Touched);

        Assert.That(policy.Tick(1_000, Touched), Is.Null);
    }
}
