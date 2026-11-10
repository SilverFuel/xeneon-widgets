using System.Drawing;
using System.Runtime.InteropServices;

namespace XenonEdgeHost;

// Keeps the Windows cursor where the user left it while the companion display
// is touched. The Xeneon Edge delivers a touch as plain, untagged mouse input
// that teleports the cursor, so it cannot be recognised or suppressed from the
// mouse hook alone, and WebView2's own pointer messages live in another
// process. Instead the dashboard page reports touch pointers (pointerType
// "touch") and a passive low-level hook records where the cursor was before the
// touch moved it; TouchCursorPolicy puts it back once the touch settles. The
// hook never swallows input.
internal sealed class TouchCursorGuard : IDisposable
{
    private const int WhMouseLowLevel = 14;
    private const int MaxRestoreLogs = 20;
    private static readonly TimeSpan TickInterval = TimeSpan.FromMilliseconds(30);
    private readonly HostLogger _logger;
    private readonly TouchCursorPolicy _policy = new();
    private readonly HookProc _callback;
    private readonly Timer _timer;
    private IntPtr _hook;
    private int _restoreLogs;
    private bool _disposed;

    internal TouchCursorGuard(HostLogger logger)
    {
        _logger = logger;
        _callback = HandleHook;
        _hook = SetWindowsHookEx(WhMouseLowLevel, _callback, GetModuleHandle(null), 0);
        if (_hook == IntPtr.Zero)
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Could not install the touch cursor guard.");
        }

        _timer = new Timer(_ => Tick(), null, TickInterval, TickInterval);
    }

    // Reported by the dashboard page for pointerType "touch" only.
    internal void NotifyTouch(bool down, int pointerId)
    {
        if (_disposed) return;
        var cursor = GetCursorPos(out var position) ? new Point(position.X, position.Y) : Point.Empty;
        _policy.OnTouch(down, pointerId, Environment.TickCount64, cursor);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Dispose();
        if (_hook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
        }
    }

    private IntPtr HandleHook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && !_disposed)
        {
            try
            {
                var data = Marshal.PtrToStructure<MouseHookData>(lParam);
                _policy.OnCursorMoved(new Point(data.X, data.Y), Environment.TickCount64);
            }
            catch (Exception error)
            {
                // No managed exception may cross the unmanaged hook boundary.
                try { _logger.Error("Touch cursor hook failed.", error); } catch { }
            }
        }

        return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    }

    private void Tick()
    {
        try
        {
            if (_disposed || !GetCursorPos(out var position)) return;
            if (_policy.Tick(Environment.TickCount64, new Point(position.X, position.Y)) is { } restore)
            {
                SetCursorPos(restore.X, restore.Y);
                // Windows keeps the cursor hidden after touch until it sees real
                // mouse movement, which SetCursorPos is not. A net-zero nudge
                // brings it back; the final SetCursorPos undoes any acceleration.
                NudgeMouse();
                SetCursorPos(restore.X, restore.Y);
                if (Interlocked.Increment(ref _restoreLogs) <= MaxRestoreLogs)
                {
                    _logger.Info("Touch moved the cursor; restored it to its position before the touch.");
                }
            }
        }
        catch (Exception error)
        {
            try { _logger.Error("Touch cursor restoration failed.", error); } catch { }
        }
    }

    private static void NudgeMouse()
    {
        // Best effort: if injection is refused the cursor is still back in
        // place, it may just stay hidden until the mouse moves.
        var inputs = new[] { RelativeMove(1), RelativeMove(-1) };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>());
    }

    private static Input RelativeMove(int dx) =>
        new() { Type = InputMouse, Mouse = new MouseInput { Dx = dx, Flags = MouseEventMove } };

    private const uint InputMouse = 0;
    private const uint MouseEventMove = 0x0001;

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int Dx;
        public int Dy;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public uint Type;
        public MouseInput Mouse;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] inputs, int size);

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseHookData
    {
        public int X;
        public int Y;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr SetWindowsHookEx(int hookId, HookProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? moduleName);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out NativePoint point);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetCursorPos(int x, int y);
}
