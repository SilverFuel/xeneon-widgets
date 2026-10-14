using System.Net;

namespace XenonEdgeHost;

internal static class NativeRequestServer
{
    internal static async Task RunAsync(
        HttpListener listener,
        CancellationToken cancellationToken,
        int maxConcurrentRequests,
        Func<HttpListenerContext, CancellationToken, Task> handleRequest,
        Action<Exception> onRequestError,
        Action<Exception> onServerError)
    {
        var requests = new BoundedTaskDispatcher(maxConcurrentRequests, onRequestError);
        try
        {
            while (listener.IsListening && !cancellationToken.IsCancellationRequested)
            {
                HttpListenerContext context;
                try
                {
                    // The host starts this loop on its UI thread. Neither accepting
                    // requests nor draining them may depend on that thread's context.
                    context = await listener.GetContextAsync().ConfigureAwait(false);
                }
                catch (HttpListenerException)
                {
                    break;
                }
                catch (ObjectDisposedException)
                {
                    break;
                }

                bool dispatched;
                try
                {
                    dispatched = await requests.DispatchAsync(
                        token => handleRequest(context, token),
                        cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    AbortResponse(context.Response);
                    break;
                }

                if (!dispatched)
                {
                    AbortResponse(context.Response);
                    break;
                }
            }
        }
        catch (Exception error)
        {
            onServerError(error);
        }
        finally
        {
            await requests.DisposeAsync().ConfigureAwait(false);
        }
    }

    private static void AbortResponse(HttpListenerResponse response)
    {
        try
        {
            response.Abort();
        }
        catch
        {
        }
    }
}
