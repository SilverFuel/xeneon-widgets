using NUnit.Framework;
using System.Net;
using System.Net.Http;

namespace XenonEdgeHost.Tests;

public sealed class CalendarServiceTests
{
    private string _tempDirectory = "";
    private HostLogger? _logger;

    [SetUp]
    public void SetUp()
    {
        _tempDirectory = Path.Combine(Path.GetTempPath(), $"auxora-calendar-tests-{Guid.NewGuid():N}");
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
    public void ParseIcs_ExpandsRecurringEventsAfterTheirOriginalStart()
    {
        const string ics = """
            BEGIN:VCALENDAR
            BEGIN:VEVENT
            UID:daily-check-in
            DTSTART:20260709T130000Z
            RRULE:FREQ=DAILY;COUNT=3
            SUMMARY:Daily check-in
            LOCATION:Desk
            END:VEVENT
            END:VCALENDAR
            """;

        var entries = CalendarService.ParseIcs(ics, new DateTimeOffset(2026, 7, 10, 8, 0, 0, TimeSpan.FromHours(-4)));

        Assert.That(entries, Has.Count.EqualTo(2));
        Assert.That(entries.Select(entry => entry.Title), Is.All.EqualTo("Daily check-in"));
        Assert.That(entries.Select(entry => entry.Detail), Is.All.EqualTo("Desk"));
    }

    [Test]
    public void NormalizeRemoteHttpUrl_RejectsPlainHttp()
    {
        Action action = () => NetworkEndpointGuard.NormalizeRemoteHttpUrl(
            "http://calendar.example/feed.ics",
            "Calendar ICS URL");
        var error = Assert.Throws<InvalidOperationException>(action);

        Assert.That(error!.Message, Does.Contain("HTTPS"));
    }

    [Test]
    public void NormalizeRemoteHttpUrl_ConvertsWebcalToHttps()
    {
        var normalized = NetworkEndpointGuard.NormalizeRemoteHttpUrl("webcal://calendar.example/feed.ics", "Calendar ICS URL");

        Assert.That(normalized, Is.EqualTo("https://calendar.example/feed.ics"));
    }

    [TestCase("127.0.0.1")]
    [TestCase("10.0.0.5")]
    [TestCase("169.254.169.254")]
    [TestCase("192.0.2.10")]
    [TestCase("224.0.0.1")]
    [TestCase("::1")]
    [TestCase("fc00::1")]
    [TestCase("fe80::1")]
    [TestCase("2001:db8::1")]
    public void PublicDestinationValidation_RejectsNonPublicResolvedAddresses(string address)
    {
        Func<Task> action = async () =>
            await NetworkEndpointGuard.ValidatePublicHttpsDestinationAsync(
                "https://calendar.example/feed.ics",
                "Calendar ICS URL",
                CancellationToken.None,
                (_, _) => Task.FromResult(new[] { IPAddress.Parse(address) }));
        var error = Assert.ThrowsAsync<InvalidOperationException>(action);

        Assert.That(error!.Message, Does.Contain("non-public"));
    }

    [Test]
    public async Task Fetch_RejectsRedirectToPrivateDestinationBeforeSecondRequest()
    {
        var handler = new SequenceHandler(_ => new HttpResponseMessage(HttpStatusCode.Redirect)
        {
            Headers = { Location = new Uri("https://127.0.0.1/private.ics") }
        });
        using var client = new HttpClient(handler);
        var service = CreateService(client, PublicResolver);

        var snapshot = await service.GetSnapshotAsync(Configured("https://calendar.example/feed.ics"), CancellationToken.None);

        Assert.That(snapshot.Status, Is.EqualTo("error"));
        Assert.That(snapshot.Message, Does.Contain("public"));
        Assert.That(handler.RequestCount, Is.EqualTo(1));
    }

    [Test]
    public async Task Fetch_AllowsValidPublicHttpsFeed()
    {
        const string ics = """
            BEGIN:VCALENDAR
            BEGIN:VEVENT
            UID:security-test
            DTSTART:20260718T130000Z
            SUMMARY:Public feed
            LOCATION:Desk
            END:VEVENT
            END:VCALENDAR
            """;
        var handler = new SequenceHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(ics)
        });
        using var client = new HttpClient(handler);
        var service = CreateService(client, PublicResolver);

        var snapshot = await service.GetSnapshotAsync(Configured("https://calendar.example/feed.ics"), CancellationToken.None);

        Assert.That(snapshot.Status, Is.EqualTo("live"));
        Assert.That(snapshot.Entries.Single().Title, Is.EqualTo("Public feed"));
        Assert.That(handler.RequestCount, Is.EqualTo(1));
    }

    [Test]
    public async Task Fetch_StopsAfterRedirectLimit()
    {
        var handler = new SequenceHandler(_ => new HttpResponseMessage(HttpStatusCode.Redirect)
        {
            Headers = { Location = new Uri("/next.ics", UriKind.Relative) }
        });
        using var client = new HttpClient(handler);
        var service = CreateService(client, PublicResolver);

        var snapshot = await service.GetSnapshotAsync(Configured("https://calendar.example/feed.ics"), CancellationToken.None);

        Assert.That(snapshot.Status, Is.EqualTo("error"));
        Assert.That(snapshot.Message, Does.Contain("redirect limit"));
        Assert.That(handler.RequestCount, Is.EqualTo(6));
    }

    [Test]
    public async Task ConnectionBoundary_RejectsDnsRebindingBeforeConnectorRuns()
    {
        var validationCalls = 0;
        var connectorCalls = 0;
        var validated = await NetworkEndpointGuard.ValidatePublicHttpsDestinationAsync(
            "https://calendar.example/feed.ics",
            "Calendar ICS URL",
            CancellationToken.None,
            (_, _) =>
            {
                validationCalls++;
                return Task.FromResult(new[] { IPAddress.Parse("93.184.216.34") });
            });

        async ValueTask<Stream> Connector(IPAddress _, int __, CancellationToken ___)
        {
            connectorCalls++;
            await Task.Yield();
            return new MemoryStream();
        }

        Func<Task> action = async () =>
            await NetworkEndpointGuard.ConnectPublicHttpsHostAsync(
                validated.Host,
                validated.Port,
                CancellationToken.None,
                (_, _) => Task.FromResult(new[] { IPAddress.Loopback }),
                Connector);
        var error = Assert.ThrowsAsync<InvalidOperationException>(action);

        Assert.That(error!.Message, Does.Contain("non-public"));
        Assert.That(validationCalls, Is.EqualTo(1));
        Assert.That(connectorCalls, Is.Zero);
    }

    [Test]
    public void ProductionCalendarHandler_DisablesRedirectsAndProxyAndUsesGuardedConnector()
    {
        using var handler = BridgeManager.CreateCalendarHttpHandler();

        Action assertions = () =>
        {
            Assert.That(handler.AllowAutoRedirect, Is.False);
            Assert.That(handler.UseProxy, Is.False);
            Assert.That(handler.ConnectCallback, Is.Not.Null);
            Assert.That(handler.ConnectCallback!.Method.Name, Is.EqualTo(nameof(NetworkEndpointGuard.ConnectPublicHttpsAsync)));
        };
        Assert.Multiple(assertions);
    }

    private CalendarService CreateService(
        HttpClient client,
        Func<string, CancellationToken, Task<IPAddress[]>> resolver)
    {
        return new CalendarService(client, _logger!, resolver);
    }

    private static AppConfig Configured(string url)
    {
        return new AppConfig { Calendar = new CalendarConfig { IcsUrl = url } };
    }

    private static Task<IPAddress[]> PublicResolver(string _, CancellationToken __)
    {
        return Task.FromResult(new[] { IPAddress.Parse("93.184.216.34") });
    }

    private sealed class SequenceHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _responseFactory;

        public SequenceHandler(Func<HttpRequestMessage, HttpResponseMessage> responseFactory)
        {
            _responseFactory = responseFactory;
        }

        public int RequestCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            return Task.FromResult(_responseFactory(request));
        }
    }
}
