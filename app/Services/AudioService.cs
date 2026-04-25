using System.Diagnostics;
using Xeneon.Audio;

namespace XenonEdgeHost;

public sealed class AudioService
{
    private readonly HostLogger _logger;
    private readonly object _sync = new();
    private AudioSnapshotPayload _snapshot = AudioSnapshotPayload.CreateStarting();
    private DateTimeOffset _lastRefresh = DateTimeOffset.MinValue;

    public AudioService(HostLogger logger)
    {
        _logger = logger;
    }

    public Task<AudioSnapshotPayload> GetSnapshotAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (DateTimeOffset.UtcNow - _lastRefresh > TimeSpan.FromSeconds(2))
        {
            RefreshSnapshot();
        }

        lock (_sync)
        {
            var clone = _snapshot.Clone();
            clone.Stale = clone.SampledAt is null || DateTimeOffset.UtcNow - clone.SampledAt.Value > TimeSpan.FromSeconds(8);
            if (clone.Status == "live" && clone.Stale)
            {
                clone.Status = "stale";
            }

            return Task.FromResult(clone);
        }
    }

    public Task<AudioSnapshotPayload> SetDefaultDeviceAsync(string? deviceId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(deviceId))
        {
            throw new InvalidOperationException("Audio device ID is required.");
        }

        AudioBridge.SetDefaultDevice(deviceId);
        RefreshSnapshot(force: true);
        return GetSnapshotAsync(cancellationToken);
    }

    public Task<AudioSnapshotPayload> SetMasterVolumeAsync(double volume, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var snapshot = GetSnapshotSync(force: true);
        AudioBridge.SetMasterVolume(snapshot.DefaultDeviceId, (float)(Clamp(volume, 0, 100) / 100d));
        RefreshSnapshot(force: true);
        return GetSnapshotAsync(cancellationToken);
    }

    public Task<AudioSnapshotPayload> SetMasterMuteAsync(bool muted, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var snapshot = GetSnapshotSync(force: true);
        AudioBridge.SetMasterMute(snapshot.DefaultDeviceId, muted);
        RefreshSnapshot(force: true);
        return GetSnapshotAsync(cancellationToken);
    }

    public Task<AudioSnapshotPayload> SetSessionVolumeAsync(string? sessionId, double volume, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(sessionId))
        {
            throw new InvalidOperationException("Audio session ID is required.");
        }

        var snapshot = GetSnapshotSync(force: true);
        AudioBridge.SetSessionVolume(snapshot.DefaultDeviceId, DecodeSessionToken(sessionId), (float)(Clamp(volume, 0, 100) / 100d));
        RefreshSnapshot(force: true);
        return GetSnapshotAsync(cancellationToken);
    }

    public Task<AudioSnapshotPayload> SetSessionMuteAsync(string? sessionId, bool muted, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(sessionId))
        {
            throw new InvalidOperationException("Audio session ID is required.");
        }

        var snapshot = GetSnapshotSync(force: true);
        AudioBridge.SetSessionMute(snapshot.DefaultDeviceId, DecodeSessionToken(sessionId), muted);
        RefreshSnapshot(force: true);
        return GetSnapshotAsync(cancellationToken);
    }

    private AudioSnapshotPayload GetSnapshotSync(bool force)
    {
        if (force || DateTimeOffset.UtcNow - _lastRefresh > TimeSpan.FromSeconds(2))
        {
            RefreshSnapshot(force: force);
        }

        lock (_sync)
        {
            return _snapshot.Clone();
        }
    }

    private void RefreshSnapshot(bool force = false)
    {
        if (!force && DateTimeOffset.UtcNow - _lastRefresh <= TimeSpan.FromSeconds(2))
        {
            return;
        }

        try
        {
            var raw = AudioBridge.GetSnapshot();
            var devices = raw.Devices
                .Where(device => device.IsDefault || string.Equals(device.State, "Active", StringComparison.OrdinalIgnoreCase))
                .Select(device => new AudioDevicePayload
                {
                    Id = device.Id ?? "",
                    Name = string.IsNullOrWhiteSpace(device.Name) ? device.Id ?? "Output" : device.Name,
                    State = device.State ?? "Unknown",
                    Availability = ResolveAvailability(device.State),
                    IsDefault = device.IsDefault,
                    Kind = ResolveOutputKind(device.Name)
                })
                .OrderBy(device => device.IsDefault ? 0 : 1)
                .ThenBy(device => device.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();

            var sessions = raw.Sessions
                .Where(session => !string.Equals(session.State, "Expired", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(session.Identifier))
                .Select(session => new AudioSessionPayload
                {
                    Id = EncodeSessionToken(session.Identifier),
                    Name = ResolveSessionLabel(session),
                    Detail = ResolveSessionDetail(session),
                    ProcessId = unchecked((int)session.ProcessId),
                    State = session.State ?? "Inactive",
                    Volume = Clamp(session.Volume, 0, 100),
                    Muted = session.Muted,
                    Active = string.Equals(session.State, "Active", StringComparison.OrdinalIgnoreCase),
                    System = session.IsSystemSounds
                })
                .OrderBy(session => session.Active ? 0 : 1)
                .ThenBy(session => session.System ? 0 : 1)
                .ThenBy(session => session.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();

            var snapshot = new AudioSnapshotPayload
            {
                Supported = true,
                Configured = devices.Count > 0,
                Status = "live",
                SampledAt = DateTimeOffset.UtcNow,
                Stale = false,
                Message = devices.Count > 0
                    ? "Native Windows Core Audio routing is live."
                    : "No active playback devices were detected.",
                DefaultDeviceId = raw.DefaultDeviceId ?? "",
                MasterVolume = Clamp(raw.MasterVolume, 0, 100),
                Muted = raw.Muted,
                Source = string.IsNullOrWhiteSpace(raw.Source) ? "windows core audio" : raw.Source,
                Devices = devices,
                Sessions = sessions,
                UpdatedAt = DateTimeOffset.UtcNow
            };

            lock (_sync)
            {
                _snapshot = snapshot;
                _lastRefresh = DateTimeOffset.UtcNow;
            }
        }
        catch (Exception error)
        {
            _logger.Error("Failed to refresh native audio snapshot.", error);
            lock (_sync)
            {
                _snapshot = _snapshot.SampledAt is null
                    ? AudioSnapshotPayload.CreateError(error.Message)
                    : _snapshot.WithError(error.Message);
                _lastRefresh = DateTimeOffset.UtcNow;
            }
        }
    }

    private static string ResolveAvailability(string? state)
    {
        return state switch
        {
            "Active" => "Available",
            "Unplugged" => "Unplugged",
            "Disabled" => "Disabled",
            _ => string.IsNullOrWhiteSpace(state) ? "Unknown" : state
        };
    }

    private static string ResolveOutputKind(string? friendlyName)
    {
        var value = (friendlyName ?? "").ToLowerInvariant();
        if (value.Contains("headset") || value.Contains("headphones") || value.Contains("earphone"))
        {
            return "headphones";
        }

        if (value.Contains("tv") || value.Contains("hdmi") || value.Contains("display") || value.Contains("nvidia"))
        {
            return "display";
        }

        if (value.Contains("digital output") || value.Contains("spdif") || value.Contains("optical"))
        {
            return "digital";
        }

        if (value.Contains("speaker"))
        {
            return "speaker";
        }

        return "output";
    }

    private static string ResolveSessionLabel(AudioSessionRecord session)
    {
        if (session.IsSystemSounds)
        {
            return "System Sounds";
        }

        if (!string.IsNullOrWhiteSpace(session.DisplayName))
        {
            return session.DisplayName.StartsWith("@%SystemRoot", StringComparison.OrdinalIgnoreCase)
                ? "Windows Audio"
                : session.DisplayName;
        }

        if (session.ProcessId > 0)
        {
            try
            {
                using var process = Process.GetProcessById(unchecked((int)session.ProcessId));
                if (!string.IsNullOrWhiteSpace(process.MainWindowTitle))
                {
                    return process.MainWindowTitle;
                }

                if (!string.IsNullOrWhiteSpace(process.ProcessName))
                {
                    return process.ProcessName;
                }
            }
            catch
            {
            }
        }

        return "Audio Session";
    }

    private static string ResolveSessionDetail(AudioSessionRecord session)
    {
        if (session.IsSystemSounds)
        {
            return "Windows notifications and shared system audio";
        }

        if (session.ProcessId > 0)
        {
            try
            {
                using var process = Process.GetProcessById(unchecked((int)session.ProcessId));
                if (!string.IsNullOrWhiteSpace(process.MainModule?.FileName))
                {
                    return process.MainModule.FileName;
                }
            }
            catch
            {
            }

            return $"PID {session.ProcessId}";
        }

        return string.IsNullOrWhiteSpace(session.State) ? "Inactive" : session.State;
    }

    private static string EncodeSessionToken(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "";
        }

        return Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(value))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private static string DecodeSessionToken(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "";
        }

        var base64 = value.Replace('-', '+').Replace('_', '/');
        switch (base64.Length % 4)
        {
            case 2:
                base64 += "==";
                break;
            case 3:
                base64 += "=";
                break;
        }

        return System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(base64));
    }

    private static int Clamp(double value, int min, int max)
    {
        return (int)Math.Round(Math.Clamp(value, min, max));
    }
}

public sealed class AudioSnapshotPayload
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; } = true;

    public string Status { get; set; } = "starting";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public string DefaultDeviceId { get; set; } = "";

    public int? MasterVolume { get; set; }

    public bool? Muted { get; set; }

    public string Source { get; set; } = "windows core audio";

    public List<AudioDevicePayload> Devices { get; set; } = new();

    public List<AudioSessionPayload> Sessions { get; set; } = new();

    public DateTimeOffset? UpdatedAt { get; set; }

    public AudioSnapshotPayload Clone()
    {
        return new AudioSnapshotPayload
        {
            Supported = Supported,
            Configured = Configured,
            Status = Status,
            SampledAt = SampledAt,
            Stale = Stale,
            Message = Message,
            DefaultDeviceId = DefaultDeviceId,
            MasterVolume = MasterVolume,
            Muted = Muted,
            Source = Source,
            Devices = Devices.Select(device => device.Clone()).ToList(),
            Sessions = Sessions.Select(session => session.Clone()).ToList(),
            UpdatedAt = UpdatedAt
        };
    }

    public AudioSnapshotPayload WithError(string message)
    {
        var clone = Clone();
        clone.Status = "stale";
        clone.Stale = true;
        clone.Message = message;
        return clone;
    }

    public static AudioSnapshotPayload CreateStarting()
    {
        return new AudioSnapshotPayload
        {
            Supported = true,
            Configured = false,
            Status = "starting",
            Message = "Enumerating playback devices..."
        };
    }

    public static AudioSnapshotPayload CreateError(string message)
    {
        return new AudioSnapshotPayload
        {
            Supported = true,
            Configured = false,
            Status = "error",
            Message = message
        };
    }
}

public sealed class AudioDevicePayload
{
    public string Id { get; set; } = "";

    public string Name { get; set; } = "";

    public string State { get; set; } = "";

    public string Availability { get; set; } = "";

    public bool IsDefault { get; set; }

    public string Kind { get; set; } = "output";

    public AudioDevicePayload Clone()
    {
        return new AudioDevicePayload
        {
            Id = Id,
            Name = Name,
            State = State,
            Availability = Availability,
            IsDefault = IsDefault,
            Kind = Kind
        };
    }
}

public sealed class AudioSessionPayload
{
    public string Id { get; set; } = "";

    public string Name { get; set; } = "";

    public string Detail { get; set; } = "";

    public int ProcessId { get; set; }

    public string State { get; set; } = "";

    public int Volume { get; set; }

    public bool Muted { get; set; }

    public bool Active { get; set; }

    public bool System { get; set; }

    public AudioSessionPayload Clone()
    {
        return new AudioSessionPayload
        {
            Id = Id,
            Name = Name,
            Detail = Detail,
            ProcessId = ProcessId,
            State = State,
            Volume = Volume,
            Muted = Muted,
            Active = Active,
            System = System
        };
    }
}
