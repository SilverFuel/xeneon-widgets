using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace XenonEdgeHost;

public sealed class SecretStore
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("XenonEdgeHost.SecretStore.v1");

    private readonly string _secretsPath;
    private readonly HostLogger _logger;
    private readonly object _sync = new();
    private Dictionary<string, string> _secrets;

    public SecretStore(string configDirectory, HostLogger logger)
    {
        _logger = logger;
        _secretsPath = Path.Combine(configDirectory, "protected-secrets.json");
        _secrets = Load();
    }

    public string Get(string key)
    {
        lock (_sync)
        {
            if (!_secrets.TryGetValue(key, out var protectedValue) || string.IsNullOrWhiteSpace(protectedValue))
            {
                return "";
            }

            try
            {
                var cipher = Convert.FromBase64String(protectedValue);
                var plain = ProtectedData.Unprotect(cipher, Entropy, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(plain);
            }
            catch (Exception error)
            {
                _logger.Warn($"Unable to read protected secret '{key}': {error.Message}");
                return "";
            }
        }
    }

    public void Set(string key, string? value)
    {
        lock (_sync)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                _secrets.Remove(key);
                Save();
                return;
            }

            try
            {
                var plain = Encoding.UTF8.GetBytes(value.Trim());
                var cipher = ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser);
                _secrets[key] = Convert.ToBase64String(cipher);
                Save();
            }
            catch (Exception error)
            {
                _logger.Error($"Unable to protect secret '{key}'.", error);
            }
        }
    }

    private Dictionary<string, string> Load()
    {
        try
        {
            if (!File.Exists(_secretsPath))
            {
                return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            }

            var json = File.ReadAllText(_secretsPath);
            return JsonSerializer.Deserialize<Dictionary<string, string>>(json, SerializerOptions)
                   ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception error)
        {
            _logger.Error("Failed to load protected secrets.", error);
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }
    }

    private void Save()
    {
        try
        {
            File.WriteAllText(_secretsPath, JsonSerializer.Serialize(_secrets, SerializerOptions));
        }
        catch (Exception error)
        {
            _logger.Error("Failed to save protected secrets.", error);
        }
    }
}
