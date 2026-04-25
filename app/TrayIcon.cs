using System.Runtime.InteropServices;

namespace XenonEdgeHost;

public sealed class TrayIcon : IDisposable
{
    private const int CallbackMessage = 0x8001;
    private const int CommandOpenSettings = 1001;
    private const int CommandShowDisplay = 1002;
    private const int CommandRestartServer = 1003;
    private const int CommandQuit = 1004;
    private const int CommandOpenLogs = 1005;
    private const int CommandResetDashboard = 1006;

    private readonly IntPtr _windowHandle;
    private readonly Action _onOpenSettings;
    private readonly Action _onRestartBridge;
    private readonly Action _onShowDisplay;
    private readonly Action _onOpenLogs;
    private readonly Action _onResetDashboard;
    private readonly Action _onQuit;
    private readonly HostLogger _logger;
    private readonly WndProcDelegate _windowProc;
    private readonly IntPtr _windowProcPointer;
    private readonly IntPtr _iconHandle;
    private readonly bool _ownsIconHandle;
    private IntPtr _previousWindowProc;
    private bool _disposed;

    public TrayIcon(
        IntPtr windowHandle,
        Action onOpenSettings,
        Action onRestartBridge,
        Action onShowDisplay,
        Action onOpenLogs,
        Action onResetDashboard,
        Action onQuit,
        HostLogger logger)
    {
        ArgumentNullException.ThrowIfNull(onOpenSettings);
        ArgumentNullException.ThrowIfNull(onRestartBridge);
        ArgumentNullException.ThrowIfNull(onShowDisplay);
        ArgumentNullException.ThrowIfNull(onOpenLogs);
        ArgumentNullException.ThrowIfNull(onResetDashboard);
        ArgumentNullException.ThrowIfNull(onQuit);
        ArgumentNullException.ThrowIfNull(logger);

        if (windowHandle == IntPtr.Zero)
        {
            throw new InvalidOperationException("A valid window handle is required for the tray icon.");
        }

        _windowHandle = windowHandle;
        _onOpenSettings = onOpenSettings;
        _onRestartBridge = onRestartBridge;
        _onShowDisplay = onShowDisplay;
        _onOpenLogs = onOpenLogs;
        _onResetDashboard = onResetDashboard;
        _onQuit = onQuit;
        _logger = logger;

        _windowProc = HandleWindowMessage;
        _windowProcPointer = Marshal.GetFunctionPointerForDelegate(_windowProc);
        _previousWindowProc = SetWindowLongPtr(_windowHandle, WindowLongIndexFlags.GWLP_WNDPROC, _windowProcPointer);
        if (_previousWindowProc == IntPtr.Zero)
        {
            var error = Marshal.GetLastWin32Error();
            throw new InvalidOperationException($"Failed to hook the window procedure for the tray icon (Win32 error {error}).");
        }

        (_iconHandle, _ownsIconHandle) = LoadApplicationIconHandle();
        if (_iconHandle == IntPtr.Zero)
        {
            RestoreWindowProc();
            throw new InvalidOperationException("Failed to load the application icon for the tray menu.");
        }

        var notifyData = CreateNotifyIconData();
        if (!Shell_NotifyIcon(NotifyCommand.Add, ref notifyData))
        {
            RestoreWindowProc();
            throw new InvalidOperationException("Failed to register the notification area icon.");
        }

        notifyData.Version = NotifyIconVersion4;
        Shell_NotifyIcon(NotifyCommand.SetVersion, ref notifyData);
        _logger.Info("Tray icon created.");
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        var notifyData = CreateNotifyIconData();
        Shell_NotifyIcon(NotifyCommand.Delete, ref notifyData);
        if (_ownsIconHandle && _iconHandle != IntPtr.Zero)
        {
            DestroyIcon(_iconHandle);
        }
        RestoreWindowProc();
        _logger.Info("Tray icon removed.");
    }

    private IntPtr HandleWindowMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (message == CallbackMessage)
        {
            switch (unchecked((uint) lParam.ToInt64()))
            {
                case WmLButtonDblClk:
                    _onShowDisplay();
                    return IntPtr.Zero;
                case WmRButtonUp:
                case WmContextMenu:
                    ShowContextMenu();
                    return IntPtr.Zero;
            }
        }
        else if (message == WmCommand)
        {
            var commandId = LowWord(wParam);
            switch (commandId)
            {
                case CommandOpenSettings:
                    _onOpenSettings();
                    return IntPtr.Zero;
                case CommandShowDisplay:
                    _onShowDisplay();
                    return IntPtr.Zero;
                case CommandRestartServer:
                    _onRestartBridge();
                    return IntPtr.Zero;
                case CommandOpenLogs:
                    _onOpenLogs();
                    return IntPtr.Zero;
                case CommandResetDashboard:
                    _onResetDashboard();
                    return IntPtr.Zero;
                case CommandQuit:
                    _onQuit();
                    return IntPtr.Zero;
            }
        }

        return CallWindowProc(_previousWindowProc, hWnd, message, wParam, lParam);
    }

    private void ShowContextMenu()
    {
        var menu = CreatePopupMenu();
        if (menu == IntPtr.Zero)
        {
            _logger.Warn("Unable to create the tray icon context menu.");
            return;
        }

        try
        {
            AppendMenu(menu, MenuFlags.String, CommandOpenSettings, "Open Settings");
            AppendMenu(menu, MenuFlags.String, CommandShowDisplay, "Show EDGE Window");
            AppendMenu(menu, MenuFlags.String, CommandRestartServer, "Restart Server");
            AppendMenu(menu, MenuFlags.String, CommandResetDashboard, "Reset Dashboard State");
            AppendMenu(menu, MenuFlags.String, CommandOpenLogs, "Open Logs");
            AppendMenu(menu, MenuFlags.Separator, 0, null);
            AppendMenu(menu, MenuFlags.String, CommandQuit, "Quit");

            GetCursorPos(out var point);
            SetForegroundWindow(_windowHandle);
            var command = TrackPopupMenu(
                menu,
                TrackPopupMenuFlags.LeftAlign | TrackPopupMenuFlags.RightButton | TrackPopupMenuFlags.ReturnCommand,
                point.X,
                point.Y,
                0,
                _windowHandle,
                IntPtr.Zero);

            if (command != 0)
            {
                PostMessage(_windowHandle, WmCommand, new IntPtr(command), IntPtr.Zero);
            }
        }
        finally
        {
            DestroyMenu(menu);
        }
    }

    private NOTIFYICONDATA CreateNotifyIconData()
    {
        return new NOTIFYICONDATA
        {
            cbSize = (uint) Marshal.SizeOf<NOTIFYICONDATA>(),
            hWnd = _windowHandle,
            uID = 1,
            uFlags = NotifyIconFlags.Message | NotifyIconFlags.Icon | NotifyIconFlags.Tip,
            uCallbackMessage = CallbackMessage,
            hIcon = _iconHandle,
            szTip = "Xenon Edge Host",
            Version = NotifyIconVersion4
        };
    }

    private void RestoreWindowProc()
    {
        if (_previousWindowProc == IntPtr.Zero)
        {
            return;
        }

        SetWindowLongPtr(_windowHandle, WindowLongIndexFlags.GWLP_WNDPROC, _previousWindowProc);
        _previousWindowProc = IntPtr.Zero;
    }

    private static int LowWord(IntPtr value)
    {
        return unchecked((short) (value.ToInt64() & 0xFFFF));
    }

    private static (IntPtr Handle, bool OwnsHandle) LoadApplicationIconHandle()
    {
        var processPath = Environment.ProcessPath;
        if (!string.IsNullOrWhiteSpace(processPath))
        {
            var iconCount = ExtractIconEx(processPath, 0, out var largeIcon, out var smallIcon, 1);
            if (iconCount > 0)
            {
                if (smallIcon != IntPtr.Zero)
                {
                    if (largeIcon != IntPtr.Zero)
                    {
                        DestroyIcon(largeIcon);
                    }

                    return (smallIcon, true);
                }

                if (largeIcon != IntPtr.Zero)
                {
                    return (largeIcon, true);
                }
            }
        }

        return (LoadIcon(IntPtr.Zero, new IntPtr(DefaultApplicationIconResource)), false);
    }

    private const int DefaultApplicationIconResource = 32512;
    private const int NotifyIconVersion4 = 4;
    private const uint WmCommand = 0x0111;
    private const uint WmContextMenu = 0x007B;
    private const uint WmLButtonDblClk = 0x0203;
    private const uint WmRButtonUp = 0x0205;

    [DllImport("shell32.dll", SetLastError = true)]
    private static extern bool Shell_NotifyIcon(NotifyCommand command, ref NOTIFYICONDATA data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool AppendMenu(IntPtr menu, MenuFlags flags, int newItemId, string? newItemText);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyMenu(IntPtr menu);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int TrackPopupMenu(
        IntPtr menu,
        TrackPopupMenuFlags flags,
        int x,
        int y,
        int reserved,
        IntPtr hWnd,
        IntPtr rect);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, WindowLongIndexFlags index, IntPtr newProc);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)]
    private static extern IntPtr SetWindowLong32(IntPtr hWnd, WindowLongIndexFlags index, IntPtr newProc);

    [DllImport("user32.dll", EntryPoint = "CallWindowProcW", SetLastError = true)]
    private static extern IntPtr CallWindowProc(IntPtr previousProc, IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr LoadIcon(IntPtr instance, IntPtr iconName);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint ExtractIconEx(string fileName, int iconIndex, out IntPtr largeIcon, out IntPtr smallIcon, uint iconCount);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr iconHandle);

    private static IntPtr SetWindowLongPtr(IntPtr hWnd, WindowLongIndexFlags index, IntPtr newProc)
    {
        return IntPtr.Size == 8
            ? SetWindowLongPtr64(hWnd, index, newProc)
            : SetWindowLong32(hWnd, index, newProc);
    }

    private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATA
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uID;
        public NotifyIconFlags uFlags;
        public int uCallbackMessage;
        public IntPtr hIcon;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;

        public uint dwState;
        public uint dwStateMask;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string szInfo;

        public uint uTimeoutOrVersion;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string szInfoTitle;

        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;

        public uint Version
        {
            readonly get => uTimeoutOrVersion;
            set => uTimeoutOrVersion = value;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [Flags]
    private enum NotifyIconFlags : uint
    {
        Message = 0x00000001,
        Icon = 0x00000002,
        Tip = 0x00000004
    }

    private enum NotifyCommand : uint
    {
        Add = 0x00000000,
        Modify = 0x00000001,
        Delete = 0x00000002,
        SetVersion = 0x00000004
    }

    [Flags]
    private enum MenuFlags : uint
    {
        String = 0x00000000,
        Separator = 0x00000800
    }

    [Flags]
    private enum TrackPopupMenuFlags : uint
    {
        LeftAlign = 0x0000,
        RightButton = 0x0002,
        ReturnCommand = 0x0100
    }

    private enum WindowLongIndexFlags : int
    {
        GWLP_WNDPROC = -4
    }
}
