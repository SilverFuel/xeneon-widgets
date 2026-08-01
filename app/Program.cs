using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using WinRT;

namespace XenonEdgeHost;

public static class Program
{
    private const string MutexName = "XenonEdgeHost_SingleInstance_A1B2C3";
    private const string ShowDisplayEventBaseName = @"Local\XenonEdgeHost_ShowDisplay_A1B2C3";
    private static readonly TimeSpan PreviousInstanceExitWait = TimeSpan.FromSeconds(30);
    private static readonly string InstanceScopeSuffix = ResolveIsolatedTestInstanceSuffix(
        Environment.GetEnvironmentVariable("AUXORA_ENABLE_TEST_DATA_ROOTS"),
        Environment.GetEnvironmentVariable("AUXORA_TEST_ROAMING_ROOT"),
        Environment.GetEnvironmentVariable("AUXORA_TEST_LOCAL_ROOT"),
        Environment.GetEnvironmentVariable("AUXORA_TEST_INSTANCE_ID"));
    private static Mutex? _instanceMutex;
    private static bool _ownsInstanceMutex;
    internal static string ShowDisplayEventName => $"{ShowDisplayEventBaseName}{InstanceScopeSuffix}";
    internal static AppLaunchOptions LaunchOptions { get; private set; } = AppLaunchOptions.Default;

    [STAThread]
    public static void Main(string[] args)
    {
        LaunchOptions = AppLaunchOptions.Parse(args);
        _instanceMutex = new Mutex(false, $"{MutexName}{InstanceScopeSuffix}");
        _ownsInstanceMutex = TryAcquireInstanceMutex(LaunchOptions.WaitForPreviousInstance);

        if (!_ownsInstanceMutex)
        {
            SignalExistingInstance();
            _instanceMutex.Dispose();
            _instanceMutex = null;
            return;
        }

        try
        {
            Environment.SetEnvironmentVariable("MICROSOFT_WINDOWSAPPRUNTIME_BASE_DIRECTORY", AppContext.BaseDirectory);
            App.RuntimeInfo = WebViewRuntimeLocator.Configure(App.Logger);
            ComWrappersSupport.InitializeComWrappers();
            Application.Start(_ =>
            {
                var dispatcherQueue = DispatcherQueue.GetForCurrentThread();
                UiDispatcher.Initialize(dispatcherQueue);
                var synchronizationContext = new DispatcherQueueSynchronizationContext(dispatcherQueue);
                SynchronizationContext.SetSynchronizationContext(synchronizationContext);
                var app = new App();
            });
        }
        finally
        {
            if (_ownsInstanceMutex)
            {
                _instanceMutex?.ReleaseMutex();
            }
            _instanceMutex?.Dispose();
        }
    }

    private static bool TryAcquireInstanceMutex(bool waitForPreviousInstance)
    {
        if (_instanceMutex is null)
        {
            return false;
        }

        try
        {
            return _instanceMutex.WaitOne(waitForPreviousInstance ? PreviousInstanceExitWait : TimeSpan.Zero);
        }
        catch (AbandonedMutexException)
        {
            return true;
        }
    }

    private static void SignalExistingInstance()
    {
        try
        {
            using var showDisplayEvent = EventWaitHandle.OpenExisting(ShowDisplayEventName);
            showDisplayEvent.Set();
        }
        catch
        {
            // If the existing instance has not created the event yet, there is nothing useful to signal.
        }
    }

    internal static string ResolveIsolatedTestInstanceSuffix(
        string? testDataRootsEnabled,
        string? testRoamingRoot,
        string? testLocalRoot,
        string? testInstanceId)
    {
        if (!string.Equals(testDataRootsEnabled, "1", StringComparison.Ordinal)
            || string.IsNullOrWhiteSpace(testRoamingRoot)
            || string.IsNullOrWhiteSpace(testLocalRoot)
            || string.IsNullOrWhiteSpace(testInstanceId))
        {
            return string.Empty;
        }

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(testInstanceId));
        return $"-test-{Convert.ToHexString(hash.AsSpan(0, 8))}";
    }
}
