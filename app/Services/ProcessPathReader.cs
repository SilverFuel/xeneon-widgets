using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace XenonEdgeHost;

// Reads the path of a running process's executable.
// The limited query is one system call and is allowed for protected and anti-cheat processes.
// Process.MainModule lists every module of the process and is refused for those, so it is only the
// fallback. Game detection asks for every process on each pass, which makes the order matter.
internal static class ProcessPathReader
{
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const int MaxPathChars = 2048;

    // The executable's full path, or "" when Windows will not give it.
    public static string Read(Process process)
    {
        try
        {
            var path = ReadLimited(process.Id);
            if (!string.IsNullOrWhiteSpace(path))
            {
                return path;
            }
        }
        catch
        {
        }

        try
        {
            return process.MainModule?.FileName ?? "";
        }
        catch
        {
            return "";
        }
    }

    internal static string ReadLimited(int processId)
    {
        if (processId <= 0)
        {
            return "";
        }

        var handle = OpenProcess(ProcessQueryLimitedInformation, false, (uint)processId);
        if (handle == IntPtr.Zero)
        {
            return "";
        }

        try
        {
            var buffer = new StringBuilder(MaxPathChars);
            var size = (uint)buffer.Capacity;
            return QueryFullProcessImageName(handle, 0, buffer, ref size) && size > 0
                ? buffer.ToString(0, (int)Math.Min(size, (uint)buffer.Length))
                : "";
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, [MarshalAs(UnmanagedType.Bool)] bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "QueryFullProcessImageNameW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, [Out] StringBuilder exeName, ref uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
}
