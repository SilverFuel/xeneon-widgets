namespace XenonEdgeHost;

// Native DDC calls cannot be cancelled safely. Keep their ownership until they
// actually return, even when a caller stops polling. No native work runs under
// this lock, and GET never waits for the operation or queues another one.
internal sealed class MonitorControlQueryCoordinator
{
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromSeconds(5);
    private static readonly MonitorControlQueryResult PendingResult = new([], Pending: true);
    private readonly object _sync = new();
    private readonly Func<IReadOnlyList<MonitorControlSnapshot>> _read;
    private readonly Action<MonitorControlRequest> _write;
    private readonly Func<DateTimeOffset> _clock;
    private readonly Action<Action> _queueRead;
    private readonly Action<Exception>? _onReadFailure;
    private MonitorControlQueryResult? _cached;
    private DateTimeOffset _completedAt;
    private bool _operationInProgress;

    internal MonitorControlQueryCoordinator(
        Func<IReadOnlyList<MonitorControlSnapshot>> read,
        Action<MonitorControlRequest> write,
        Action<Exception>? onReadFailure = null,
        Func<DateTimeOffset>? clock = null,
        Action<Action>? queueRead = null)
    {
        _read = read;
        _write = write;
        _onReadFailure = onReadFailure;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _queueRead = queueRead ?? (operation => { _ = Task.Run(operation); });
    }

    internal MonitorControlQueryResult GetSnapshot()
    {
        lock (_sync)
        {
            if (_operationInProgress)
            {
                return PendingResult;
            }

            var age = _clock() - _completedAt;
            if (_cached is not null && age >= TimeSpan.Zero && age < CacheLifetime)
            {
                return _cached;
            }

            _cached = null;
            _operationInProgress = true;
        }

        try
        {
            _queueRead(ReadAndPublish);
        }
        catch (Exception error)
        {
            PublishReadFailure(error);
            return new MonitorControlQueryResult([], Failed: true);
        }

        return PendingResult;
    }

    internal MonitorControlQueryResult Set(MonitorControlRequest request)
    {
        lock (_sync)
        {
            if (_operationInProgress)
            {
                throw new InvalidOperationException("Companion-display controls are busy. Wait for the current hardware operation to finish, then try again.");
            }

            _cached = null;
            _operationInProgress = true;
        }

        try
        {
            _write(request);
        }
        finally
        {
            lock (_sync)
            {
                _operationInProgress = false;
            }
        }

        // A successful hardware write is not evidence of the new reading. Let
        // the same single-flight reader refresh it without blocking the POST.
        return GetSnapshot();
    }

    private void ReadAndPublish()
    {
        try
        {
            Publish(new MonitorControlQueryResult(_read().ToArray()));
        }
        catch (Exception error)
        {
            PublishReadFailure(error);
        }
    }

    private void PublishReadFailure(Exception error)
    {
        // Logging must not strand hardware ownership or fault an unobserved
        // background task if the log destination itself is unavailable.
        try
        {
            _onReadFailure?.Invoke(error);
        }
        catch
        {
        }

        Publish(new MonitorControlQueryResult([], Failed: true));
    }

    private void Publish(MonitorControlQueryResult result)
    {
        lock (_sync)
        {
            _cached = result;
            _completedAt = _clock();
            _operationInProgress = false;
        }
    }
}

internal sealed record MonitorControlQueryResult(
    IReadOnlyList<MonitorControlSnapshot> Displays,
    bool Pending = false,
    bool Failed = false);
