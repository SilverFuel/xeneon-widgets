using System.Net;
using NUnit.Framework;
using XenonEdgeHost;

namespace XenonEdgeHost.Tests;

public sealed class HttpReadResilienceTests
{
    [Test]
    public async Task SendAsync_RetriesTransientResponses()
    {
        using var handler = new SequenceHandler(
            HttpStatusCode.ServiceUnavailable,
            HttpStatusCode.OK);
        using var client = new HttpClient(handler);
        var pipeline = HttpReadResilience.CreatePipeline(
            maxRetryAttempts: 1,
            retryDelay: TimeSpan.Zero,
            attemptTimeout: TimeSpan.FromSeconds(1));

        using var response = await HttpReadResilience.SendAsync(
            client,
            () => new HttpRequestMessage(HttpMethod.Get, "https://example.test/status"),
            1024,
            CancellationToken.None,
            pipeline);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(handler.RequestCount, Is.EqualTo(2));
    }

    [Test]
    public async Task SendAsync_DoesNotRetryPermanentClientErrors()
    {
        using var handler = new SequenceHandler(HttpStatusCode.BadRequest);
        using var client = new HttpClient(handler);
        var pipeline = HttpReadResilience.CreatePipeline(
            maxRetryAttempts: 2,
            retryDelay: TimeSpan.Zero,
            attemptTimeout: TimeSpan.FromSeconds(1));

        using var response = await HttpReadResilience.SendAsync(
            client,
            () => new HttpRequestMessage(HttpMethod.Get, "https://example.test/status"),
            1024,
            CancellationToken.None,
            pipeline);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.BadRequest));
        Assert.That(handler.RequestCount, Is.EqualTo(1));
    }

    private sealed class SequenceHandler : HttpMessageHandler
    {
        private readonly Queue<HttpStatusCode> _statuses;

        public SequenceHandler(params HttpStatusCode[] statuses)
        {
            _statuses = new Queue<HttpStatusCode>(statuses);
        }

        public int RequestCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            var status = _statuses.Count > 1 ? _statuses.Dequeue() : _statuses.Peek();
            return Task.FromResult(new HttpResponseMessage(status));
        }
    }
}
