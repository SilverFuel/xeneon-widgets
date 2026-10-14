using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using NUnit.Framework;
using XenonEdgeHost;

namespace XenonEdgeHost.Tests;

public sealed class NativeRequestServerTests
{
    [Test]
    public async Task IdleShutdown_DoesNotRequireTheStartingUiContextToPump()
    {
        using var listener = StartListener(out _);
        using var cancellation = new CancellationTokenSource();
        var context = new QueuedSynchronizationContext();
        var errors = new ConcurrentQueue<Exception>();
        var server = WithContext(context, () => NativeRequestServer.RunAsync(
            listener, cancellation.Token, 1, (_, _) => Task.CompletedTask,
            errors.Enqueue, errors.Enqueue));

        try
        {
            cancellation.Cancel();
            listener.Stop();
            await server.WaitAsync(TimeSpan.FromSeconds(3));
            Assert.Multiple((Action)(() =>
            {
                Assert.That(context.PostCount, Is.Zero,
                    "The old accept loop captured the UI context, so synchronous quit waited on its own blocked thread.");
                Assert.That(errors, Is.Empty);
            }));
        }
        finally
        {
            // Also release a captured continuation if this regression fails.
            context.Drain();
        }
    }

    [Test]
    public async Task Shutdown_DrainsAnInflightUiRequestWhileItsDispatcherRemainsAvailable()
    {
        using var listener = StartListener(out var uri);
        using var cancellation = new CancellationTokenSource();
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        var context = new QueuedSynchronizationContext();
        var errors = new ConcurrentQueue<Exception>();
        var dispatched = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var cancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var uiWork = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var drained = false;
        var server = WithContext(context, () => NativeRequestServer.RunAsync(
            listener, cancellation.Token, 1, async (_, token) =>
            {
                using var registration = token.Register(() => cancelled.TrySetResult());
                context.Post(_ => uiWork.TrySetResult(), null);
                dispatched.TrySetResult();
                // Existing UI-dispatched services can finish after cancellation.
                // Quit must await that work without blocking its UI dispatcher.
                await uiWork.Task;
                drained = true;
            }, errors.Enqueue, errors.Enqueue));
        var request = client.GetAsync(uri);

        try
        {
            await dispatched.Task.WaitAsync(TimeSpan.FromSeconds(3));
            cancellation.Cancel();
            listener.Stop();
            await cancelled.Task.WaitAsync(TimeSpan.FromSeconds(3));
            Assert.That(server.IsCompleted, Is.False, "Shutdown must not abandon an active request.");

            context.Drain();
            await server.WaitAsync(TimeSpan.FromSeconds(3));
            Assert.Multiple((Action)(() =>
            {
                Assert.That(drained, Is.True);
                Assert.That(context.PostCount, Is.EqualTo(1), "Only the explicitly dispatched UI work may use this context.");
                Assert.That(errors, Is.Empty);
            }));
        }
        finally
        {
            cancellation.Cancel();
            listener.Stop();
            context.Drain();
            uiWork.TrySetResult();
            try
            {
                using var response = await request;
            }
            catch (HttpRequestException)
            {
                // Stopping the listener closes the fixture request's response.
            }
            catch (TaskCanceledException)
            {
                // Preserve the primary test failure if startup itself failed.
            }
        }
    }

    private static Task WithContext(SynchronizationContext context, Func<Task> action)
    {
        var previous = SynchronizationContext.Current;
        SynchronizationContext.SetSynchronizationContext(context);
        try
        {
            return action();
        }
        finally
        {
            SynchronizationContext.SetSynchronizationContext(previous);
        }
    }

    private static HttpListener StartListener(out Uri uri)
    {
        using var reservation = new TcpListener(IPAddress.Loopback, 0);
        reservation.Start();
        var port = ((IPEndPoint)reservation.LocalEndpoint).Port;
        reservation.Stop();
        uri = new Uri($"http://127.0.0.1:{port}/");
        var listener = new HttpListener();
        listener.Prefixes.Add(uri.ToString());
        listener.Start();
        return listener;
    }

    private sealed class QueuedSynchronizationContext : SynchronizationContext
    {
        private readonly ConcurrentQueue<(SendOrPostCallback Callback, object? State)> _callbacks = new();
        private int _postCount;

        internal int PostCount => Volatile.Read(ref _postCount);

        public override void Post(SendOrPostCallback callback, object? state)
        {
            Interlocked.Increment(ref _postCount);
            _callbacks.Enqueue((callback, state));
        }

        internal void Drain()
        {
            while (_callbacks.TryDequeue(out var work))
            {
                work.Callback(work.State);
            }
        }
    }
}
