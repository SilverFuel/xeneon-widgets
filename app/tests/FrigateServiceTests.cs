using System.Net;
using System.Net.Http.Headers;
using System.Diagnostics;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class FrigateServiceTests
{
    private string _tempDirectory = "";
    private HostLogger? _logger;

    [SetUp]
    public void SetUp()
    {
        _tempDirectory = Path.Combine(Path.GetTempPath(), $"auxora-frigate-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_tempDirectory);
        _logger = new HostLogger(Path.Combine(_tempDirectory, "logs"));
    }

    [TearDown]
    public void TearDown()
    {
        _logger?.Dispose();
        try { Directory.Delete(_tempDirectory, recursive: true); } catch { }
    }

    [Test]
    public void NormalizeLocalHttpBaseUrl_AllowsPrivateHttpAndPreservesBasePath()
    {
        var normalized = NetworkEndpointGuard.NormalizeLocalHttpBaseUrl(
            "http://192.168.1.50:5000/frigate",
            "Frigate address");

        Assert.That(normalized, Is.EqualTo("http://192.168.1.50:5000/frigate/"));
    }

    [TestCase("https://example.com/")]
    [TestCase("http://93.184.216.34:5000/")]
    public void NormalizeLocalHttpBaseUrl_RejectsPublicDestinations(string address)
    {
        Action action = () => NetworkEndpointGuard.NormalizeLocalHttpBaseUrl(address, "Frigate address");
        var error = Assert.Throws<InvalidOperationException>(action);

        Assert.That(error!.Message, Does.Contain("local/private"));
    }

    [Test]
    public void NormalizeLocalHttpBaseUrl_RejectsCredentialsAndQueryStrings()
    {
        Action credentialsAction = () => NetworkEndpointGuard.NormalizeLocalHttpBaseUrl(
            "http://user:pass@192.168.1.50:5000/",
            "Frigate address");
        Action queryAction = () => NetworkEndpointGuard.NormalizeLocalHttpBaseUrl(
            "http://192.168.1.50:5000/?token=secret",
            "Frigate address");
        Assert.That(
            Assert.Throws<InvalidOperationException>(credentialsAction)!.Message,
            Does.Contain("credentials"));
        Assert.That(
            Assert.Throws<InvalidOperationException>(queryAction)!.Message,
            Does.Contain("query"));
    }

    [Test]
    public void LocalConnectionBoundary_RejectsDnsRebindingBeforeConnectorRuns()
    {
        var connectorCalls = 0;

        async ValueTask<Stream> Connector(IPAddress _, int __, CancellationToken ___)
        {
            connectorCalls++;
            await Task.Yield();
            return new MemoryStream();
        }

        Func<Task> action = async () =>
            await NetworkEndpointGuard.ConnectLocalHttpHostAsync(
                "frigate.local",
                5000,
                CancellationToken.None,
                (_, _) => Task.FromResult(new[] { IPAddress.Parse("93.184.216.34") }),
                Connector);
        var error = Assert.ThrowsAsync<InvalidOperationException>(action);

        Assert.That(error!.Message, Does.Contain("outside the local/private network"));
        Assert.That(connectorCalls, Is.Zero);
    }

    [Test]
    public void ProductionFrigateHandler_DisablesRedirectsAndProxyAndUsesGuardedConnector()
    {
        using var handler = BridgeManager.CreateFrigateHttpHandler();

        Action assertions = () =>
        {
            Assert.That(handler.AllowAutoRedirect, Is.False);
            Assert.That(handler.UseProxy, Is.False);
            Assert.That(handler.UseCookies, Is.True);
            Assert.That(handler.CookieContainer, Is.Not.Null);
            Assert.That(handler.ConnectCallback, Is.Not.Null);
            Assert.That(handler.ConnectCallback!.Method.Name, Is.EqualTo(nameof(NetworkEndpointGuard.ConnectLocalHttpAsync)));
        };
        Assert.Multiple(assertions);
    }

    [Test]
    public void ConfigController_PersistsOnlyValidatedLocalFrigateSettingsAndSupportsRemoval()
    {
        var store = new ConfigStore(_logger!, Path.Combine(_tempDirectory, "config"));
        var steam = new SteamService(_logger!);
        var provisioning = new ProvisioningService(store, steam, _logger!);
        var runtimeClearCalls = 0;
        var controller = new ConfigController(store, provisioning, null, () => runtimeClearCalls++);

        controller.UpdateFrigate(new FrigateConfigRequest
        {
            BaseUrl = "https://192.168.1.50:8971/frigate",
            Camera = "front_door",
            Username = "viewer",
            Password = "correct horse battery staple"
        });
        var configured = store.Snapshot().Frigate;

        Action configuredAssertions = () =>
        {
            Assert.That(configured.BaseUrl, Is.EqualTo("https://192.168.1.50:8971/frigate/"));
            Assert.That(configured.Camera, Is.EqualTo("front_door"));
            Assert.That(configured.Username, Is.EqualTo("viewer"));
            Assert.That(configured.Password, Is.EqualTo("correct horse battery staple"));
        };
        Assert.Multiple(configuredAssertions);
        var diskConfig = File.ReadAllText(Path.Combine(_tempDirectory, "config", "config.json"));
        Assert.That(diskConfig, Does.Not.Contain("correct horse battery staple"));
        var reloaded = new ConfigStore(_logger!, Path.Combine(_tempDirectory, "config")).Snapshot().Frigate;
        Assert.That(reloaded.Password, Is.EqualTo("correct horse battery staple"));

        controller.UpdateFrigate(new FrigateConfigRequest
        {
            BaseUrl = configured.BaseUrl,
            Camera = "garage",
            Username = "viewer",
            Password = ""
        });
        Assert.That(store.Snapshot().Frigate.Password, Is.EqualTo("correct horse battery staple"));

        Action changedEndpointWithoutPassword = () =>
        {
            controller.UpdateFrigate(new FrigateConfigRequest
            {
                BaseUrl = "https://192.168.1.51:8971/",
                Camera = "garage",
                Username = "viewer",
                Password = ""
            });
        };
        Assert.Throws<InvalidOperationException>(changedEndpointWithoutPassword);
        Action publicAddressAction = () => controller.UpdateFrigate(new FrigateConfigRequest
        {
            BaseUrl = "https://example.com/",
            Camera = "front_door"
        });
        Assert.Throws<InvalidOperationException>(publicAddressAction);

        Action insecureAuthenticationAction = () => controller.UpdateFrigate(new FrigateConfigRequest
        {
            BaseUrl = "http://192.168.1.50:5000/",
            Camera = "front_door",
            Username = "viewer",
            Password = "must-not-cross-http"
        });
        Assert.That(
            Assert.Throws<InvalidOperationException>(insecureAuthenticationAction)!.Message,
            Does.Contain("require HTTPS"));

        controller.UpdateFrigate(new FrigateConfigRequest { BaseUrl = "", Camera = "ignored" });
        var removed = store.Snapshot().Frigate;
        Action removedAssertions = () =>
        {
            Assert.That(removed.BaseUrl, Is.Empty);
            Assert.That(removed.Camera, Is.Empty);
            Assert.That(removed.Username, Is.Empty);
            Assert.That(removed.Password, Is.Empty);
        };
        Assert.Multiple(removedAssertions);
        Assert.That(runtimeClearCalls, Is.EqualTo(3), "Every successful Camera Detection mutation must clear cached runtime credentials and detections.");
    }

    [Test]
    public async Task ClearSensitiveState_DropsTokenCacheDetectionCacheAndConnectionReceipt()
    {
        var loginCount = 0;
        var eventsCount = 0;
        var handler = new RecordingHandler(request =>
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/api/login", StringComparison.Ordinal))
            {
                loginCount++;
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent($"{{\"token\":\"jwt-{loginCount}\"}}")
                };
            }

            eventsCount++;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[]")
            };
        });
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);
        var config = Configured("https://192.168.1.50:8971/", "");
        config.Frigate.Username = "viewer";
        config.Frigate.Password = "a strong local password";

        await service.GetSnapshotAsync(config, new Uri("http://127.0.0.1:8976/"), CancellationToken.None);
        Assert.That(service.GetConnectionStatus(config).State, Is.EqualTo("Ready"));

        service.ClearSensitiveState();

        Assert.That(service.GetConnectionStatus(config).State, Is.EqualTo("Configured"));
        await service.GetSnapshotAsync(config, new Uri("http://127.0.0.1:8976/"), CancellationToken.None);
        Assert.Multiple((Action)(() =>
        {
            Assert.That(loginCount, Is.EqualTo(2), "The prior Frigate bearer token remained reusable after sensitive-state clearing.");
            Assert.That(eventsCount, Is.EqualTo(2), "The prior Camera Detection payload cache remained reusable after sensitive-state clearing.");
        }));
    }

    [Test]
    public async Task ClearSensitiveState_CancelsInFlightAuthenticationWithoutBlockingConfigMutation()
    {
        var handler = new BlockingFirstLoginHandler();
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);
        var config = Configured("https://192.168.1.50:8971/", "");
        config.Frigate.Username = "viewer";
        config.Frigate.Password = "a strong local password";
        var staleRequest = service.GetSnapshotAsync(
            config,
            new Uri("http://127.0.0.1:8976/"),
            CancellationToken.None);
        await handler.FirstLoginStarted.WaitAsync(TimeSpan.FromSeconds(2));

        var stopwatch = Stopwatch.StartNew();
        service.ClearSensitiveState();
        stopwatch.Stop();

        Func<Task> staleAction = async () => await staleRequest;
        var staleError = Assert.ThrowsAsync<InvalidOperationException>(staleAction);
        Assert.That(stopwatch.Elapsed, Is.LessThan(TimeSpan.FromSeconds(1)), "Clearing saved Camera Detection state waited for the old network timeout.");
        Assert.That(staleError!.Message, Does.Contain("settings changed"));
        Assert.That(handler.FirstLoginCancelled, Is.True, "The request using the old credentials was not cancelled.");
        Assert.That(service.GetConnectionStatus(config).State, Is.EqualTo("Configured"));

        var fresh = await service.GetSnapshotAsync(
            config,
            new Uri("http://127.0.0.1:8976/"),
            CancellationToken.None);
        Assert.That(fresh.Status, Is.EqualTo("live"));
        Assert.That(handler.LoginCount, Is.EqualTo(2), "A new request reused authentication from before the clear.");
        Assert.That(handler.EventsCount, Is.EqualTo(1));
    }

    [Test]
    public async Task Events_MapsOfficialFrigatePayloadAndUsesLocalSnapshotProxy()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000d;
        var json = $$"""
            [
              {
                "id": "{{now.ToString(System.Globalization.CultureInfo.InvariantCulture)}}-abc",
                "label": "person",
                "camera": "driveway",
                "start_time": {{now.ToString(System.Globalization.CultureInfo.InvariantCulture)}},
                "end_time": null,
                "false_positive": false,
                "zones": ["front_yard"],
                "has_snapshot": true,
                "data": { "score": 0.94 }
              }
            ]
            """;
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json)
        });
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);
        var config = Configured("http://192.168.1.50:5000/frigate/", "driveway");

        var payload = await service.GetSnapshotAsync(
            config,
            new Uri("http://127.0.0.1:8976/"),
            CancellationToken.None);

        Action mappingAssertions = () =>
        {
            Assert.That(payload.Configured, Is.True);
            Assert.That(payload.Status, Is.EqualTo("live"));
            Assert.That(payload.Alerts, Has.Count.EqualTo(1));
            Assert.That(payload.LastDetection!.Label, Is.EqualTo("person"));
            Assert.That(payload.LastDetection.Camera, Is.EqualTo("driveway"));
            Assert.That(payload.LastDetection.Zone, Is.EqualTo("front_yard"));
            Assert.That(payload.LastDetection.Score, Is.EqualTo(0.94).Within(0.001));
            Assert.That(payload.SnapshotUrl, Does.StartWith("http://127.0.0.1:8976/api/frigate/snapshot?id="));
            Assert.That(handler.LastRequestUri!.AbsolutePath, Is.EqualTo("/frigate/api/events"));
            Assert.That(handler.LastRequestUri.Query, Does.Contain("camera=driveway"));
            Assert.That(handler.LastRequestUri.Query, Does.Contain("has_snapshot=1"));
        };
        Assert.Multiple(mappingAssertions);
    }

    [Test]
    public async Task Events_SkipsMalformedTimestampWithoutFailingTheFeed()
    {
        const string json = """
            [{
              "id": "bad-time",
              "label": "person",
              "camera": "driveway",
              "start_time": 1e300,
              "false_positive": false,
              "has_snapshot": true
            }]
            """;
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json)
        });
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);

        var payload = await service.GetSnapshotAsync(
            Configured("http://192.168.1.50:5000/", ""),
            new Uri("http://127.0.0.1:8976/"),
            CancellationToken.None);

        Assert.That(payload.Alerts, Is.Empty);
        Assert.That(payload.Status, Is.EqualTo("live"));
    }

    [Test]
    public async Task Events_EnforcesConfiguredCameraAndOneHourWindowLocally()
    {
        var now = DateTimeOffset.UtcNow;
        var current = now.ToUnixTimeMilliseconds() / 1000d;
        var stale = now.AddHours(-2).ToUnixTimeMilliseconds() / 1000d;
        var future = now.AddMinutes(10).ToUnixTimeMilliseconds() / 1000d;
        var json = $$"""
            [
              { "id": "current-driveway", "label": "person", "camera": "driveway", "start_time": {{current.ToString(System.Globalization.CultureInfo.InvariantCulture)}}, "has_snapshot": true },
              { "id": "wrong-camera", "label": "car", "camera": "backyard", "start_time": {{current.ToString(System.Globalization.CultureInfo.InvariantCulture)}}, "has_snapshot": true },
              { "id": "stale-driveway", "label": "dog", "camera": "driveway", "start_time": {{stale.ToString(System.Globalization.CultureInfo.InvariantCulture)}}, "has_snapshot": true },
              { "id": "future-driveway", "label": "cat", "camera": "driveway", "start_time": {{future.ToString(System.Globalization.CultureInfo.InvariantCulture)}}, "has_snapshot": true },
              { "id": "missing-snapshot", "label": "bird", "camera": "driveway", "start_time": {{current.ToString(System.Globalization.CultureInfo.InvariantCulture)}} }
            ]
            """;
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json)
        });
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);

        var payload = await service.GetSnapshotAsync(
            Configured("http://192.168.1.50:5000/", "driveway"),
            new Uri("http://127.0.0.1:8976/"),
            CancellationToken.None);

        Assert.That(payload.Alerts.Select(entry => entry.Id), Is.EqualTo(new[] { "current-driveway", "missing-snapshot" }));
        Assert.That(payload.Counts.LastHour, Is.EqualTo(2));
        Assert.That(payload.SnapshotUrl, Does.EndWith("id=current-driveway"));
        Assert.That(payload.Alerts.Single(entry => entry.Id == "missing-snapshot").HasSnapshot, Is.False);
    }

    [Test]
    public async Task Events_AuthenticatesWithFrigateAndUsesReturnedBearerToken()
    {
        var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath.EndsWith("/api/login", StringComparison.Ordinal)
            ? new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"access_token\":\"jwt-viewer-token\"}")
            }
            : new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[]")
            });
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);
        var config = Configured("https://192.168.1.50:8971/", "");
        config.Frigate.Username = "viewer";
        config.Frigate.Password = "a strong local password";

        var payload = await service.GetSnapshotAsync(
            config,
            new Uri("http://127.0.0.1:8976/"),
            CancellationToken.None);

        Assert.That(payload.Status, Is.EqualTo("live"));
        Assert.That(handler.Requests, Has.Count.EqualTo(2));
        Assert.That(handler.Requests[0].Path, Is.EqualTo("/api/login"));
        Assert.That(handler.Requests[0].Body, Does.Contain("\"user\":\"viewer\""));
        Assert.That(handler.Requests[1].Path, Is.EqualTo("/api/events"));
        Assert.That(handler.Requests[1].Authorization, Is.EqualTo("Bearer jwt-viewer-token"));
    }

    [Test]
    public async Task Events_ReauthenticatesOnceWhenFrigateTokenExpires()
    {
        var loginCount = 0;
        var eventCount = 0;
        var handler = new RecordingHandler(request =>
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/api/login", StringComparison.Ordinal))
            {
                loginCount++;
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent($"{{\"token\":\"jwt-{loginCount}\"}}")
                };
            }

            eventCount++;
            return eventCount == 1
                ? new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new StringContent("unauthorized") }
                : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("[]") };
        });
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);
        var config = Configured("https://192.168.1.50:8971/", "");
        config.Frigate.Username = "viewer";
        config.Frigate.Password = "a strong local password";

        var payload = await service.GetSnapshotAsync(
            config,
            new Uri("http://127.0.0.1:8976/"),
            CancellationToken.None);

        Assert.That(payload.Status, Is.EqualTo("live"));
        Assert.That(loginCount, Is.EqualTo(2));
        Assert.That(eventCount, Is.EqualTo(2));
        Assert.That(handler.Requests[^1].Authorization, Is.EqualTo("Bearer jwt-2"));
    }

    [Test]
    public async Task ConcurrentExpiredRequests_ShareOneTokenRenewal()
    {
        var handler = new ConcurrentExpiredTokenHandler();
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);
        var config = Configured("https://192.168.1.50:8971/", "");
        config.Frigate.Username = "viewer";
        config.Frigate.Password = "a strong local password";

        await service.GetSnapshotAsync(
            config,
            new Uri("http://127.0.0.1:8976/"),
            CancellationToken.None);
        handler.ArmExpiry();

        var payloads = await Task.WhenAll(
            service.GetSnapshotAsync(config, new Uri("http://127.0.0.1:8977/"), CancellationToken.None),
            service.GetSnapshotAsync(config, new Uri("http://127.0.0.1:8978/"), CancellationToken.None));

        Assert.That(payloads.All(payload => payload.Status == "live"), Is.True);
        Assert.That(handler.UnauthorizedCount, Is.EqualTo(2));
        Assert.That(handler.LoginCount, Is.EqualTo(2), "Both expired requests must share one renewal login.");
        Assert.That(handler.RetryAuthorizations, Is.EqualTo(new[] { "Bearer jwt-2", "Bearer jwt-2" }));
    }

    [Test]
    public void Events_RejectsSuccessfulAuthenticationWithoutToken()
    {
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{}")
        });
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);
        var config = Configured("https://192.168.1.50:8971/", "");
        config.Frigate.Username = "viewer";
        config.Frigate.Password = "a strong local password";

        Func<Task> action = async () => await service.GetSnapshotAsync(
            config,
            new Uri("http://127.0.0.1:8976/"),
            CancellationToken.None);

        Assert.That(Assert.ThrowsAsync<InvalidOperationException>(action)!.Message, Does.Contain("usable token"));
        Assert.That(handler.RequestCount, Is.EqualTo(1));
    }

    [Test]
    public async Task ConnectionTest_ReportsReadyAfterAuthenticatedEventsRequest()
    {
        var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath.EndsWith("/api/login", StringComparison.Ordinal)
            ? new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"access_token\":\"connection-test-token\"}")
            }
            : new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[]")
            });
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);
        var config = Configured("https://192.168.1.50:8971/", "garage");
        config.Frigate.Username = "viewer";
        config.Frigate.Password = "a strong local password";

        var before = service.GetConnectionStatus(config);
        var status = await service.TestConnectionAsync(
            config,
            new Uri("http://127.0.0.1:8976/"),
            CancellationToken.None);

        Assert.That(before.State, Is.EqualTo("Configured"));
        Assert.That(before.Connected, Is.False);
        Assert.That(status.State, Is.EqualTo("Ready"));
        Assert.That(status.Connected, Is.True);
        Assert.That(status.Authenticated, Is.True);
        Assert.That(status.SampledAt, Is.Not.Null);
    }

    [Test]
    public async Task ConnectionTest_PreservesSettingsAndReportsRejectedCredentials()
    {
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized)
        {
            Content = new StringContent("unauthorized")
        });
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);
        var config = Configured("https://192.168.1.50:8971/", "garage");
        config.Frigate.Username = "viewer";
        config.Frigate.Password = "wrong password";

        var status = await service.TestConnectionAsync(
            config,
            new Uri("http://127.0.0.1:8976/"),
            CancellationToken.None);

        Assert.That(status.Configured, Is.True);
        Assert.That(status.Connected, Is.False);
        Assert.That(status.State, Is.EqualTo("Needs Setup"));
        Assert.That(status.Message, Does.Contain("rejected"));
        Assert.That(config.Frigate.BaseUrl, Is.EqualTo("https://192.168.1.50:8971/"));
        Assert.That(config.Frigate.Password, Is.EqualTo("wrong password"));
    }

    [Test]
    public async Task EventSnapshot_ProxiesOnlyBoundedSupportedImages()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000d;
        var eventId = $"{now.ToString(System.Globalization.CultureInfo.InvariantCulture)}-abc";
        var eventsJson = $$"""
            [{ "id": "{{eventId}}", "label": "person", "camera": "driveway", "start_time": {{now.ToString(System.Globalization.CultureInfo.InvariantCulture)}}, "has_snapshot": true }]
            """;
        var bytes = new byte[] { 0xff, 0xd8, 0xff, 0xd9 };
        var handler = new RecordingHandler(request =>
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/api/events", StringComparison.Ordinal))
            {
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(eventsJson)
                };
            }

            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(bytes)
            };
            response.Content.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
            return response;
        });
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);

        var asset = await service.GetEventSnapshotAsync(
            Configured("http://192.168.1.50:5000/", "driveway"),
            new Uri("http://127.0.0.1:8976/"),
            eventId,
            CancellationToken.None);

        Action snapshotAssertions = () =>
        {
            Assert.That(asset.ContentType, Is.EqualTo("image/jpeg"));
            Assert.That(asset.Content, Is.EqualTo(bytes));
            Assert.That(handler.LastRequestUri!.AbsolutePath, Is.EqualTo($"/api/events/{eventId}/snapshot.jpg"));
            Assert.That(handler.RequestCount, Is.EqualTo(2));
        };
        Assert.Multiple(snapshotAssertions);
    }

    [Test]
    public void EventSnapshot_ConvertsTransportFailuresToSafeUserError()
    {
        var handler = new RecordingHandler(_ => throw new HttpRequestException("test transport failure"));
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);

        Func<Task> action = async () => await service.GetEventSnapshotAsync(
            Configured("http://192.168.1.50:5000/", "driveway"),
            new Uri("http://127.0.0.1:8976/"),
            "event-id",
            CancellationToken.None);

        var error = Assert.ThrowsAsync<InvalidOperationException>(action);
        Assert.Multiple((Action)(() =>
        {
            Assert.That(error!.Message, Is.EqualTo("Frigate could not be reached."));
            Assert.That(error.InnerException, Is.TypeOf<HttpRequestException>());
            Assert.That(handler.RequestCount, Is.EqualTo(3));
        }));
    }

    [Test]
    public void EventSnapshot_RejectsEventOutsideCurrentFilteredResults()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000d;
        var json = $$"""
            [{ "id": "backyard-event", "label": "person", "camera": "backyard", "start_time": {{now.ToString(System.Globalization.CultureInfo.InvariantCulture)}}, "has_snapshot": true }]
            """;
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json)
        });
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);

        Func<Task> action = async () => await service.GetEventSnapshotAsync(
            Configured("http://192.168.1.50:5000/", "driveway"),
            new Uri("http://127.0.0.1:8976/"),
            "backyard-event",
            CancellationToken.None);

        Assert.That(Assert.ThrowsAsync<FrigateSnapshotUnavailableException>(action)!.Message, Does.Contain("filtered"));
        Assert.That(handler.RequestCount, Is.EqualTo(1));
        Assert.That(handler.LastRequestUri!.AbsolutePath, Is.EqualTo("/api/events"));
    }

    [TestCase("../config")]
    [TestCase("event/child")]
    [TestCase("")]
    public void EventSnapshot_RejectsInvalidEventIdsBeforeNetworkAccess(string eventId)
    {
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
        using var client = new HttpClient(handler);
        var service = new FrigateService(client, _logger!);

        Func<Task> action = async () => await service.GetEventSnapshotAsync(
            Configured("http://192.168.1.50:5000/", ""),
            new Uri("http://127.0.0.1:8976/"),
            eventId,
            CancellationToken.None);
        Assert.ThrowsAsync<FrigateSnapshotUnavailableException>(action);
        Assert.That(handler.RequestCount, Is.Zero);
    }

    private static AppConfig Configured(string baseUrl, string camera)
    {
        return new AppConfig
        {
            Frigate = new FrigateConfig
            {
                BaseUrl = baseUrl,
                Camera = camera
            }
        };
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _responseFactory;

        public RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> responseFactory)
        {
            _responseFactory = responseFactory;
        }

        public int RequestCount { get; private set; }

        public Uri? LastRequestUri { get; private set; }

        public List<(string Path, string Authorization, string Body)> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            LastRequestUri = request.RequestUri;
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            Requests.Add((
                request.RequestUri?.AbsolutePath ?? "",
                request.Headers.Authorization?.ToString() ?? "",
                body));
            return _responseFactory(request);
        }
    }

    private sealed class ConcurrentExpiredTokenHandler : HttpMessageHandler
    {
        private readonly TaskCompletionSource _bothExpired = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly object _sync = new();
        private readonly List<string> _retryAuthorizations = [];
        private int _expiryArmed;
        private int _loginCount;
        private int _unauthorizedCount;

        public int LoginCount => Volatile.Read(ref _loginCount);

        public int UnauthorizedCount => Volatile.Read(ref _unauthorizedCount);

        public IReadOnlyList<string> RetryAuthorizations
        {
            get
            {
                lock (_sync)
                {
                    return _retryAuthorizations.ToArray();
                }
            }
        }

        public void ArmExpiry()
        {
            Volatile.Write(ref _expiryArmed, 1);
        }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/api/login", StringComparison.Ordinal))
            {
                var login = Interlocked.Increment(ref _loginCount);
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent($"{{\"token\":\"jwt-{login}\"}}")
                };
            }

            var authorization = request.Headers.Authorization?.ToString() ?? "";
            if (Volatile.Read(ref _expiryArmed) == 1
                && authorization.Equals("Bearer jwt-1", StringComparison.Ordinal))
            {
                if (Interlocked.Increment(ref _unauthorizedCount) == 2)
                {
                    _bothExpired.TrySetResult();
                }

                await _bothExpired.Task.WaitAsync(cancellationToken);
                return new HttpResponseMessage(HttpStatusCode.Unauthorized)
                {
                    Content = new StringContent("expired")
                };
            }

            if (Volatile.Read(ref _expiryArmed) == 1)
            {
                lock (_sync)
                {
                    _retryAuthorizations.Add(authorization);
                }
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[]")
            };
        }
    }

    private sealed class BlockingFirstLoginHandler : HttpMessageHandler
    {
        private readonly TaskCompletionSource _firstLoginStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _firstLoginCancelled;
        private int _loginCount;
        private int _eventsCount;

        public Task FirstLoginStarted => _firstLoginStarted.Task;

        public bool FirstLoginCancelled => Volatile.Read(ref _firstLoginCancelled) == 1;

        public int LoginCount => Volatile.Read(ref _loginCount);

        public int EventsCount => Volatile.Read(ref _eventsCount);

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/api/login", StringComparison.Ordinal))
            {
                var login = Interlocked.Increment(ref _loginCount);
                if (login == 1)
                {
                    _firstLoginStarted.TrySetResult();
                    try
                    {
                        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                    }
                    catch (OperationCanceledException)
                    {
                        Volatile.Write(ref _firstLoginCancelled, 1);
                        throw;
                    }
                }

                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent($"{{\"token\":\"jwt-{login}\"}}")
                };
            }

            Interlocked.Increment(ref _eventsCount);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[]")
            };
        }
    }
}
