using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class ExtensionManifestServiceTests
{
    [Test]
    public void Snapshot_VerifiesSignedManifestButKeepsThirdPartyLoadingDisabled()
    {
        var root = Path.Combine(Path.GetTempPath(), $"auxora-extension-tests-{Guid.NewGuid():N}");
        var extension = Path.Combine(root, "example");
        var logs = Path.Combine(root, "logs");
        Directory.CreateDirectory(extension);
        var entrypointPath = Path.Combine(extension, "index.js");
        File.WriteAllText(entrypointPath, "export default {};\n");
        var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(entrypointPath)));
        const string keyId = "test-publisher";
        const string extensionId = "example";
        const string version = "1.0.0";
        const string entrypoint = "index.js";
        var permissions = new[] { "system.read" };

        using var rsa = RSA.Create(2048);
        var signedPayload = string.Join("\n", extensionId, version, entrypoint, string.Join(",", permissions), hash);
        var signature = Convert.ToBase64String(rsa.SignData(Encoding.UTF8.GetBytes(signedPayload), HashAlgorithmName.SHA256, RSASignaturePadding.Pss));
        File.WriteAllText(Path.Combine(extension, "auxora-extension.json"), JsonSerializer.Serialize(new
        {
            id = extensionId,
            name = "Example",
            version,
            entrypoint,
            publisherKeyId = keyId,
            contentSha256 = hash,
            signature,
            permissions
        }));
        var trustPath = Path.Combine(root, "trusted.json");
        File.WriteAllText(trustPath, JsonSerializer.Serialize(new
        {
            publishers = new[] { new { keyId, publicKeyPem = rsa.ExportSubjectPublicKeyInfoPem() } }
        }));
        using var logger = new HostLogger(logs);

        try
        {
            var service = new ExtensionManifestService(logger, root, trustPath);
            using var document = JsonDocument.Parse(JsonSerializer.Serialize(service.GetSnapshot()));
            var inspection = document.RootElement.GetProperty("extensions")[0];

            Assert.That(inspection.GetProperty("Verified").GetBoolean(), Is.True);
            Assert.That(inspection.GetProperty("Loadable").GetBoolean(), Is.False);
            Assert.That(document.RootElement.GetProperty("verifiedCount").GetInt32(), Is.EqualTo(1));
            Assert.That(document.RootElement.GetProperty("thirdPartyLoadingEnabled").GetBoolean(), Is.False);
            Assert.That(inspection.GetProperty("Message").GetString(), Does.Contain("Loading is disabled"));
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    [Test]
    public void Snapshot_RejectsUnknownPermissionsAndDoesNotClaimLoadingSupport()
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

            Assert.That(inspection.GetProperty("Verified").GetBoolean(), Is.False);
            Assert.That(inspection.GetProperty("Loadable").GetBoolean(), Is.False);
            Assert.That(inspection.GetProperty("Message").GetString(), Does.Contain("Unknown permissions"));
            Assert.That(document.RootElement.GetProperty("thirdPartyLoadingEnabled").GetBoolean(), Is.False);
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }
}
