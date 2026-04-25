using Microsoft.UI.Xaml;

namespace XenonEdgeHost;

public partial class App : Application
{
    private MainWindow? _mainWindow;
    public static WebViewRuntimeInfo RuntimeInfo { get; internal set; } = WebViewRuntimeInfo.Unchecked;

    public App()
    {
        InitializeComponent();
        UnhandledException += HandleUnhandledException;
    }

    public static HostLogger Logger { get; } = CreateLogger();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        Logger.Info("Xenon Edge Host starting.");
        _mainWindow = new MainWindow();
        _mainWindow.Activate();
    }

    private void HandleUnhandledException(object sender, Microsoft.UI.Xaml.UnhandledExceptionEventArgs args)
    {
        Logger.Error("Unhandled exception", args.Exception);
        args.Handled = true;
    }

    private static HostLogger CreateLogger()
    {
        var logDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "XenonEdgeHost",
            "logs");
        return new HostLogger(logDir);
    }
}
