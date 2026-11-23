using NUnit.Framework;
using System.Diagnostics;

namespace XenonEdgeHost.Tests;

public sealed class ProcessPathReaderTests
{
    [Test]
    public void LimitedQueryReturnsThisProcessPath()
    {
        var expected = Environment.ProcessPath;
        Assert.That(expected, Is.Not.Null.And.Not.Empty);

        Assert.That(ProcessPathReader.ReadLimited(Environment.ProcessId), Is.EqualTo(expected).IgnoreCase);
    }

    [Test]
    public void ReadReturnsThisProcessPath()
    {
        using var process = Process.GetCurrentProcess();

        Assert.That(ProcessPathReader.Read(process), Is.EqualTo(Environment.ProcessPath).IgnoreCase);
    }

    [Test]
    public void ProcessThatCannotBeOpenedGivesAnEmptyPath()
    {
        Assert.That(ProcessPathReader.ReadLimited(0), Is.Empty);
        Assert.That(ProcessPathReader.ReadLimited(-1), Is.Empty);
    }

    // csrss is a protected Windows process: its module list is refused, as an anti-cheat game's is.
    [Test]
    public void ProtectedProcessStillGivesItsPath()
    {
        var checkedOne = false;
        foreach (var process in Process.GetProcessesByName("csrss"))
        {
            using (process)
            {
                var moduleReadable = false;
                try
                {
                    moduleReadable = !string.IsNullOrWhiteSpace(process.MainModule?.FileName);
                }
                catch
                {
                }

                if (moduleReadable)
                {
                    continue;
                }

                checkedOne = true;
                Assert.That(ProcessPathReader.Read(process), Does.EndWith("csrss.exe").IgnoreCase,
                    "the path of a process whose modules are refused was not read");
            }
        }

        if (!checkedOne)
        {
            Assert.Ignore("No csrss process refused its module list on this machine, so the fallback was not exercised.");
        }
    }
}
