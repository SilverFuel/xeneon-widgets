using System.Security.Cryptography;
using System.Text.Json;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class ExtensionManifestServiceTests
{
    [Test]
    public void Snapshot_RejectsUnknownPermissionsBeforeExtensionCanRun()
    {
        var root = Path.Combine(Path.GetTempPath(), $"auxora-extension-tests-{Guid.NewGuid():N}");
        var extension = Path.Combine(root, "example");
        var logs = Path.Combine(root, "logs");
        Directory.CreateDirectory(extension);
        File.WriteAllText(Path.Combine(extension, "index.js"), "export default {};\n");
        var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(Path.Combine(extension, "index.js"))));
        File.WriteAllText(Path.Combine(extension, "auxora-extension.json"), JsonSerializer.Serialize(new
        {
            id = "example",
            name = "Example",
            version = "1.0.0",
            entrypoint = "index.js",
            publisherKeyId = "missing",
            contentSha256 = hash,
            signature = "",
            permissions = new[] { "filesystem.unrestricted" }
        }));
        var trustPath = Path.Combine(root, "trusted.json");
        File.WriteAllText(trustPath, "{\"publishers\":[]}");
        using var logger = new HostLogger(logs);

        try
        {
            var service = new ExtensionManifestService(logger, root, trustPath);
            using var document = JsonDocument.Parse(JsonSerializer.Serialize(service.GetSnapshot()));
            var inspection = document.RootElement.GetProperty("extensions")[0];

            Assert.That(inspection.GetProperty("Runnable").GetBoolean(), Is.False);
            Assert.That(inspection.GetProperty("Message").GetString(), Does.Contain("Unknown permissions"));
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }
}
