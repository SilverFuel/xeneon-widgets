using System.Collections.Concurrent;
using System.Text.Json;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class MonitorControlQueryCoordinatorTests
{
    [Test]
    public void GetSnapshot_QueuesOneReadWithoutRunningItOnTheCaller()
    {
        var queue = new ReadQueue();
        var reads = 0;
        var coordinator = new MonitorControlQueryCoordinator(
            () => { reads++; return [Display(50)]; },
            _ => Assert.Fail("GET must never write monitor controls"),
            queueRead: queue.Enqueue);

        AssertPending(coordinator.GetSnapshot());
        AssertPending(coordinator.GetSnapshot());
        Assert.That(reads, Is.Zero);
        Assert.That(queue.Count, Is.EqualTo(1));

        queue.RunNext();
        AssertResponse(coordinator.GetSnapshot(), "ready", true, 1);
        Assert.That(reads, Is.EqualTo(1));
    }

    [Test]
    public async Task BlockedRead_RemainsSingleFlightEvenAfterTheCacheLifetime()
    {
        var queue = new ReadQueue();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var release = new ManualResetEventSlim();
        var now = DateTimeOffset.UnixEpoch;
        var reads = 0;
        var coordinator = new MonitorControlQueryCoordinator(
            () =>
            {
                Interlocked.Increment(ref reads);
                entered.SetResult();
                if (!release.Wait(TimeSpan.FromSeconds(10)))
                {
                    throw new TimeoutException("Test did not release its managed reader");
                }
                return [Display(50)];
            },
            _ => Assert.Fail("GET must never write monitor controls"),
            clock: () => now,
            queueRead: queue.Enqueue);

        AssertPending(coordinator.GetSnapshot());
        var readTask = Task.Run(queue.RunNext);
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            now += TimeSpan.FromDays(1);
            // Complete GET while the read is still blocked, not merely after
            // its release. The deadline is a test deadlock guard, not a sleep.
            var snapshot = await Task.Run(coordinator.GetSnapshot).WaitAsync(TimeSpan.FromSeconds(5));
            AssertPending(snapshot);
            AssertPending(coordinator.GetSnapshot());
            Assert.That(reads, Is.EqualTo(1));
            Assert.That(queue.Count, Is.Zero);
        }
        finally
        {
            release.Set();
            await readTask.WaitAsync(TimeSpan.FromSeconds(5));
        }

        AssertResponse(coordinator.GetSnapshot(), "ready", true, 1);
    }

    [Test]
    public void ConcurrentGets_ReserveOnlyOneBackgroundRead()
    {
        var queue = new ReadQueue();
        var results = new ConcurrentBag<MonitorControlQueryResult>();
        var coordinator = new MonitorControlQueryCoordinator(
            () => [Display(50)],
            _ => Assert.Fail("GET must never write monitor controls"),
            queueRead: queue.Enqueue);

        Parallel.For(0, 64, _ => results.Add(coordinator.GetSnapshot()));

        Assert.That(queue.Count, Is.EqualTo(1));
        Assert.That(results.Count, Is.EqualTo(64));
        foreach (var result in results)
        {
            AssertPending(result);
        }
        queue.RunNext();
        AssertResponse(coordinator.GetSnapshot(), "ready", true, 1);
    }

    [Test]
    public void CacheExpiresAtFiveSeconds_WithoutReturningOldSupportedControls()
    {
        var queue = new ReadQueue();
        var now = DateTimeOffset.UnixEpoch;
        var reads = 0;
        var coordinator = new MonitorControlQueryCoordinator(
            () => [Display(++reads * 10)],
            _ => { },
            clock: () => now,
            queueRead: queue.Enqueue);

        AssertPending(coordinator.GetSnapshot());
        queue.RunNext();
        var first = coordinator.GetSnapshot();
        now += TimeSpan.FromMilliseconds(4999);
        Assert.That(coordinator.GetSnapshot(), Is.SameAs(first));
        Assert.That(queue.Count, Is.Zero);

        now += TimeSpan.FromMilliseconds(1);
        AssertPending(coordinator.GetSnapshot());
        AssertPending(coordinator.GetSnapshot());
        Assert.That(queue.Count, Is.EqualTo(1));
        queue.RunNext();
        var refreshed = coordinator.GetSnapshot();
        AssertResponse(refreshed, "ready", true, 1);
        Assert.That(refreshed.Displays[0].Brightness, Is.EqualTo(20));
        Assert.That(reads, Is.EqualTo(2));
    }

    [Test]
    public void ReadFailure_ReturnsUnavailableAndAllowsOneRetryAfterExpiry()
    {
        var queue = new ReadQueue();
        var now = DateTimeOffset.UnixEpoch;
        var reads = 0;
        var failures = new List<Exception>();
        var failure = new InvalidOperationException("Managed read failure");
        var coordinator = new MonitorControlQueryCoordinator(
            () => ++reads == 1 ? throw failure : [Display(65)],
            _ => { },
            onReadFailure: failures.Add,
            clock: () => now,
            queueRead: queue.Enqueue);

        coordinator.GetSnapshot();
        queue.RunNext();
        var unavailable = coordinator.GetSnapshot();
        AssertResponse(unavailable, "unavailable", false, 0);
        Assert.That(unavailable.Failed, Is.True);
        Assert.That(failures, Is.EqualTo(new[] { failure }));
        Assert.That(coordinator.GetSnapshot(), Is.SameAs(unavailable));
        Assert.That(queue.Count, Is.Zero);

        now += TimeSpan.FromSeconds(5);
        AssertPending(coordinator.GetSnapshot());
        queue.RunNext();
        AssertResponse(coordinator.GetSnapshot(), "ready", true, 1);
    }

    [Test]
    public void SetDuringRead_IsRejectedBeforeInvokingTheWriter()
    {
        var queue = new ReadQueue();
        var writes = 0;
        var coordinator = new MonitorControlQueryCoordinator(
            () => [Display(50)], _ => writes++, queueRead: queue.Enqueue);

        AssertPending(coordinator.GetSnapshot());
        var error = Assert.Throws<InvalidOperationException>((Action)(() => coordinator.Set(new MonitorControlRequest())));
        Assert.That(error!.Message, Does.Contain("busy"));
        Assert.That(writes, Is.Zero);
        Assert.That(queue.Count, Is.EqualTo(1));

        queue.RunNext();
        AssertPending(coordinator.Set(new MonitorControlRequest()));
        Assert.That(writes, Is.EqualTo(1));
        Assert.That(queue.Count, Is.EqualTo(1), "successful writes must refresh instead of returning old values");
        queue.RunNext();
        AssertResponse(coordinator.GetSnapshot(), "ready", true, 1);
    }

    [Test]
    public async Task ActiveWrite_DoesNotBlockGetOrQueueAnotherWriteOrRead()
    {
        var queue = new ReadQueue();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var release = new ManualResetEventSlim();
        var writes = 0;
        var request = new MonitorControlRequest();
        var coordinator = new MonitorControlQueryCoordinator(
            () => [Display(50)],
            received =>
            {
                Assert.That(received, Is.SameAs(request));
                Interlocked.Increment(ref writes);
                entered.SetResult();
                if (!release.Wait(TimeSpan.FromSeconds(10)))
                {
                    throw new TimeoutException("Test did not release its managed writer");
                }
            },
            queueRead: queue.Enqueue);

        var writeTask = Task.Run(() => coordinator.Set(request));
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            AssertPending(await Task.Run(coordinator.GetSnapshot).WaitAsync(TimeSpan.FromSeconds(5)));
            Assert.Throws<InvalidOperationException>((Action)(() => coordinator.Set(new MonitorControlRequest())));
            Assert.That(writes, Is.EqualTo(1));
            Assert.That(queue.Count, Is.Zero);
        }
        finally
        {
            release.Set();
            await writeTask.WaitAsync(TimeSpan.FromSeconds(5));
        }

        AssertPending(await writeTask);
        Assert.That(queue.Count, Is.EqualTo(1));
        queue.RunNext();
        AssertResponse(coordinator.GetSnapshot(), "ready", true, 1);
    }

    [Test]
    public void WriteFailure_PreservesTheErrorAndReleasesOwnershipWithoutOldValues()
    {
        var queue = new ReadQueue();
        var failure = new InvalidOperationException("Managed write failure");
        var coordinator = new MonitorControlQueryCoordinator(
            () => [Display(50)], _ => throw failure, queueRead: queue.Enqueue);
        coordinator.GetSnapshot();
        queue.RunNext();
        AssertResponse(coordinator.GetSnapshot(), "ready", true, 1);

        var actual = Assert.Throws<InvalidOperationException>((Action)(() => coordinator.Set(new MonitorControlRequest())));
        Assert.That(actual, Is.SameAs(failure));
        AssertPending(coordinator.GetSnapshot());
        Assert.That(queue.Count, Is.EqualTo(1));
        queue.RunNext();
        AssertResponse(coordinator.GetSnapshot(), "ready", true, 1);
    }

    [Test]
    public void SchedulingFailure_IsUnavailableAndDoesNotStrandOwnership()
    {
        var schedules = 0;
        var writes = 0;
        var coordinator = new MonitorControlQueryCoordinator(
            () => throw new AssertionException("Failed scheduling must not run the reader"),
            _ => writes++,
            queueRead: _ => { schedules++; throw new InvalidOperationException("Managed scheduling failure"); });

        AssertResponse(coordinator.GetSnapshot(), "unavailable", false, 0);
        AssertResponse(coordinator.GetSnapshot(), "unavailable", false, 0);
        Assert.That(schedules, Is.EqualTo(1));
        AssertResponse(coordinator.Set(new MonitorControlRequest()), "unavailable", false, 0);
        Assert.That(writes, Is.EqualTo(1));
        Assert.That(schedules, Is.EqualTo(2));
    }

    [Test]
    public void LoggingFailure_DoesNotHideReadFailureOrStrandOwnership()
    {
        var queue = new ReadQueue();
        var writes = 0;
        var coordinator = new MonitorControlQueryCoordinator(
            () => throw new InvalidOperationException("Managed read failure"),
            _ => writes++,
            onReadFailure: _ => throw new InvalidOperationException("Managed log failure"),
            queueRead: queue.Enqueue);

        coordinator.GetSnapshot();
        Assert.DoesNotThrow((Action)queue.RunNext);
        AssertResponse(coordinator.GetSnapshot(), "unavailable", false, 0);
        AssertPending(coordinator.Set(new MonitorControlRequest()));
        Assert.That(writes, Is.EqualTo(1));
        queue.RunNext();
    }

    [Test]
    public void CompletedEmptyAndUnsupportedReads_RetainTheirExistingResponseContract()
    {
        AssertResponse(new MonitorControlQueryResult([]), "unavailable", false, 0);
        AssertResponse(new MonitorControlQueryResult([new MonitorControlSnapshot { Name = "Companion" }]), "unsupported", false, 1);
    }

    private static MonitorControlSnapshot Display(int brightness) => new()
    {
        Index = 0,
        Name = "Managed companion",
        BrightnessSupported = true,
        Brightness = brightness
    };

    private static void AssertPending(MonitorControlQueryResult result)
    {
        Assert.That(result.Pending, Is.True);
        AssertResponse(result, "pending", false, 0);
    }

    private static void AssertResponse(MonitorControlQueryResult result, string status, bool supported, int displayCount)
    {
        // Exercise the same response builder used by the production service.
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(MonitorControlService.CreateSnapshotResponse(result)));
        var response = json.RootElement;
        Assert.That(response.GetProperty("status").GetString(), Is.EqualTo(status));
        Assert.That(response.GetProperty("supported").GetBoolean(), Is.EqualTo(supported));
        Assert.That(response.GetProperty("displays").GetArrayLength(), Is.EqualTo(displayCount));
        Assert.That(response.GetProperty("primaryExcluded").GetBoolean(), Is.True);
        Assert.That(response.GetProperty("scope").GetString(), Is.EqualTo("companion-only"));
        Assert.That(response.GetProperty("message").GetString(), Does.Contain("The primary display is intentionally excluded."));
    }

    private sealed class ReadQueue
    {
        private readonly ConcurrentQueue<Action> _pending = new();
        internal int Count => _pending.Count;
        internal void Enqueue(Action read) => _pending.Enqueue(read);
        internal void RunNext()
        {
            Assert.That(_pending.TryDequeue(out var read), Is.True, "expected one scheduled read");
            read!();
        }
    }
}
