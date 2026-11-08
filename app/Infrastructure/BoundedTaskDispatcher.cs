namespace XenonEdgeHost;

internal sealed class BoundedTaskDispatcher : IAsyncDisposable
{
    private readonly SemaphoreSlim _slots;
    private readonly CancellationTokenSource _shutdown = new();
    private readonly Action<Exception>? _onUnhandledException;
    private readonly object _sync = new();
    private readonly HashSet<Task> _activeTasks = [];
    private TaskCompletionSource _dispatchesDrained = CreateCompletedSignal();
    private int _pendingDispatches;
    private bool _stopping;
    private bool _disposed;

    internal BoundedTaskDispatcher(int maxConcurrency, Action<Exception>? onUnhandledException = null)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maxConcurrency, 1);
        _slots = new SemaphoreSlim(maxConcurrency, maxConcurrency);
        _onUnhandledException = onUnhandledException;
    }

    internal int ActiveCount
    {
        get
        {
            lock (_sync)
            {
                return _activeTasks.Count;
            }
        }
    }

    internal async ValueTask<bool> DispatchAsync(
        Func<CancellationToken, Task> operation,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(operation);

        lock (_sync)
        {
            if (_stopping || _disposed)
            {
                return false;
            }

            if (_pendingDispatches == 0)
            {
                _dispatchesDrained = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            }

            _pendingDispatches++;
        }

        try
        {
            using var linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken,
                _shutdown.Token);

            try
            {
                await _slots.WaitAsync(linkedCancellation.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (_shutdown.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
            {
                return false;
            }

            lock (_sync)
            {
                if (_stopping || _disposed)
                {
                    _slots.Release();
                    return false;
                }

                _activeTasks.RemoveWhere(task => task.IsCompleted);

                // A slot is acquired before scheduling, so Task.Run work can never
                // exceed the configured request concurrency.
                var task = Task.Run(() => RunOperationAsync(operation), CancellationToken.None);
                _activeTasks.Add(task);
            }

            return true;
        }
        finally
        {
            CompleteDispatch();
        }
    }

    internal async Task StopAsync()
    {
        Task[] activeTasks;
        Task dispatchesDrained;
        var cancel = false;

        lock (_sync)
        {
            if (_disposed)
            {
                return;
            }

            if (!_stopping)
            {
                _stopping = true;
                cancel = true;
            }

            activeTasks = _activeTasks.ToArray();
            dispatchesDrained = _dispatchesDrained.Task;
        }

        if (cancel)
        {
            _shutdown.Cancel();
        }

        await Task.WhenAll(Task.WhenAll(activeTasks), dispatchesDrained).ConfigureAwait(false);

        lock (_sync)
        {
            _activeTasks.RemoveWhere(task => task.IsCompleted);
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync().ConfigureAwait(false);

        lock (_sync)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
        }

        _shutdown.Dispose();
        _slots.Dispose();
    }

    private async Task RunOperationAsync(Func<CancellationToken, Task> operation)
    {
        try
        {
            await operation(_shutdown.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
        }
        catch (Exception error)
        {
            try
            {
                _onUnhandledException?.Invoke(error);
            }
            catch
            {
            }
        }
        finally
        {
            _slots.Release();
        }
    }

    private void CompleteDispatch()
    {
        lock (_sync)
        {
            _pendingDispatches--;
            if (_pendingDispatches == 0)
            {
                _dispatchesDrained.TrySetResult();
            }
        }
    }

    private static TaskCompletionSource CreateCompletedSignal()
    {
        var signal = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        signal.SetResult();
        return signal;
    }
}
