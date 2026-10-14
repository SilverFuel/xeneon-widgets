using System.Net;
using System.Text;
using System.Text.Json;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class ReleaseServiceTests
{
    [TestCase("0.3.0-beta.1", "0.3.0-beta.2", true, "newer")]
    [TestCase("0.3.0-beta.2", "0.3.0-rc.1", true, "newer")]
    [TestCase("0.3.0", "0.3.0", false, "current")]
    [TestCase("0.3.0", "0.3.1-beta.1", true, "newer")]
    public async Task GetLatestReleaseAsync_UsesSemVerOrdering(string currentVersion, string latestVersion, bool expectedUpdate, string expectedRelation)
    {
        var prerelease = latestVersion.Contains('-');
        var release = $$"""
            [{
              "tag_name": "v{{latestVersion}}",
              "html_url": "https://example.test/releases/v{{latestVersion}}",
              "prerelease": {{prerelease.ToString().ToLowerInvariant()}},
              "assets": []
            }]
            """;
        using var client = new HttpClient(new StaticResponseHandler(release));
        var service = new ReleaseService(client, currentVersion);

        var payload = await service.GetLatestReleaseAsync(prerelease ? "beta" : "stable", CancellationToken.None);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(payload));

        Assert.That(document.RootElement.GetProperty("versionComparisonKnown").GetBoolean(), Is.True);
        Assert.That(document.RootElement.GetProperty("updateAvailable").GetBoolean(), Is.EqualTo(expectedUpdate));
        Assert.That(document.RootElement.GetProperty("versionRelation").GetString(), Is.EqualTo(expectedRelation));
    }

    [Test]
    public async Task GetLatestReleaseAsync_ReportsFeedBehindCurrentBeta()
    {
        const string releases = """
            [{
              "tag_name": "v0.2.0",
              "html_url": "https://example.test/releases/v0.2.0",
              "prerelease": true,
              "assets": [
                { "name": "XenonEdgeHost-Setup-0.2.0.exe", "browser_download_url": "https://example.test/old.exe", "size": 10 }
              ]
            }]
            """;
        using var client = new HttpClient(new StaticResponseHandler(releases));
        var service = new ReleaseService(client, "0.3.0-beta.1");

        var payload = await service.GetLatestReleaseAsync("beta", CancellationToken.None);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(payload));

        Assert.That(document.RootElement.GetProperty("versionComparisonKnown").GetBoolean(), Is.True);
        Assert.That(document.RootElement.GetProperty("versionRelation").GetString(), Is.EqualTo("older"));
        Assert.That(document.RootElement.GetProperty("updateAvailable").GetBoolean(), Is.False);
        Assert.That(document.RootElement.GetProperty("downloadAllowed").GetBoolean(), Is.False);
        Assert.That(document.RootElement.GetProperty("installerUrl").GetString(), Is.Empty);
        Assert.That(document.RootElement.GetProperty("macUrl").GetString(), Is.Empty);
        var assets = document.RootElement.GetProperty("assets");
        Assert.That(assets[0].GetProperty("DownloadUrl").GetString(), Is.Empty);
        Assert.That(assets[0].GetProperty("Sha256Url").GetString(), Is.Empty);
        Assert.That(assets[0].GetProperty("SignatureUrl").GetString(), Is.Empty);
    }

    [Test]
    public void TryParseReleaseVersion_OrdersReleaseCandidateBeforeStable()
    {
        Assert.That(ReleaseService.TryParseReleaseVersion("0.3.0-rc.1", out var releaseCandidate), Is.True);
        Assert.That(ReleaseService.TryParseReleaseVersion("0.3.0", out var stable), Is.True);
        Assert.That(releaseCandidate, Is.LessThan(stable));
    }

    [TestCase("beta")]
    [TestCase("nightly")]
    public async Task GetLatestReleaseAsync_DoesNotFallBackAcrossChannels(string channel)
    {
        const string releases = """
            [{
              "tag_name": "v0.3.0",
              "html_url": "https://example.test/releases/v0.3.0",
              "prerelease": false,
              "assets": []
            }]
            """;
        using var client = new HttpClient(new StaticResponseHandler(releases));
        var service = new ReleaseService(client, "0.2.0");

        var payload = await service.GetLatestReleaseAsync(channel, CancellationToken.None);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(payload));

        Assert.That(document.RootElement.GetProperty("status").GetString(), Is.EqualTo("error"));
        Assert.That(document.RootElement.GetProperty("installerUrl").GetString(), Is.Empty);
        Assert.That(document.RootElement.GetProperty("trust").GetProperty("verificationStatus").GetString(), Is.EqualTo("missing"));
        Assert.That(document.RootElement.GetProperty("trust").GetProperty("trusted").GetBoolean(), Is.False);
    }

    [Test]
    public async Task GetLatestReleaseAsync_BetaBuildDefaultsToBetaAndSelectsNewestIndependentOfOrder()
    {
        const string releases = """
            [
              { "tag_name": "v0.3.0-beta.1", "prerelease": true, "assets": [] },
              { "tag_name": "v0.3.0-rc.1", "prerelease": true, "assets": [] },
              { "tag_name": "v0.3.0-beta.2", "prerelease": true, "assets": [] }
            ]
            """;
        using var client = new HttpClient(new StaticResponseHandler(releases));
        var service = new ReleaseService(client, "0.3.0-beta.1");

        var payload = await service.GetLatestReleaseAsync("stable", CancellationToken.None);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(payload));

        Assert.That(document.RootElement.GetProperty("channel").GetString(), Is.EqualTo("beta"));
        Assert.That(document.RootElement.GetProperty("latestVersion").GetString(), Is.EqualTo("v0.3.0-rc.1"));
        Assert.That(document.RootElement.GetProperty("updateAvailable").GetBoolean(), Is.True);
    }

    [Test]
    public async Task GetLatestReleaseAsync_SidecarPresenceIsAvailableButNotVerified()
    {
        const string release = """
            [{
              "tag_name": "v0.3.0-beta.2",
              "prerelease": true,
              "assets": [
                { "name": "Auxora-Setup-0.3.0-beta.2-build.exe", "browser_download_url": "https://example.test/setup.exe", "size": 10 },
                { "name": "Auxora-Setup-0.3.0-beta.2-build.exe.sha256", "browser_download_url": "https://example.test/setup.exe.sha256", "size": 64 },
                { "name": "Auxora-Setup-0.3.0-beta.2-build.exe.sig", "browser_download_url": "https://example.test/setup.exe.sig", "size": 64 }
              ]
            }]
            """;
        using var client = new HttpClient(new StaticResponseHandler(release));
        var service = new ReleaseService(client, "0.3.0-beta.1");

        var payload = await service.GetLatestReleaseAsync("beta", CancellationToken.None);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(payload));
        var root = document.RootElement;

        Assert.That(root.GetProperty("hashStatus").GetString(), Is.EqualTo("available"));
        Assert.That(root.GetProperty("signatureStatus").GetString(), Is.EqualTo("available"));
        Assert.That(root.GetProperty("trust").GetProperty("verificationStatus").GetString(), Is.EqualTo("not-verified"));
        Assert.That(root.GetProperty("trust").GetProperty("trusted").GetBoolean(), Is.False);
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
