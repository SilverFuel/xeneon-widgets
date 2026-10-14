using NUnit.Framework;
using XenonEdgeHost;

namespace XenonEdgeHost.Tests;

public sealed class BoundedTaskDispatcherTests
{
    [Test]
    public async Task DispatchAsync_NeverSchedulesMoreThanConfiguredConcurrency()
    {
        await using var dispatcher = new BoundedTaskDispatcher(2);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var started = 0;
        var active = 0;
        var maximumActive = 0;

        async Task Work(CancellationToken cancellationToken)
        {
            var current = Interlocked.Increment(ref active);
            UpdateMaximum(ref maximumActive, current);
            Interlocked.Increment(ref started);
            try
            {
                await release.Task.WaitAsync(cancellationToken);
            }
            finally
            {
                Interlocked.Decrement(ref active);
            }
        }

        var dispatches = Enumerable.Range(0, 8)
            .Select(_ => dispatcher.DispatchAsync(Work).AsTask())
            .ToArray();

        await WaitUntilAsync(() => Volatile.Read(ref started) == 2);
        await Task.Delay(50);

        Assert.That(Volatile.Read(ref started), Is.EqualTo(2));
        Assert.That(dispatcher.ActiveCount, Is.EqualTo(2));

        release.TrySetResult();
        Assert.That(await Task.WhenAll(dispatches), Is.All.True);
        await dispatcher.StopAsync();

        Assert.Multiple((Action)(() =>
        {
            Assert.That(maximumActive, Is.EqualTo(2));
            Assert.That(active, Is.Zero);
            Assert.That(dispatcher.ActiveCount, Is.Zero);
        }));
    }

    [Test]
    public async Task StopAsync_CancelsAndDrainsActiveWork_ThenRejectsNewWork()
    {
        await using var dispatcher = new BoundedTaskDispatcher(1);
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var cancellationObserved = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var dispatched = await dispatcher.DispatchAsync(async cancellationToken =>
        {
            started.TrySetResult();
            try
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                cancellationObserved.TrySetResult();
                throw;
            }
        });

        await started.Task.WaitAsync(TimeSpan.FromSeconds(2));
        await dispatcher.StopAsync().WaitAsync(TimeSpan.FromSeconds(2));

        Assert.Multiple((Action)(() =>
        {
            Assert.That(dispatched, Is.True);
            Assert.That(cancellationObserved.Task.IsCompletedSuccessfully, Is.True);
            Assert.That(dispatcher.ActiveCount, Is.Zero);
        }));

        Assert.That(await dispatcher.DispatchAsync(_ => Task.CompletedTask), Is.False);
    }

    [Test]
    public async Task DispatchAsync_HonorsCancellationWhileWaitingForCapacity()
    {
        await using var dispatcher = new BoundedTaskDispatcher(1);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        Assert.That(await dispatcher.DispatchAsync(async _ =>
        {
            started.TrySetResult();
            await release.Task;
        }), Is.True);

        await started.Task.WaitAsync(TimeSpan.FromSeconds(2));
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        Assert.ThrowsAsync<OperationCanceledException>((Func<Task>)(async () =>
            await dispatcher.DispatchAsync(_ => Task.CompletedTask, cancellation.Token)));

        release.TrySetResult();
        await dispatcher.StopAsync();
    }

    [Test]
    public async Task StopAsync_RejectsCapacityWaitersWithoutSchedulingThem()
    {
        await using var dispatcher = new BoundedTaskDispatcher(1);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var firstStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var workStarted = 0;

        Assert.That(await dispatcher.DispatchAsync(async _ =>
        {
            Interlocked.Increment(ref workStarted);
            firstStarted.TrySetResult();
            await release.Task;
        }), Is.True);

        await firstStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));
        var waitingDispatch = dispatcher.DispatchAsync(_ =>
        {
            Interlocked.Increment(ref workStarted);
            return Task.CompletedTask;
        }).AsTask();

        await Task.Delay(50);
        Assert.That(waitingDispatch.IsCompleted, Is.False);

        var stopping = dispatcher.StopAsync();
        Assert.That(await waitingDispatch.WaitAsync(TimeSpan.FromSeconds(2)), Is.False);
        Assert.That(stopping.IsCompleted, Is.False, "shutdown must still drain the active request");

        release.TrySetResult();
        await stopping.WaitAsync(TimeSpan.FromSeconds(2));

        Assert.Multiple((Action)(() =>
        {
            Assert.That(workStarted, Is.EqualTo(1));
            Assert.That(dispatcher.ActiveCount, Is.Zero);
        }));
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(2);
        while (!condition())
        {
            if (DateTime.UtcNow >= deadline)
            {
                Assert.Fail("Timed out waiting for the bounded dispatcher test condition.");
            }

            await Task.Delay(10);
        }
    }

    private static void UpdateMaximum(ref int maximum, int candidate)
    {
        while (true)
        {
            var observed = Volatile.Read(ref maximum);
            if (candidate <= observed
                || Interlocked.CompareExchange(ref maximum, candidate, observed) == observed)
            {
                return;
            }
        }
    }
}
