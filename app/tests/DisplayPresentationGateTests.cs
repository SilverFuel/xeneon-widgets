using System.Collections.Concurrent;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class DisplayPresentationGateTests
{
    [Test]
    public void QueuedReassertion_IsInvalidatedBeforeDispatcherDelivery()
    {
        var gate = new DisplayPresentationGate();
        var queue = new Queue<Action>();
        var generation = gate.InvalidatePresentation();
        var reassertions = 0;
        Assert.That(gate.IsCurrentPresentation(generation), Is.True);
        queue.Enqueue(() =>
        {
            if (gate.IsCurrentPresentation(generation))
            {
                reassertions++;
            }
        });

        using var request = new CancellationTokenSource();
        Assert.That(gate.TryBeginTopologyChange(request, out var previous), Is.True);
        Assert.That(previous, Is.Null);
        queue.Dequeue()();

        Assert.That(reassertions, Is.Zero);
        gate.CompleteTopologyChange(request);
        Assert.That(gate.IsCurrentPresentation(generation), Is.False, "settling topology must not revive stale work");
    }

    [TestCase(false, 0x0013u)]
    [TestCase(true, 0x0033u)]
    public void AlreadyCheckedReassertion_CannotShowAfterTopologyHide(bool frameChanged, uint expectedFlags)
    {
        var gate = new DisplayPresentationGate();
        var generation = gate.InvalidatePresentation();
        var visible = true;
        Assert.That(gate.IsCurrentPresentation(generation), Is.True);

        // The topology notification arrives after the last timer guard, but
        // before its native z-order operation. Exercise the production flags.
        using var request = new CancellationTokenSource();
        gate.TryBeginTopologyChange(request, out _);
        visible = false;
        var flags = DisplayPresentationGate.BuildTopmostFlags(frameChanged);
        if ((flags & 0x0040u) != 0)
        {
            visible = true;
        }

        Assert.Multiple((Action)(() =>
        {
            Assert.That(flags, Is.EqualTo(expectedFlags), "preserve size, position, focus, and optional frame update");
            Assert.That(visible, Is.False, "z-order maintenance cannot undo a topology hide");
        }));
    }

    [Test]
    public void PendingTopology_BlocksQueuedOrdinaryRecoveryAndShowRequests()
    {
        var gate = new DisplayPresentationGate();
        var queue = new Queue<Action>();
        var shows = 0;
        queue.Enqueue(() =>
        {
            if (gate.TryCaptureReveal(null, out var generation))
            {
                gate.TryReveal(generation, null, () => shows++);
            }
        });

        using var request = new CancellationTokenSource();
        gate.TryBeginTopologyChange(request, out _);
        queue.Dequeue()();

        Assert.That(shows, Is.Zero);
        Assert.That(gate.TryCaptureReveal(null, out _), Is.False);
    }

    [TestCase(false)]
    [TestCase(true)]
    public void TopologyChangeBetweenValidationAndShow_RejectsCapturedReveal(bool topologyValidation)
    {
        var gate = new DisplayPresentationGate();
        using var first = new CancellationTokenSource();
        if (topologyValidation)
        {
            gate.TryBeginTopologyChange(first, out _);
        }
        var revealRequest = topologyValidation ? first : null;
        Assert.That(gate.TryCaptureReveal(revealRequest, out var generation), Is.True);
        var queue = new Queue<Action>();
        var shows = 0;
        queue.Enqueue(() => Assert.That(gate.TryReveal(generation, revealRequest, () => shows++), Is.False));

        using var replacement = new CancellationTokenSource();
        gate.TryBeginTopologyChange(replacement, out _);
        queue.Dequeue()();

        Assert.That(shows, Is.Zero);
    }

    [Test]
    public void SupersededRequestBeforeCancellation_CannotRevealOrClearCurrentRequest()
    {
        var gate = new DisplayPresentationGate();
        using var first = new CancellationTokenSource();
        using var replacement = new CancellationTokenSource();
        gate.TryBeginTopologyChange(first, out _);
        Assert.That(gate.TryCaptureReveal(first, out var generation), Is.True);
        gate.TryBeginTopologyChange(replacement, out var previous);

        Assert.That(previous, Is.SameAs(first));
        Assert.That(first.IsCancellationRequested, Is.False, "ownership must change before cancellation is delivered");
        Assert.That(gate.IsCurrentTopologyRequest(first), Is.False);
        Assert.That(gate.TryReveal(generation, first, () => Assert.Fail("stale reveal")), Is.False);
        gate.CompleteTopologyChange(first);

        Assert.That(gate.IsCurrentTopologyRequest(replacement), Is.True);
        Assert.That(gate.TryCaptureReveal(null, out _), Is.False);
        Assert.That(gate.TryCaptureReveal(first, out _), Is.False);
    }

    [Test]
    public void CurrentQuietPeriodRequest_RevealsThenRestoresOrdinaryPresentation()
    {
        var gate = new DisplayPresentationGate();
        using var request = new CancellationTokenSource();
        gate.TryBeginTopologyChange(request, out _);
        Assert.That(gate.TryCaptureReveal(request, out var topologyGeneration), Is.True);
        var shows = 0;
        Assert.That(gate.TryReveal(topologyGeneration, request, () => shows++), Is.True);
        gate.CompleteTopologyChange(request);

        Assert.That(gate.TryCaptureReveal(null, out var ordinaryGeneration), Is.True);
        Assert.That(gate.TryReveal(ordinaryGeneration, null, () => shows++), Is.True);
        Assert.That(shows, Is.EqualTo(2));
        var presentation = gate.InvalidatePresentation();
        Assert.That(gate.IsCurrentPresentation(presentation), Is.True);
        Assert.That(gate.IsCurrentPresentation(presentation - 1), Is.False);
    }

    [Test]
    public void TopologyChangeAfterRevealBeforeCleanup_StartsNewHiddenBurst()
    {
        var gate = new DisplayPresentationGate();
        using var first = new CancellationTokenSource();
        using var replacement = new CancellationTokenSource();
        var visible = false;
        gate.TryBeginTopologyChange(first, out _);
        Assert.That(gate.TryCaptureReveal(first, out var generation), Is.True);
        Assert.That(gate.TryReveal(generation, first, () => visible = true), Is.True);

        // The next event arrives before the first request's finally block.
        // Production hides only when this registration starts a new burst.
        gate.TryBeginTopologyChange(replacement, out var previous);
        if (previous is null)
        {
            visible = false;
        }
        gate.CompleteTopologyChange(first);

        Assert.That(previous, Is.Null, "a successful reveal must consume the old hidden burst immediately");
        Assert.That(visible, Is.False);
        Assert.That(gate.IsCurrentTopologyRequest(replacement), Is.True);
        Assert.That(gate.TryCaptureReveal(null, out _), Is.False);
    }

    [Test]
    public async Task FinalShowAndTopologyRegistration_AreSerializedBeforeTheUnlockedHide()
    {
        var gate = new DisplayPresentationGate();
        Assert.That(gate.TryCaptureReveal(null, out var generation), Is.True);
        using var request = new CancellationTokenSource();
        using var showEntered = new ManualResetEventSlim();
        using var registrationAttempted = new ManualResetEventSlim();
        var operations = new ConcurrentQueue<string>();
        var visible = false;

        var show = Task.Run(() => gate.TryReveal(generation, null, () =>
        {
            showEntered.Set();
            Assert.That(registrationAttempted.Wait(TimeSpan.FromSeconds(5)), Is.True);
            visible = true;
            operations.Enqueue("show");
        }));
        var register = Task.Run(() =>
        {
            Assert.That(showEntered.Wait(TimeSpan.FromSeconds(5)), Is.True);
            registrationAttempted.Set();
            Assert.That(gate.TryBeginTopologyChange(request, out _), Is.True);
            operations.Enqueue("register");
            // Production performs the cross-thread hide only after releasing
            // the gate; no gate owner can be waiting for the UI thread here.
            visible = false;
            operations.Enqueue("hide");
        });
        await Task.WhenAll(show, register).WaitAsync(TimeSpan.FromSeconds(10));

        Assert.That(await show, Is.True);
        Assert.That(operations.ToArray(), Is.EqualTo(new[] { "show", "register", "hide" }));
        Assert.That(visible, Is.False);
    }

    [Test]
    public void Stop_InvalidatesCapturedWorkAndReturnsOnlyTheCurrentRequest()
    {
        var gate = new DisplayPresentationGate();
        using var request = new CancellationTokenSource();
        using var later = new CancellationTokenSource();
        var presentation = gate.InvalidatePresentation();
        gate.TryBeginTopologyChange(request, out _);
        Assert.That(gate.TryCaptureReveal(request, out var generation), Is.True);

        Assert.That(gate.Stop(), Is.SameAs(request));
        Assert.That(gate.TryBeginTopologyChange(later, out _), Is.False);
        Assert.That(gate.IsCurrentTopologyRequest(request), Is.False);
        Assert.That(gate.IsCurrentPresentation(presentation), Is.False);
        Assert.That(gate.TryCaptureReveal(null, out _), Is.False);
        Assert.That(gate.TryReveal(generation, request, () => Assert.Fail("stopped reveal")), Is.False);
    }
}
