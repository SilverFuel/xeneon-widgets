using Windows.ApplicationModel.DataTransfer;

namespace XenonEdgeHost;

public sealed class ClipboardHistoryService
{
    private readonly HostLogger _logger;

    public ClipboardHistoryService(HostLogger logger)
    {
        _logger = logger;
    }

    public Task<ClipboardHistorySnapshot> GetSnapshotAsync(ClipboardPrivacyOptions? privacy = null, CancellationToken cancellationToken = default)
    {
        return UiDispatcher.InvokeAsync(() => BuildSnapshotAsync(privacy ?? ClipboardPrivacyOptions.Default, cancellationToken));
    }

    public Task<ClipboardHistorySnapshot> CopyItemAsync(string? id, ClipboardPrivacyOptions? privacy = null, CancellationToken cancellationToken = default)
    {
        return UiDispatcher.InvokeAsync(async () =>
        {
            var effectivePrivacy = privacy ?? ClipboardPrivacyOptions.Default;
            cancellationToken.ThrowIfCancellationRequested();

            if (effectivePrivacy.WidgetPaused)
            {
                throw new InvalidOperationException("Clipboard widget is paused.");
            }

            var result = await Clipboard.GetHistoryItemsAsync();
            if (result.Status != ClipboardHistoryItemsResultStatus.Success)
            {
                return CreateStatusSnapshot(result.Status, effectivePrivacy);
            }

            var item = result.Items.FirstOrDefault(entry =>
                string.Equals(entry.Id, id, StringComparison.OrdinalIgnoreCase));
            if (item is null)
            {
                throw new InvalidOperationException("Clipboard history item not found.");
            }

            var status = Clipboard.SetHistoryItemAsContent(item);
            if (status != SetHistoryItemAsContentStatus.Success)
            {
                throw new InvalidOperationException(status switch
                {
                    SetHistoryItemAsContentStatus.AccessDenied => "Clipboard access was denied.",
                    SetHistoryItemAsContentStatus.ItemDeleted => "That clipboard item is no longer available.",
                    _ => "Unable to restore the clipboard item."
                });
            }

            return await BuildSnapshotAsync(effectivePrivacy, cancellationToken);
        });
    }

    private async Task<ClipboardHistorySnapshot> BuildSnapshotAsync(ClipboardPrivacyOptions privacy, CancellationToken cancellationToken)
    {
        if (privacy.WidgetPaused)
        {
            return new ClipboardHistorySnapshot
            {
                Supported = true,
                Configured = true,
                Status = "paused",
                SampledAt = DateTimeOffset.UtcNow,
                Stale = false,
                Message = "Clipboard widget is paused.",
                Source = "windows clipboard history",
                Privacy = ClipboardPrivacyPayload.FromOptions(privacy),
                Entries = []
            };
        }

        try
        {
            var result = await Clipboard.GetHistoryItemsAsync();
            if (result.Status != ClipboardHistoryItemsResultStatus.Success)
            {
                return CreateStatusSnapshot(result.Status, privacy);
            }

            var entries = new List<ClipboardHistoryEntryPayload>();
            foreach (var item in result.Items.Take(12))
            {
                cancellationToken.ThrowIfCancellationRequested();
                entries.Add(ApplyPrivacy(await BuildEntryAsync(item), privacy));
            }

            return new ClipboardHistorySnapshot
            {
                Supported = true,
                Configured = true,
                Status = entries.Count > 0 ? "live" : "idle",
                SampledAt = DateTimeOffset.UtcNow,
                Stale = false,
                Message = entries.Count > 0
                    ? "Clipboard history is live."
                    : "Clipboard history is enabled but currently empty.",
                Source = "windows clipboard history",
                Privacy = ClipboardPrivacyPayload.FromOptions(privacy),
                Entries = entries
            };
        }
        catch (Exception error)
        {
            _logger.Error("Failed to read clipboard history.", error);
            return new ClipboardHistorySnapshot
            {
                Supported = true,
                Configured = false,
                Status = "error",
                SampledAt = DateTimeOffset.UtcNow,
                Stale = false,
                Message = error.Message,
                Source = "windows clipboard history",
                Privacy = ClipboardPrivacyPayload.FromOptions(privacy),
                Entries = []
            };
        }
    }

    private static ClipboardHistorySnapshot CreateStatusSnapshot(ClipboardHistoryItemsResultStatus status, ClipboardPrivacyOptions privacy)
    {
        return status switch
        {
            ClipboardHistoryItemsResultStatus.AccessDenied => new ClipboardHistorySnapshot
            {
                Supported = true,
                Configured = false,
                Status = "error",
                Message = "Clipboard history access is denied.",
                Source = "windows clipboard history",
                Privacy = ClipboardPrivacyPayload.FromOptions(privacy),
                Entries = []
            },
            ClipboardHistoryItemsResultStatus.ClipboardHistoryDisabled => new ClipboardHistorySnapshot
            {
                Supported = true,
                Configured = false,
                Status = "setup",
                Message = "Clipboard history is disabled in Windows.",
                Source = "windows clipboard history",
                Privacy = ClipboardPrivacyPayload.FromOptions(privacy),
                Entries = []
            },
            _ => new ClipboardHistorySnapshot
            {
                Supported = true,
                Configured = false,
                Status = "error",
                Message = "Clipboard history is unavailable.",
                Source = "windows clipboard history",
                Privacy = ClipboardPrivacyPayload.FromOptions(privacy),
                Entries = []
            }
        };
    }

    private static ClipboardHistoryEntryPayload ApplyPrivacy(ClipboardHistoryEntryPayload payload, ClipboardPrivacyOptions privacy)
    {
        if (privacy.HidePreviews)
        {
            payload.Preview = "Hidden by privacy mode";
            payload.PreviewHidden = true;
        }

        return payload;
    }

    private static async Task<ClipboardHistoryEntryPayload> BuildEntryAsync(ClipboardHistoryItem item)
    {
        var content = item.Content;
        var payload = new ClipboardHistoryEntryPayload
        {
            Id = item.Id,
            Kind = "unknown",
            Label = "Clipboard item",
            Preview = "Clipboard content",
            CanCopy = true
        };

        if (content.Contains(StandardDataFormats.Text))
        {
            var text = await content.GetTextAsync();
            payload.Kind = "text";
            payload.Label = "Text";
            payload.Preview = TruncatePreview(text);
            return payload;
        }

        if (content.Contains(StandardDataFormats.WebLink))
        {
            var link = await content.GetWebLinkAsync();
            payload.Kind = "link";
            payload.Label = "Web link";
            payload.Preview = TruncatePreview(link?.ToString() ?? "Web link");
            return payload;
        }

        if (content.Contains(StandardDataFormats.ApplicationLink))
        {
            var link = await content.GetApplicationLinkAsync();
            payload.Kind = "app-link";
            payload.Label = "App link";
            payload.Preview = TruncatePreview(link?.ToString() ?? "App link");
            return payload;
        }

        if (content.Contains(StandardDataFormats.StorageItems))
        {
            var items = await content.GetStorageItemsAsync();
            payload.Kind = "files";
            payload.Label = items.Count == 1 ? "File" : "Files";
            payload.Preview = items.Count == 0
                ? "File selection"
                : string.Join(", ", items.Take(3).Select(entry => entry.Name));
            return payload;
        }

        if (content.Contains(StandardDataFormats.Html))
        {
            payload.Kind = "html";
            payload.Label = "HTML";
            payload.Preview = "Formatted HTML content";
            return payload;
        }

        if (content.Contains(StandardDataFormats.Bitmap))
        {
            payload.Kind = "image";
            payload.Label = "Image";
            payload.Preview = "Bitmap image";
            return payload;
        }

        return payload;
    }

    private static string TruncatePreview(string? value)
    {
        var normalized = (value ?? "")
            .Replace("\r", " ", StringComparison.Ordinal)
            .Replace("\n", " ", StringComparison.Ordinal)
            .Trim();

        if (normalized.Length <= 160)
        {
            return string.IsNullOrWhiteSpace(normalized) ? "Text content" : normalized;
        }

        return normalized[..157] + "...";
    }
}

public sealed class ClipboardPrivacyOptions
{
    public static ClipboardPrivacyOptions Default { get; } = new()
    {
        HidePreviews = true,
        WidgetPaused = false,
        ExcludeFromDiagnostics = true
    };

    public bool HidePreviews { get; set; } = true;

    public bool WidgetPaused { get; set; }

    public bool ExcludeFromDiagnostics { get; set; } = true;

    public static ClipboardPrivacyOptions FromDashboard(DashboardConfig dashboard)
    {
        return new ClipboardPrivacyOptions
        {
            HidePreviews = dashboard.ClipboardHidePreviews,
            WidgetPaused = dashboard.ClipboardWidgetPaused,
            ExcludeFromDiagnostics = dashboard.ClipboardExcludeFromDiagnostics
        };
    }
}

public sealed class ClipboardPrivacyPayload
{
    public bool HidePreviews { get; set; }

    public bool WidgetPaused { get; set; }

    public bool ExcludeFromDiagnostics { get; set; }

    public static ClipboardPrivacyPayload FromOptions(ClipboardPrivacyOptions options)
    {
        return new ClipboardPrivacyPayload
        {
            HidePreviews = options.HidePreviews,
            WidgetPaused = options.WidgetPaused,
            ExcludeFromDiagnostics = options.ExcludeFromDiagnostics
        };
    }
}

public sealed class ClipboardHistorySnapshot
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; }

    public string Status { get; set; } = "setup";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public string Source { get; set; } = "windows clipboard history";

    public ClipboardPrivacyPayload Privacy { get; set; } = ClipboardPrivacyPayload.FromOptions(ClipboardPrivacyOptions.Default);

    public List<ClipboardHistoryEntryPayload> Entries { get; set; } = [];
}

public sealed class ClipboardHistoryEntryPayload
{
    public string Id { get; set; } = "";

    public string Kind { get; set; } = "";

    public string Label { get; set; } = "";

    public string Preview { get; set; } = "";

    public bool PreviewHidden { get; set; }

    public bool CanCopy { get; set; }
}
