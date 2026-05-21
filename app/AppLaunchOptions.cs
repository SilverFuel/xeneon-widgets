namespace XenonEdgeHost;

public sealed class AppLaunchOptions
{
    public bool SafeMode { get; init; }

    public bool WaitForPreviousInstance { get; init; }

    public static AppLaunchOptions Default { get; } = new();

    public static AppLaunchOptions Parse(IEnumerable<string> args)
    {
        var safeMode = args.Any(arg =>
            string.Equals(arg, "--safe-mode", StringComparison.OrdinalIgnoreCase)
            || string.Equals(arg, "/safe-mode", StringComparison.OrdinalIgnoreCase)
            || string.Equals(arg, "-safe-mode", StringComparison.OrdinalIgnoreCase));
        var waitForPreviousInstance = args.Any(arg =>
            string.Equals(arg, "--wait-for-previous-instance", StringComparison.OrdinalIgnoreCase)
            || string.Equals(arg, "/wait-for-previous-instance", StringComparison.OrdinalIgnoreCase)
            || string.Equals(arg, "-wait-for-previous-instance", StringComparison.OrdinalIgnoreCase));

        return new AppLaunchOptions
        {
            SafeMode = safeMode,
            WaitForPreviousInstance = waitForPreviousInstance
        };
    }
}
