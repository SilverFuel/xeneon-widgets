using Microsoft.UI.Dispatching;

namespace XenonEdgeHost;

public static class UiDispatcher
{
    private static DispatcherQueue? _dispatcherQueue;

    public static void Initialize(DispatcherQueue dispatcherQueue)
    {
        _dispatcherQueue = dispatcherQueue;
    }

    public static Task InvokeAsync(Func<Task> callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        return InvokeAsync(async () =>
        {
            await callback();
            return true;
        });
    }

    public static Task<T> InvokeAsync<T>(Func<T> callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        return InvokeAsync(() => Task.FromResult(callback()));
    }

    public static Task<T> InvokeAsync<T>(Func<Task<T>> callback)
    {
        ArgumentNullException.ThrowIfNull(callback);

        var dispatcherQueue = _dispatcherQueue ?? throw new InvalidOperationException("The UI dispatcher is not initialized.");
        if (dispatcherQueue.HasThreadAccess)
        {
            return callback();
        }

        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!dispatcherQueue.TryEnqueue(async () =>
            {
                try
                {
                    completion.TrySetResult(await callback());
                }
                catch (Exception error)
                {
                    completion.TrySetException(error);
                }
            }))
        {
            completion.TrySetException(new InvalidOperationException("The UI dispatcher rejected a queued callback."));
        }

        return completion.Task;
    }
}
