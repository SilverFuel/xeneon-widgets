using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class ClipboardHistoryServiceTests
{
    private string _root = "";
    private HostLogger? _logger;

    [SetUp]
    public void SetUp()
    {
        _root = Path.Combine(Path.GetTempPath(), "auxora-clipboard-tests-" + Guid.NewGuid().ToString("N"));
        _logger = new HostLogger(Path.Combine(_root, "logs"));
    }

    [Test]
    public void GetHealthStatus_DoesNotEnumerateClipboardContents()
    {
        var service = new ClipboardHistoryService(_logger!);

        var status = service.GetHealthStatus(new ClipboardPrivacyOptions
        {
            HidePreviews = true,
            WidgetPaused = false,
            ExcludeFromDiagnostics = true
        });

        Assert.That(status.Status, Is.EqualTo("available"));
        Assert.That(status.Entries, Is.Empty);
        Assert.That(status.Configured, Is.False);
        Assert.That(status.Message, Does.Contain("never read clipboard contents").IgnoreCase);
    }

    [Test]
    public void GetHealthStatus_HonorsPausedPrivacyWithoutReadingClipboard()
    {
        var service = new ClipboardHistoryService(_logger!);

        var status = service.GetHealthStatus(new ClipboardPrivacyOptions { WidgetPaused = true });

        Assert.That(status.Status, Is.EqualTo("paused"));
        Assert.That(status.Privacy.WidgetPaused, Is.True);
        Assert.That(status.Entries, Is.Empty);
    }

    [TearDown]
    public void TearDown()
    {
        _logger?.Dispose();
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }
}
