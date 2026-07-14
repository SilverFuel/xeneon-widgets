using NUnit.Framework;
using XenonEdgeHost;

namespace XenonEdgeHost.Tests;

public sealed class HardwareTemperatureProviderTests
{
    [Test]
    public void Read_DisablesProviderAfterInitializationFailureWithoutLoggingDetails()
    {
        var root = Path.Combine(Path.GetTempPath(), $"auxora-hardware-provider-{Guid.NewGuid():N}");
        var attempts = 0;

        try
        {
            using var logger = new HostLogger(root);
            using var provider = new HardwareTemperatureProvider(logger, () =>
            {
                attempts++;
                throw new InvalidOperationException("C:\\private\\sensor-path");
            });

            var first = provider.Read();
            var second = provider.Read();

            Assert.That(first, Is.EqualTo(HardwareTemperatureSnapshot.Empty));
            Assert.That(second, Is.EqualTo(HardwareTemperatureSnapshot.Empty));
            Assert.That(attempts, Is.EqualTo(1));
            Assert.That(File.ReadAllText(logger.LogPath), Does.Not.Contain("sensor-path"));
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    [Test]
    public void SelectPreferredTemperature_PrefersPackageSensorOverHotterCore()
    {
        var candidates = new[]
        {
            new TemperatureCandidate("CPU Core #1", 82.5),
            new TemperatureCandidate("CPU Package", 70.4)
        };

        var result = HardwareTemperatureProvider.SelectPreferredTemperature(candidates, "CPU Package", "Core");

        Assert.That(result, Is.EqualTo(70.4));
    }

    [Test]
    public void SelectPreferredTemperature_RejectsInvalidSensorValues()
    {
        var candidates = new[]
        {
            new TemperatureCandidate("CPU Package", 0),
            new TemperatureCandidate("CPU Core", 145)
        };

        var result = HardwareTemperatureProvider.SelectPreferredTemperature(candidates, "CPU Package");

        Assert.That(result, Is.Null);
    }
}
