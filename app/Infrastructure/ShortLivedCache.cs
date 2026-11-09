namespace XenonEdgeHost;

// Holds one computed value for a short window so repeated reads share a single expensive computation.
// Concurrent callers wait for the in-flight computation instead of starting their own, while
// Invalidate never waits for it: a computation that finishes after an Invalidate is returned to
// its caller but not stored, so it cannot resurrect stale data.
internal sealed class ShortLivedCache<T> where T : class
{
    private readonly TimeSpan _lifetime;
    private readonly Func<DateTimeOffset> _clock;
    private readonly object _computeLock = new();
    private readonly object _stateLock = new();
    private T? _value;
    private DateTimeOffset _storedAt;
    private long _generation;

    public ShortLivedCache(TimeSpan lifetime, Func<DateTimeOffset>? clock = null)
    {
        _lifetime = lifetime;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public T GetOrCreate(Func<T> factory)
    {
        if (TryReadFresh(out var cached))
        {
            return cached;
        }

        lock (_computeLock)
        {
            // Another caller may have finished the computation while this one waited.
            return TryReadFresh(out cached) ? cached : Compute(factory);
        }
    }

    public T Refresh(Func<T> factory)
    {
        lock (_computeLock)
        {
            return Compute(factory);
        }
    }

    public void Invalidate()
    {
        lock (_stateLock)
        {
            _value = null;
            _generation++;
        }
    }

    private bool TryReadFresh(out T value)
    {
        lock (_stateLock)
        {
            if (_value is not null && _clock() - _storedAt < _lifetime)
            {
                value = _value;
                return true;
            }
        }

        value = null!;
        return false;
    }

    private T Compute(Func<T> factory)
    {
        long startedGeneration;
        lock (_stateLock)
        {
            startedGeneration = _generation;
        }

        var value = factory();
        lock (_stateLock)
        {
            if (_generation == startedGeneration)
            {
                _value = value;
                _storedAt = _clock();
            }
        }

        return value;
    }
}
