import { spawn } from "node:child_process";

const visibleWindowProbe = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public sealed class AuxoraVisibleWindowSample
{
    public long Handle { get; set; }
    public string Title { get; set; }
    public int Left { get; set; }
    public int Top { get; set; }
    public int Right { get; set; }
    public int Bottom { get; set; }
}

public sealed class AuxoraStopSignal
{
    private readonly ManualResetEventSlim _stopped = new ManualResetEventSlim(false);

    public AuxoraStopSignal(TextReader reader)
    {
        var inputThread = new Thread(delegate()
        {
            reader.ReadLine();
            _stopped.Set();
        });
        inputThread.IsBackground = true;
        inputThread.Name = "Auxora visible-window guard input";
        inputThread.Start();
    }

    public bool IsSet
    {
        get { return _stopped.IsSet; }
    }
}

public static class AuxoraVisibleWindowProbe
{
    private const int DwmwaCloaked = 14;
    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out NativeRect bounds);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);

    [DllImport("winmm.dll")]
    private static extern uint timeBeginPeriod(uint period);

    [DllImport("winmm.dll")]
    private static extern uint timeEndPeriod(uint period);

    public static void BeginHighResolutionSampling()
    {
        timeBeginPeriod(1);
    }

    public static void EndHighResolutionSampling()
    {
        timeEndPeriod(1);
    }

    public static List<AuxoraVisibleWindowSample> Capture(int targetProcessId)
    {
        var windows = new List<AuxoraVisibleWindowSample>();
        EnumWindows(delegate(IntPtr window, IntPtr parameter)
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId != (uint)targetProcessId || !IsWindowVisible(window))
            {
                return true;
            }

            int cloaked;
            if (DwmGetWindowAttribute(window, DwmwaCloaked, out cloaked, sizeof(int)) == 0 && cloaked != 0)
            {
                return true;
            }

            NativeRect bounds;
            GetWindowRect(window, out bounds);
            var title = new StringBuilder(256);
            GetWindowText(window, title, title.Capacity);
            windows.Add(new AuxoraVisibleWindowSample
            {
                Handle = window.ToInt64(),
                Title = title.ToString(),
                Left = bounds.Left,
                Top = bounds.Top,
                Right = bounds.Right,
                Bottom = bounds.Bottom
            });
            return true;
        }, IntPtr.Zero);
        return windows;
    }
}
'@

[AuxoraVisibleWindowProbe]::BeginHighResolutionSampling()
try {
  Write-Output "AUXORA_VISIBLE_WINDOW_GUARD_READY"
  $targetLine = [Console]::In.ReadLine()
  if ($targetLine -eq "ABORT") {
    [ordered]@{ aborted = $true; timedOut = $false; sampleCount = 0; visibleSampleCount = 0; observedWindows = @(); terminatedTarget = $false } | ConvertTo-Json -Compress -Depth 4
    return
  }
  if ([string]::IsNullOrWhiteSpace($targetLine)) {
    throw "Auxora process ID was not provided to the visible-window guard."
  }

  $targetProcessId = [int]$targetLine
  $stopSignal = New-Object AuxoraStopSignal([Console]::In)
  $deadline = [DateTimeOffset]::UtcNow.AddHours(1)
  $sampleCount = 0
  $visibleSampleCount = 0
  $terminatedTarget = $false
  $observedWindowKeys = New-Object System.Collections.Generic.HashSet[string]
  $observedWindows = New-Object System.Collections.Generic.List[object]

  while ((-not $stopSignal.IsSet) -and [DateTimeOffset]::UtcNow -lt $deadline) {
    $sample = [AuxoraVisibleWindowProbe]::Capture($targetProcessId)
    $sampleCount++
    foreach ($window in $sample) {
      $visibleSampleCount++
      $windowKey = "$($window.Handle):$($window.Left):$($window.Top):$($window.Right):$($window.Bottom)"
      if ($observedWindows.Count -lt 20 -and $observedWindowKeys.Add($windowKey)) {
        $observedWindows.Add([ordered]@{
          handle = $window.Handle
          title = $window.Title
          left = $window.Left
          top = $window.Top
          right = $window.Right
          bottom = $window.Bottom
        })
      }
    }

    if ($visibleSampleCount -gt 0) {
      Stop-Process -Id $targetProcessId -Force -ErrorAction SilentlyContinue
      $terminatedTarget = $true
      break
    }

    [System.Threading.Thread]::Sleep(1)
  }

  [ordered]@{
    aborted = $false
    timedOut = (-not $stopSignal.IsSet) -and [DateTimeOffset]::UtcNow -ge $deadline
    sampleCount = $sampleCount
    visibleSampleCount = $visibleSampleCount
    observedWindows = $observedWindows.ToArray()
    terminatedTarget = $terminatedTarget
  } | ConvertTo-Json -Compress -Depth 4
} finally {
  [AuxoraVisibleWindowProbe]::EndHighResolutionSampling()
}
`;

async function startVisibleWindowGuard() {
  const watcher = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", visibleWindowProbe], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let ready = false;
  let resultSettled = false;
  let resolveReady;
  let rejectReady;
  let resolveResult;
  let rejectResult;
  const readyPromise = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  const resultPromise = new Promise((resolvePromise, rejectPromise) => {
    resolveResult = resolvePromise;
    rejectResult = rejectPromise;
  });

  watcher.stderr.on("data", chunk => {
    stderrBuffer += String(chunk);
  });
  watcher.stdout.on("data", chunk => {
    stdoutBuffer += String(chunk);
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines.map(value => value.trim()).filter(Boolean)) {
      if (line === "AUXORA_VISIBLE_WINDOW_GUARD_READY") {
        ready = true;
        resolveReady();
        continue;
      }
      if (line.startsWith("{")) {
        try {
          resultSettled = true;
          resolveResult(JSON.parse(line));
        } catch (error) {
          resultSettled = true;
          rejectResult(new Error(`visible-window guard returned invalid JSON: ${error.message}`));
        }
      }
    }
  });
  watcher.once("error", error => {
    resultSettled = true;
    rejectReady(error);
    rejectResult(error);
  });
  watcher.once("exit", code => {
    if (!ready) {
      rejectReady(new Error(`visible-window guard exited before ready (code ${code}): ${stderrBuffer.trim()}`));
    }
    if (code !== 0) {
      resultSettled = true;
      rejectResult(new Error(`visible-window guard exited with code ${code}: ${stderrBuffer.trim()}`));
    } else if (!resultSettled) {
      resultSettled = true;
      rejectResult(new Error(`visible-window guard exited without a result: ${stderrBuffer.trim()}`));
    }
  });

  await readyPromise;
  return { process: watcher, resultPromise, attached: false, stopped: false };
}

async function abortVisibleWindowGuard(guard) {
  if (!guard.stopped) {
    guard.stopped = true;
    guard.process.stdin.end("ABORT\n");
  }
  try {
    await guard.resultPromise;
  } catch {
    // Preserve the process-launch error that caused this cleanup path.
  }
}

export async function spawnWithVisibleWindowGuard(executable, args, options) {
  const guard = await startVisibleWindowGuard();
  try {
    const child = spawn(executable, args, options);
    if (!Number.isInteger(child.pid) || child.pid <= 0) {
      await abortVisibleWindowGuard(guard);
      throw new Error("guarded process did not publish a Windows process ID");
    }
    guard.attached = true;
    guard.process.stdin.write(`${child.pid}\n`);
    return { child, guard };
  } catch (error) {
    await abortVisibleWindowGuard(guard);
    throw error;
  }
}

export async function stopVisibleWindowGuard(guard, label) {
  if (!guard?.attached) {
    throw new Error(`${label} visible-window guard was never attached`);
  }
  if (!guard.stopped) {
    guard.stopped = true;
    if (!guard.process.stdin.destroyed) {
      guard.process.stdin.end("STOP\n");
    }
  }
  const result = await guard.resultPromise;
  if (result.timedOut) {
    throw new Error(`${label} visible-window guard timed out after ${result.sampleCount || 0} samples`);
  }
  if (!Number.isFinite(result.sampleCount) || result.sampleCount <= 0) {
    throw new Error(`${label} visible-window guard did not capture any Win32 samples`);
  }
  if (result.visibleSampleCount !== 0 || result.observedWindows?.length > 0 || result.terminatedTarget) {
    throw new Error(`${label} exposed a visible top-level window and was terminated: ${JSON.stringify(result)}`);
  }
  console.log(`${label} remained hidden across ${result.sampleCount} Win32 window samples`);
  return result;
}

if (process.argv.includes("--self-test")) {
  const { child, guard } = await spawnWithVisibleWindowGuard(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "[System.Threading.Thread]::Sleep(1500)"],
    { stdio: "ignore", windowsHide: true }
  );
  await new Promise(resolveDelay => setTimeout(resolveDelay, 750));
  await stopVisibleWindowGuard(guard, "guard self-test process");
  await new Promise((resolveExit, rejectExit) => {
    child.once("exit", resolveExit);
    child.once("error", rejectExit);
  });
  console.log("visible-window guard self-test passed");
}
