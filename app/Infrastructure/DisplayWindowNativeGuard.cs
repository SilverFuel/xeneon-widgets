using System.ComponentModel;
using System.Drawing;
using System.Runtime.InteropServices;

namespace XenonEdgeHost;

// Owned by MainWindow's UI thread, independently of tray availability. Native
// position filtering runs before Windows commits visibility/geometry changes.
internal sealed class DisplayWindowNativeGuard : IDisposable
{
    private const uint WmDisplayChange = 0x007E;
    private const uint WmDpiChanged = 0x02E0;
    private const uint WmWindowPosChanging = 0x0046;
    private const uint SwpNoSize = 0x0001;
    private const uint SwpNoMove = 0x0002;
    private static readonly nuint SubclassId = 0x41555844;
    private readonly IntPtr _window;
    private readonly SubclassProc _callback;
    private readonly Action<uint> _topologyChanged;
    private readonly Action _unsafePlacement;
    private readonly HostLogger _logger;
    private Rectangle? _verifiedCompanion;
    private bool _locked = true;
    private bool _revealAuthorized;
    private bool _notifyingTopology;
    private bool _handlingFailure;
    private bool _disposed;
    private bool _attached;
    private int _placementDepth;

    internal DisplayWindowNativeGuard(IntPtr window, Action<uint> topologyChanged, Action unsafePlacement, HostLogger logger)
    {
        _window = window;
        _topologyChanged = topologyChanged;
        _unsafePlacement = unsafePlacement;
        _logger = logger;
        _callback = HandleMessage;
        if (!SetWindowSubclass(window, _callback, SubclassId, 0))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not install the companion-window safety guard.");
        }
        _attached = true;
    }

    internal bool IsAttached => _attached;

    internal void SetVerifiedTarget(DisplayTarget target, bool locked)
    {
        if (target.IsPrimary || target.Bounds.Width <= 0 || target.Bounds.Height <= 0)
        {
            throw new InvalidOperationException("The native window guard requires a verified companion display.");
        }
        _verifiedCompanion = target.Bounds;
        _locked = locked;
    }

    internal void InvalidateTarget() => _verifiedCompanion = null;

    internal IDisposable BeginPlacement()
    {
        _placementDepth++;
        return new PlacementScope(this);
    }

    internal void Reveal(Action reveal)
    {
        var previousAuthorization = _revealAuthorized;
        _revealAuthorized = true;
        try { reveal(); }
        finally { _revealAuthorized = previousAuthorization; }
    }

    public void Dispose()
    {
        _disposed = true;
        _verifiedCompanion = null;
        if (!_attached) return;
        if (RemoveWindowSubclass(_window, _callback, SubclassId) || !IsWindow(_window))
        {
            _attached = false;
        }
        else
        {
            _logger.Warn("The native display-window guard could not detach cleanly.");
        }
    }

    private IntPtr HandleMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, nuint subclassId, nuint referenceData)
    {
        try { return HandleMessageCore(window, message, wParam, lParam); }
        catch (Exception error)
        {
            // No managed exception may cross the unmanaged window procedure.
            _verifiedCompanion = null;
            try
            {
                if (message == WmWindowPosChanging && lParam != IntPtr.Zero)
                {
                    var position = Marshal.PtrToStructure<WindowPosition>(lParam);
                    position.Flags = DisplayWindowPlacementPolicy.HideAndRejectPosition(position.Flags);
                    Marshal.StructureToPtr(position, lParam, false);
                }
                else if (!_handlingFailure)
                {
                    _handlingFailure = true;
                    try { ShowWindow(window, 0); }
                    finally { _handlingFailure = false; }
                }
                _logger.Error("Native window guard failed closed.", error);
                _unsafePlacement();
            }
            catch { /* Preserve the unmanaged exception boundary even on shutdown. */ }
            return IntPtr.Zero;
        }
    }

    private IntPtr HandleMessageCore(IntPtr window, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (!_disposed && !_notifyingTopology && !_handlingFailure
            && DisplayWindowPlacementPolicy.IsTopologyNotification(message, _placementDepth > 0, IsWindowVisible(window)))
        {
            _verifiedCompanion = null;
            _notifyingTopology = true;
            try { _topologyChanged(message); }
            catch (Exception error) { _logger.Error("Native display-change handling failed.", error); }
            finally { _notifyingTopology = false; }
        }

        // Let WinUI/default processing normalize WINDOWPOS first. Filtering the
        // resulting structure here still happens before Windows applies it.
        var result = DefSubclassProc(window, message, wParam, lParam);
        if (!_disposed && !_handlingFailure && message == WmWindowPosChanging && lParam != IntPtr.Zero)
        {
            var position = Marshal.PtrToStructure<WindowPosition>(lParam);
            try
            {
                if (!GetWindowRect(window, out var current))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not read window geometry before placement.");
                }

                var proposed = new Rectangle(
                    (position.Flags & SwpNoMove) != 0 ? current.Left : position.X,
                    (position.Flags & SwpNoMove) != 0 ? current.Top : position.Y,
                    (position.Flags & SwpNoSize) != 0 ? current.Right - current.Left : position.Width,
                    (position.Flags & SwpNoSize) != 0 ? current.Bottom - current.Top : position.Height);
                position.Flags = DisplayWindowPlacementPolicy.FilterNativePositionFlags(
                    position.Flags, IsWindowVisible(window), _revealAuthorized, _placementDepth > 0,
                    _locked, proposed, _verifiedCompanion, out var needsRecovery);
                Marshal.StructureToPtr(position, lParam, false);
                if (needsRecovery)
                {
                    // MainWindow only queues recovery here; never enumerate
                    // displays or recursively hide inside a final reveal gate.
                    _unsafePlacement();
                }
            }
            catch (Exception error)
            {
                position.Flags = DisplayWindowPlacementPolicy.HideAndRejectPosition(position.Flags);
                Marshal.StructureToPtr(position, lParam, false);
                _logger.Error("Native window placement could not be verified; rejecting visibility.", error);
                _unsafePlacement();
            }
        }
        return result;
    }

    private sealed class PlacementScope(DisplayWindowNativeGuard owner) : IDisposable
    {
        private DisplayWindowNativeGuard? _owner = owner;
        public void Dispose()
        {
            if (_owner is null) return;
            _owner._placementDepth--;
            _owner = null;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WindowPosition
    {
        public IntPtr Window;
        public IntPtr InsertAfter;
        public int X;
        public int Y;
        public int Width;
        public int Height;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate IntPtr SubclassProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, nuint subclassId, nuint referenceData);

    [DllImport("comctl32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowSubclass(IntPtr window, SubclassProc callback, nuint subclassId, nuint referenceData);
    [DllImport("comctl32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RemoveWindowSubclass(IntPtr window, SubclassProc callback, nuint subclassId);
    [DllImport("comctl32.dll")]
    private static extern IntPtr DefSubclassProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr window, out NativeRect bounds);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);
}
