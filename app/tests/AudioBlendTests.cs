using NUnit.Framework;

namespace XenonEdgeHost.Tests;

[TestFixture]
public sealed class AudioBlendTests
{
    [Test]
    public void VolumesAt_KeepsBothFullInTheMiddleAndFadesTheOtherTowardEachEnd()
    {
        Assert.That(AudioBlend.VolumesAt(50), Is.EqualTo((100, 100)));
        Assert.That(AudioBlend.VolumesAt(0), Is.EqualTo((100, 0)));
        Assert.That(AudioBlend.VolumesAt(100), Is.EqualTo((0, 100)));
        Assert.That(AudioBlend.VolumesAt(20), Is.EqualTo((100, 40)));
        Assert.That(AudioBlend.VolumesAt(75), Is.EqualTo((50, 100)));
    }

    [Test]
    public void VolumesAt_TreatsValuesOutOfRangeAsTheNearestEnd()
    {
        Assert.That(AudioBlend.VolumesAt(-30), Is.EqualTo((100, 0)));
        Assert.That(AudioBlend.VolumesAt(400), Is.EqualTo((0, 100)));
        Assert.That(AudioBlend.VolumesAt(double.NaN), Is.EqualTo((100, 100)));
    }

    [Test]
    public void PositionOf_IsTheInverseForVolumesTheSliderSet()
    {
        foreach (var position in new[] { 0, 10, 20, 35, 50, 65, 75, 90, 100 })
        {
            var volumes = AudioBlend.VolumesAt(position);

            Assert.That(AudioBlend.PositionOf(volumes.Game, volumes.Music), Is.EqualTo(position), $"position {position}");
        }
    }

    [Test]
    public void PositionOf_ReadsOnlyTheRatioOfVolumesSetElsewhere()
    {
        Assert.That(AudioBlend.PositionOf(80, 40), Is.EqualTo(25));
        Assert.That(AudioBlend.PositionOf(30, 60), Is.EqualTo(75));
        Assert.That(AudioBlend.PositionOf(60, 60), Is.EqualTo(50));
        Assert.That(AudioBlend.PositionOf(0, 0), Is.EqualTo(50));
    }

    [Test]
    public void RoleOf_FindsAppleMusicByProcessOrDisplayName()
    {
        Assert.That(AudioBlend.RoleOf("AppleMusic", "", 4100, 7200, "Wow"), Is.EqualTo(AudioBlend.Music));
        Assert.That(AudioBlend.RoleOf("applemusic.exe", "", 4100, null, ""), Is.EqualTo(AudioBlend.Music));
        Assert.That(AudioBlend.RoleOf("SomeHelper", "Apple Music", 4100, 7200, "Wow"), Is.EqualTo(AudioBlend.Music));
    }

    [Test]
    public void RoleOf_FindsTheGameByProcessIdOrProcessName()
    {
        Assert.That(AudioBlend.RoleOf("Wow", "", 7200, 7200, ""), Is.EqualTo(AudioBlend.Game));
        Assert.That(AudioBlend.RoleOf("wow", "", 9000, 7200, "Wow.exe"), Is.EqualTo(AudioBlend.Game));
        Assert.That(AudioBlend.RoleOf("bf6", "", 9000, null, "bf6"), Is.EqualTo(AudioBlend.Game));
    }

    [Test]
    public void RoleOf_LeavesEverythingElseOut()
    {
        Assert.That(AudioBlend.RoleOf("Discord", "", 3000, 7200, "Wow"), Is.EqualTo(""));
        Assert.That(AudioBlend.RoleOf("Spotify", "Spotify", 3000, null, ""), Is.EqualTo(""));
        Assert.That(AudioBlend.RoleOf("", "", 0, 0, ""), Is.EqualTo(""));
        Assert.That(AudioBlend.RoleOf(null, null, 3000, null, null), Is.EqualTo(""));
    }
}
