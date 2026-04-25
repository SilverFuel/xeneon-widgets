using Windows.ApplicationModel.DataTransfer;

namespace XenonEdgeHost;

public sealed class ClipboardHistoryService
{
    private readonly HostLogger _logger;

    public ClipboardHistoryService(HostLogger logger)
    {
        _logger = logger;
    }

    public Task<ClipboardHistorySnapshot> GetSnapshotAsync(CancellationToken cancellationToken = default)
    {
        return UiDispatcher.InvokeAsync(() => BuildSnapshotAsync(cancellationToken));
    }

    public Task<ClipboardHistorySnapshot> CopyItemAsync(string? id, CancellationToken cancellationToken = default)
    {
        return UiDispatcher.InvokeAsync(async () =>
        {
            cancellationToken.ThrowIfCancellationRequested();

            var result = await Clipboard.GetHistoryItemsAsync();
            if (result.Status != ClipboardHistoryItemsResultStatus.Success)
            {
                return CreateStatusSnapshot(result.Status);
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

            return await BuildSnapshotAsync(cancellationToken);
        });
    }

    private async Task<ClipboardHistorySnapshot> BuildSnapshotAsync(CancellationToken cancellationToken)
    {
        try
        {
            var result = await Clipboard.GetHistoryItemsAsync();
            if (result.Status != ClipboardHistoryItemsResultStatus.Success)
            {
                return CreateStatusSnapshot(result.Status);
            }

            var entries = new List<ClipboardHistoryEntryPayload>();
            foreach (var item in result.Items.Take(12))
            {
                cancellationToken.ThrowIfCancellationRequested();
                entries.Add(await BuildEntryAsync(item));
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
                Entries = []
            };
        }
    }

    private static ClipboardHistorySnapshot CreateStatusSnapshot(ClipboardHistoryItemsResultStatus status)
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
                Entries = []
            },
            ClipboardHistoryItemsResultStatus.ClipboardHistoryDisabled => new ClipboardHistorySnapshot
            {
                Supported = true,
                Configured = false,
                Status = "setup",
                Message = "Clipboard history is disabled in Windows.",
                Source = "windows clipboard history",
                Entries = []
            },
            _ => new ClipboardHistorySnapshot
            {
                Supported = true,
                Configured = false,
                Status = "error",
                Message = "Clipboard history is unavailable.",
                Source = "windows clipboard history",
                Entries = []
            }
        };
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

public sealed class ClipboardHistorySnapshot
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; }

    public string Status { get; set; } = "setup";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public string Source { get; set; } = "windows clipboard history";

    public List<ClipboardHistoryEntryPayload> Entries { get; set; } = [];
}

public sealed class ClipboardHistoryEntryPayload
{
    public string Id { get; set; } = "";

    public string Kind { get; set; } = "";

    public string Label { get; set; } = "";

    public string Preview { get; set; } = "";

    public bool CanCopy { get; set; }
}
