using NUnit.Framework;
using XenonEdgeHost;

namespace XenonEdgeHost.Tests;

public sealed class ShortLivedCacheTests
{
    private DateTimeOffset _now;

    [SetUp]
    public void SetUp()
    {
        _now = new DateTimeOffset(2026, 11, 7, 12, 0, 0, TimeSpan.Zero);
    }

    private ShortLivedCache<string> CreateCache() => new(TimeSpan.FromSeconds(5), () => _now);

    [Test]
    public void GetOrCreate_ReusesTheValueInsideTheLifetime()
    {
        var cache = CreateCache();
        var calls = 0;

        var first = cache.GetOrCreate(() => $"scan-{++calls}");
        _now = _now.AddSeconds(4);
        var second = cache.GetOrCreate(() => $"scan-{++calls}");

        Assert.That(second, Is.EqualTo(first));
        Assert.That(calls, Is.EqualTo(1));
    }

    [Test]
    public void GetOrCreate_RecomputesOnceTheLifetimeHasPassed()
    {
        var cache = CreateCache();
        var calls = 0;

        cache.GetOrCreate(() => $"scan-{++calls}");
        _now = _now.AddSeconds(5);
        var second = cache.GetOrCreate(() => $"scan-{++calls}");

        Assert.That(second, Is.EqualTo("scan-2"));
    }

    [Test]
    public void Invalidate_ForcesTheNextReadToRecompute()
    {
        var cache = CreateCache();
        var calls = 0;

        cache.GetOrCreate(() => $"scan-{++calls}");
        cache.Invalidate();
        var second = cache.GetOrCreate(() => $"scan-{++calls}");

        Assert.That(second, Is.EqualTo("scan-2"));
    }

    [Test]
    public void Refresh_AlwaysComputesAndSharesTheResultWithLaterReads()
    {
        var cache = CreateCache();
        var calls = 0;

        cache.GetOrCreate(() => $"scan-{++calls}");
        var refreshed = cache.Refresh(() => $"scan-{++calls}");
        var shared = cache.GetOrCreate(() => $"scan-{++calls}");

        Assert.That(refreshed, Is.EqualTo("scan-2"));
        Assert.That(shared, Is.EqualTo("scan-2"));
        Assert.That(calls, Is.EqualTo(2));
    }

    [Test]
    public void GetOrCreate_DoesNotCacheAFailedComputation()
    {
        var cache = CreateCache();

        Func<string> failing = () => throw new InvalidOperationException("scan failed");
        Assert.Throws<InvalidOperationException>(new TestDelegate(() => cache.GetOrCreate(failing)));
        var recovered = cache.GetOrCreate(() => "scan-ok");

        Assert.That(recovered, Is.EqualTo("scan-ok"));
    }

    [Test]
    public void Invalidate_DuringAComputationDiscardsItsResult()
    {
        var cache = CreateCache();
        var calls = 0;

        var inFlight = cache.GetOrCreate(() =>
        {
            cache.Invalidate();
            return $"scan-{++calls}";
        });
        var next = cache.GetOrCreate(() => $"scan-{++calls}");

        Assert.That(inFlight, Is.EqualTo("scan-1"));
        Assert.That(next, Is.EqualTo("scan-2"));
    }

    [Test]
    public void Invalidate_DoesNotWaitForAComputationInProgress()
    {
        var cache = CreateCache();
        var started = new ManualResetEventSlim();
        var release = new ManualResetEventSlim();

        var slow = Task.Run(() => cache.GetOrCreate(() =>
        {
            started.Set();
            release.Wait(TimeSpan.FromSeconds(5));
            return "scan";
        }));
        Assert.That(started.Wait(TimeSpan.FromSeconds(5)), Is.True);

        var invalidate = Task.Run(cache.Invalidate);
        var finishedInTime = invalidate.Wait(TimeSpan.FromSeconds(2));
        release.Set();
        slow.Wait();

        Assert.That(finishedInTime, Is.True);
    }

    [Test]
    public void GetOrCreate_MakesConcurrentCallersShareOneComputation()
    {
        var cache = CreateCache();
        var calls = 0;
        var started = new ManualResetEventSlim();
        var release = new ManualResetEventSlim();

        string Slow()
        {
            Interlocked.Increment(ref calls);
            started.Set();
            release.Wait(TimeSpan.FromSeconds(5));
            return "scan";
        }

        var first = Task.Run(() => cache.GetOrCreate(Slow));
        Assert.That(started.Wait(TimeSpan.FromSeconds(5)), Is.True);
        var second = Task.Run(() => cache.GetOrCreate(Slow));
        release.Set();
        Task.WaitAll(first, second);

        Assert.That(calls, Is.EqualTo(1));
        Assert.That(second.Result, Is.EqualTo("scan"));
    }
}
