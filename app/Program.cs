using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using System.Threading;
using WinRT;

namespace XenonEdgeHost;

public static class Program
{
    private const string MutexName = "XenonEdgeHost_SingleInstance_A1B2C3";
    internal const string ShowDisplayEventName = @"Local\XenonEdgeHost_ShowDisplay_A1B2C3";
    private static Mutex? _instanceMutex;

    [STAThread]
    public static void Main(string[] args)
    {
        _instanceMutex = new Mutex(true, MutexName, out var isFirstInstance);

        if (!isFirstInstance)
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
            _instanceMutex?.ReleaseMutex();
            _instanceMutex?.Dispose();
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
}
