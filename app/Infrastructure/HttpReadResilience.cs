using System.Net;
using Polly;
using Polly.Retry;
using Polly.Timeout;

namespace XenonEdgeHost;

internal static class HttpReadResilience
{
    private static readonly ResiliencePipeline<HttpResponseMessage> DefaultPipeline = CreatePipeline();

    internal static ResiliencePipeline<HttpResponseMessage> CreatePipeline(
        int maxRetryAttempts = 2,
        TimeSpan? retryDelay = null,
        TimeSpan? attemptTimeout = null)
    {
        var shouldRetry = new PredicateBuilder<HttpResponseMessage>()
            .Handle<HttpRequestException>()
            .Handle<TimeoutRejectedException>()
            .HandleResult(response => IsTransientStatus(response.StatusCode));

        return new ResiliencePipelineBuilder<HttpResponseMessage>()
            .AddRetry(new RetryStrategyOptions<HttpResponseMessage>
            {
                ShouldHandle = shouldRetry,
                MaxRetryAttempts = maxRetryAttempts,
                Delay = retryDelay ?? TimeSpan.FromMilliseconds(250),
                BackoffType = DelayBackoffType.Exponential,
                UseJitter = true,
                OnRetry = arguments =>
                {
                    arguments.Outcome.Result?.Dispose();
                    return default;
                }
            })
            .AddTimeout(attemptTimeout ?? TimeSpan.FromSeconds(8))
            .Build();
    }

    internal static ValueTask<HttpResponseMessage> SendAsync(
        HttpClient client,
        Func<HttpRequestMessage> requestFactory,
        int maxResponseBytes,
        CancellationToken cancellationToken,
        ResiliencePipeline<HttpResponseMessage>? pipeline = null)
    {
        ArgumentNullException.ThrowIfNull(client);
        ArgumentNullException.ThrowIfNull(requestFactory);
        ArgumentOutOfRangeException.ThrowIfLessThan(maxResponseBytes, 1);

        return (pipeline ?? DefaultPipeline).ExecuteAsync(
            async token =>
            {
                using var request = requestFactory();
                var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
                if (IsTransientStatus(response.StatusCode))
                {
                    return response;
                }

                try
                {
                    await BufferContentAsync(response, maxResponseBytes, token);
                    return response;
                }
                catch
                {
                    response.Dispose();
                    throw;
                }
            },
            cancellationToken);
    }

    private static async Task BufferContentAsync(HttpResponseMessage response, int maxResponseBytes, CancellationToken cancellationToken)
    {
        var original = response.Content;
        if (original.Headers.ContentLength is > 0 && original.Headers.ContentLength > maxResponseBytes)
        {
            throw new InvalidOperationException($"HTTP response exceeded the {maxResponseBytes}-byte safety limit.");
        }

        await using var stream = await original.ReadAsStreamAsync(cancellationToken);
        using var buffer = new MemoryStream(Math.Min(maxResponseBytes, 64 * 1024));
        var chunk = new byte[8192];
        while (true)
        {
            var read = await stream.ReadAsync(chunk, cancellationToken);
            if (read == 0)
            {
                break;
            }

            if (buffer.Length + read > maxResponseBytes)
            {
                throw new InvalidOperationException($"HTTP response exceeded the {maxResponseBytes}-byte safety limit.");
            }

            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
        }

        var replacement = new ByteArrayContent(buffer.ToArray());
        foreach (var header in original.Headers)
        {
            if (header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            replacement.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        response.Content = replacement;
        original.Dispose();
    }

    internal static bool IsTransientStatus(HttpStatusCode statusCode)
    {
        var value = (int)statusCode;
        return statusCode is HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests
            || value >= 500;
    }
}
