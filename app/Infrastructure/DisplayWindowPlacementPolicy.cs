using System.Drawing;

namespace XenonEdgeHost;

// Geometry guard for OS-initiated moves of an already visible, locked window.
// The caller resolves the configured identity against the current topology.
internal static class DisplayWindowPlacementPolicy
{
    private const uint NoSize = 0x0001;
    private const uint NoMove = 0x0002;
    private const uint ShowWindow = 0x0040;
    private const uint HideWindow = 0x0080;

    internal static long LockedWindowStyle(long style) => style & ~0x00C40000L; // CAPTION | THICKFRAME

    internal static long LockedExtendedStyle(long style)
        => (style | 0x08000080L) & ~0x00060301L; // NOACTIVATE | TOOLWINDOW; no APPWINDOW or frame edges

    internal static bool IsLockedPresentationApplied(bool positionApplied, long style, long extendedStyle)
        => positionApplied && style == LockedWindowStyle(style)
            && extendedStyle == LockedExtendedStyle(extendedStyle)
            && (extendedStyle & 0x00000008L) != 0; // TOPMOST must survive frame recalculation.

    internal static bool IsTopologyNotification(uint message, bool placementInProgress, bool visible)
        => message == 0x007E // WM_DISPLAYCHANGE is never caused by an app move.
            || (message == 0x02E0 && !placementInProgress && visible); // External WM_DPICHANGED.

    internal static uint FilterNativePositionFlags(uint flags, bool currentlyVisible, bool revealAuthorized,
        bool placementInProgress, bool locked, Rectangle proposed, Rectangle? verifiedCompanion,
        out bool needsRecovery)
    {
        needsRecovery = false;
        if ((flags & HideWindow) != 0) return flags & ~ShowWindow;
        var requestsShow = (flags & ShowWindow) != 0;
        if (!currentlyVisible && !requestsShow) return flags;

        var unsafeBounds = verifiedCompanion is null
            || ((locked || revealAuthorized) && !Contains(verifiedCompanion, proposed));
        var unauthorizedShow = requestsShow && !revealAuthorized;
        var intermediatePlacement = placementInProgress && !revealAuthorized;
        if (!unsafeBounds && !unauthorizedShow && !intermediatePlacement) return flags;

        needsRecovery = (!placementInProgress || revealAuthorized) && (unsafeBounds || unauthorizedShow);
        var hidden = (flags & ~ShowWindow) | HideWindow;
        return unsafeBounds && !placementInProgress ? hidden | NoMove | NoSize : hidden;
    }

    internal static uint HideAndRejectPosition(uint flags) => (flags & ~ShowWindow) | HideWindow | NoMove | NoSize;

    internal static bool IsContainedByCompanion(Rectangle window, DisplayTarget? activeTarget)
    {
        if (activeTarget is null || activeTarget.IsPrimary
            || window.Width <= 0 || window.Height <= 0
            || activeTarget.Bounds.Width <= 0 || activeTarget.Bounds.Height <= 0)
        {
            return false;
        }

        return Contains(activeTarget.Bounds, window);
    }

    private static bool Contains(Rectangle? companion, Rectangle window)
    {
        if (companion is not Rectangle bounds || window.Width <= 0 || window.Height <= 0
            || bounds.Width <= 0 || bounds.Height <= 0)
        {
            return false;
        }
        return window.X >= bounds.X && window.Y >= bounds.Y
            && (long)window.X + window.Width <= (long)bounds.X + bounds.Width
            && (long)window.Y + window.Height <= (long)bounds.Y + bounds.Height;
    }
}
