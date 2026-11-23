using NUnit.Framework;

namespace XenonEdgeHost.Tests;

[TestFixture]
public sealed class MediaServiceTests
{
    [Test]
    public void ResolveArtworkContentType_UsesJpegSignatureInsteadOfMalformedWindowsValue()
    {
        var content = new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10 };

        var result = MediaService.ResolveArtworkContentType(
            "image/jpeg,image/jpe,image/jpg",
            content);

        Assert.That(result, Is.EqualTo("image/jpeg"));
    }

    [Test]
    public void ResolveArtworkContentType_RecognizesPngSignature()
    {
        var content = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };

        var result = MediaService.ResolveArtworkContentType("application/octet-stream", content);

        Assert.That(result, Is.EqualTo("image/png"));
    }

    [Test]
    public void ResolveArtworkContentType_RejectsUnsafeOrAmbiguousReportedValue()
    {
        var result = MediaService.ResolveArtworkContentType(
            "image/jpeg,text/html",
            new byte[] { 0x00, 0x01, 0x02, 0x03 });

        Assert.That(result, Is.EqualTo("image/png"));
    }

    [Test]
    public void IndexOfApp_FindsAppleMusicAmongOtherSessions()
    {
        var sessions = new[] { "MSEdge", "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App", "Spotify.exe" };

        Assert.That(MediaService.IndexOfApp(sessions, "apple-music"), Is.EqualTo(1));
    }

    [Test]
    public void IndexOfApp_IsMinusOneWhenTheAppHasNoSessionOrTheNameIsUnknown()
    {
        var sessions = new[] { "MSEdge", "Spotify.exe", "" };

        Assert.That(MediaService.IndexOfApp(sessions, "apple-music"), Is.EqualTo(-1));
        Assert.That(MediaService.IndexOfApp(new[] { "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App" }, "spotify"), Is.EqualTo(-1));
        Assert.That(MediaService.IndexOfApp(Array.Empty<string>(), "apple-music"), Is.EqualTo(-1));
    }

    [Test]
    public void IsAppAction_AllowsPlayPauseAndSkippingAndNothingElse()
    {
        Assert.That(MediaService.IsAppAction("play-pause"), Is.True);
        Assert.That(MediaService.IsAppAction("next"), Is.True);
        Assert.That(MediaService.IsAppAction("previous"), Is.True);
        Assert.That(MediaService.IsAppAction("stop"), Is.False);
        Assert.That(MediaService.IsAppAction("Next"), Is.False);
        Assert.That(MediaService.IsAppAction(""), Is.False);
        Assert.That(MediaService.IsAppAction(null), Is.False);
    }
}
