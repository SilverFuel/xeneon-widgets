using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class HostLoggerTests
{
    private string _root = "";
    private HostLogger _logger = null!;

    [SetUp]
    public void SetUp()
    {
        _root = Directory.CreateTempSubdirectory("auxora-hostlogger-").FullName;
        _logger = new HostLogger(_root);
    }

    [TearDown]
    public void TearDown()
    {
        _logger.Dispose();
        Directory.Delete(_root, recursive: true);
    }

    [TestCase(false)]
    [TestCase(true)]
    public void ReadRecentLines_MissingOrEmptyLogReturnsAnEmptySnapshot(bool createEmptyFile)
    {
        if (createEmptyFile)
        {
            File.WriteAllText(_logger.LogPath, "");
        }

        Assert.That(_logger.ReadRecentLines(120), Is.Empty);
    }

    [TestCase(int.MinValue, 1)]
    [TestCase(0, 1)]
    [TestCase(1, 1)]
    [TestCase(3, 3)]
    [TestCase(120, 120)]
    [TestCase(int.MaxValue, 500)]
    public void ReadRecentLines_ReturnsAnOrderedBoundedTail(int requested, int expectedCount)
    {
        var lines = Enumerable.Range(0, 600).Select(index => $"LINE_{index:D4}").ToArray();
        File.WriteAllLines(_logger.LogPath, lines);

        var snapshot = _logger.ReadRecentLines(requested);

        Assert.That(snapshot, Is.EqualTo(lines.TakeLast(expectedCount)));
    }

    [Test]
    public void ReturnedSnapshot_KeepsNoReadHandleAndDoesNotLoseTheNextReceipt()
    {
        _logger.Info("BEFORE_SNAPSHOT");
        var snapshot = _logger.ReadRecentLines(120);

        // No file handle escapes the snapshot: an exclusive handle is available
        // immediately after it returns, without waiting or timing a race.
        using (File.Open(_logger.LogPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
        }
        _logger.Info("AFTER_SNAPSHOT");

        Assert.That(snapshot.Length, Is.EqualTo(1));
        Assert.That(snapshot[0], Does.EndWith("BEFORE_SNAPSHOT"));
        Assert.That(_logger.ReadRecentLines(120).Select(line => line.Split("[INFO] ")[1]),
            Is.EqualTo(new[] { "BEFORE_SNAPSHOT", "AFTER_SNAPSHOT" }));
    }

    [Test]
    public async Task ConcurrentSupportStyleSnapshots_DoNotDropAnyWrites()
    {
        const int writes = 240;
        using var phase = new Barrier(3);
        void Meet()
        {
            Assert.That(phase.SignalAndWait(TimeSpan.FromSeconds(10)), Is.True,
                "managed test participants must reach the same phase");
        }

        var writer = Task.Factory.StartNew(() =>
        {
            for (var index = 0; index < writes; index++)
            {
                Meet();
                _logger.Info($"WRITE_{index:D4}");
                Meet();
            }
        }, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        var readers = Enumerable.Range(0, 2).Select(readerIndex => Task.Factory.StartNew(() =>
        {
            for (var index = 0; index < writes; index++)
            {
                Meet();
                var snapshot = _logger.ReadRecentLines(120);
                Assert.That(snapshot.Length, Is.LessThanOrEqualTo(120));
                Assert.That(snapshot.All(line => line.Contains("[INFO] WRITE_", StringComparison.Ordinal)), Is.True);
                Meet();
            }
        }, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default)).ToArray();

        await Task.WhenAll(readers.Append(writer)).WaitAsync(TimeSpan.FromSeconds(30));

        var retained = _logger.ReadRecentLines(500);
        Assert.That(retained.Length, Is.EqualTo(writes));
        for (var index = 0; index < writes; index++)
        {
            Assert.That(retained[index], Does.EndWith($"WRITE_{index:D4}"));
        }
    }

    [Test]
    public void WriteTimeTrimming_PreservesTheNewestFiveHundredLines()
    {
        var lines = Enumerable.Range(0, 600)
            .Select(index => $"TRIM_{index:D4}:" + new string('x', 1024)).ToArray();
        File.WriteAllLines(_logger.LogPath, lines);
        Assert.That(new FileInfo(_logger.LogPath).Length, Is.GreaterThan(512 * 1024));

        _logger.Info("LATEST_RECEIPT");

        var retained = File.ReadAllLines(_logger.LogPath);
        Assert.That(retained.Length, Is.EqualTo(500));
        Assert.That(retained[0], Is.EqualTo(lines[101]));
        Assert.That(retained[^1], Does.EndWith("LATEST_RECEIPT"));
        Assert.That(_logger.ReadRecentLines(120), Is.EqualTo(retained.TakeLast(120)));
    }

    [Test]
    public void ConstructorTrimming_PreservesTheExistingFiveHundredLineBound()
    {
        var lines = Enumerable.Range(0, 600)
            .Select(index => $"TRIM_{index:D4}:" + new string('x', 1024)).ToArray();
        File.WriteAllLines(_logger.LogPath, lines);
        using var reopened = new HostLogger(_root);

        Assert.That(File.ReadAllLines(_logger.LogPath), Is.EqualTo(lines.TakeLast(500)));
        Assert.That(reopened.ReadRecentLines(int.MaxValue), Is.EqualTo(lines.TakeLast(500)));
    }

    [Test]
    public void UnreadableLog_ReturnsEmptyAndReleasesSnapshotOwnership()
    {
        _logger.Info("BEFORE_EXCLUSIVE_OWNER");
        using (File.Open(_logger.LogPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            Assert.That(_logger.ReadRecentLines(120), Is.Empty);
        }

        _logger.Info("AFTER_EXCLUSIVE_OWNER");
        var snapshot = _logger.ReadRecentLines(120);
        Assert.That(snapshot.Length, Is.EqualTo(2));
        Assert.That(snapshot[^1], Does.EndWith("AFTER_EXCLUSIVE_OWNER"));
    }

    [Test]
    public void Clear_RemovesTheFileWithoutChangingAnAlreadyReturnedSnapshot()
    {
        _logger.Info("BEFORE_CLEAR");
        var snapshot = _logger.ReadRecentLines(120);

        _logger.Clear();

        Assert.That(File.Exists(_logger.LogPath), Is.False);
        Assert.That(_logger.ReadRecentLines(120), Is.Empty);
        Assert.That(snapshot.Single(), Does.EndWith("BEFORE_CLEAR"));
        _logger.Info("AFTER_CLEAR");
        Assert.That(_logger.ReadRecentLines(120).Single(), Does.EndWith("AFTER_CLEAR"));
    }

    [Test]
    public void SupportSnapshot_StillSanitizesEveryReturnedLine()
    {
        var config = new AppConfig();
        config.Weather.City = "Fixture City";
        config.Frigate.Password = "fixture-password";
        _logger.Info(@"C:\Users\FixtureUser\dashboard test@example.test 192.168.1.22 token=fixture-token");
        _logger.Info("Fixture City fixture-password");
        // Only the log path is exercised: unrelated native health/configuration
        // services are neither constructed nor called by this managed test.
        var support = new SupportController(_logger, null!, null!, null!, null!, "managed-test");

        var snapshot = support.ReadRecentLogLines(120, config);
        var combined = string.Join("\n", snapshot);

        Assert.That(snapshot.Length, Is.EqualTo(2));
        foreach (var original in new[] { "FixtureUser", "test@example.test", "192.168.1.22", "fixture-token", "Fixture City", "fixture-password" })
        {
            Assert.That(combined, Does.Not.Contain(original));
        }
        foreach (var redacted in new[] { @"C:\Users\<user>", "<email>", "<local-ip>", "token=<redacted>", "<weather-location>", "<redacted>" })
        {
            Assert.That(combined, Does.Contain(redacted));
        }
        _logger.Info("AFTER_SANITIZED_SUPPORT_READ");
        Assert.That(_logger.ReadRecentLines(120)[^1], Does.EndWith("AFTER_SANITIZED_SUPPORT_READ"));
    }
}
