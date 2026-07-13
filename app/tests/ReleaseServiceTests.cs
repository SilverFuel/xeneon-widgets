using System.Net;
using System.Text;
using System.Text.Json;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class ReleaseServiceTests
{
    [Test]
    public async Task GetLatestReleaseAsync_ReportsANewerPrereleaseAsAvailable()
    {
        const string release = """
            {
              "tag_name": "v0.3.1-beta.1",
              "html_url": "https://example.test/releases/v0.3.1-beta.1",
              "assets": []
            }
            """;
        using var client = new HttpClient(new StaticResponseHandler(release));
        var service = new ReleaseService(client);

        var payload = await service.GetLatestReleaseAsync("stable", CancellationToken.None);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(payload));

        Assert.That(document.RootElement.GetProperty("versionComparisonKnown").GetBoolean(), Is.True);
        Assert.That(document.RootElement.GetProperty("updateAvailable").GetBoolean(), Is.True);
    }

    private sealed class StaticResponseHandler : HttpMessageHandler
    {
        private readonly string _content;

        public StaticResponseHandler(string content)
        {
            _content = content;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(_content, Encoding.UTF8, "application/json")
            });
        }
    }
}
