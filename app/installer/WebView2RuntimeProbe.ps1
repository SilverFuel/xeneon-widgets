function Initialize-WebView2LoaderInterop {
  if ("Auxora.Installer.WebView2LoaderProbe" -as [type]) {
    return
  }

  Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Auxora.Installer
{
    public static class WebView2LoaderProbe
    {
        private const uint LoadLibrarySearchDllLoadDir = 0x00000100;
        private const uint LoadLibrarySearchSystem32 = 0x00000800;

        [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Unicode)]
        private delegate int GetAvailableCoreWebView2BrowserVersionStringDelegate(
            [MarshalAs(UnmanagedType.LPWStr)] string browserExecutableFolder,
            out IntPtr versionInfo);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibraryExW(string fileName, IntPtr file, uint flags);

        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true)]
        private static extern IntPtr GetProcAddress(IntPtr module, string procedureName);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FreeLibrary(IntPtr module);

        public static string GetAvailableBrowserVersion(string loaderPath, string browserExecutableFolder)
        {
            if (String.IsNullOrWhiteSpace(loaderPath))
            {
                throw new ArgumentException("A WebView2Loader.dll path is required.", "loaderPath");
            }

            IntPtr module = LoadLibraryExW(
                loaderPath,
                IntPtr.Zero,
                LoadLibrarySearchDllLoadDir | LoadLibrarySearchSystem32);
            if (module == IntPtr.Zero)
            {
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "The candidate WebView2Loader.dll could not be loaded.");
            }

            try
            {
                IntPtr procedure = GetProcAddress(module, "GetAvailableCoreWebView2BrowserVersionString");
                if (procedure == IntPtr.Zero)
                {
                    throw new EntryPointNotFoundException(
                        "The candidate WebView2Loader.dll does not export GetAvailableCoreWebView2BrowserVersionString.");
                }

                var probe = (GetAvailableCoreWebView2BrowserVersionStringDelegate)
                    Marshal.GetDelegateForFunctionPointer(
                        procedure,
                        typeof(GetAvailableCoreWebView2BrowserVersionStringDelegate));
                IntPtr versionInfo = IntPtr.Zero;
                try
                {
                    int result = probe(
                        String.IsNullOrWhiteSpace(browserExecutableFolder) ? null : browserExecutableFolder,
                        out versionInfo);
                    if (result < 0)
                    {
                        Marshal.ThrowExceptionForHR(result);
                    }

                    return versionInfo == IntPtr.Zero
                        ? String.Empty
                        : (Marshal.PtrToStringUni(versionInfo) ?? String.Empty);
                }
                finally
                {
                    if (versionInfo != IntPtr.Zero)
                    {
                        Marshal.FreeCoTaskMem(versionInfo);
                    }
                }
            }
            finally
            {
                FreeLibrary(module);
            }
        }
    }
}
"@ -Language CSharp
}

function Invoke-WebView2LoaderVersionProbe($loaderPath, $browserExecutableFolder) {
  Initialize-WebView2LoaderInterop
  return [Auxora.Installer.WebView2LoaderProbe]::GetAvailableBrowserVersion(
    [System.IO.Path]::GetFullPath($loaderPath),
    $browserExecutableFolder)
}

function Test-UsableWebView2Version($versionText) {
  if ([string]::IsNullOrWhiteSpace([string]$versionText)) {
    return $false
  }

  $parsedVersion = $null
  if (-not [System.Version]::TryParse(([string]$versionText).Trim(), [ref]$parsedVersion)) {
    return $false
  }

  return $parsedVersion -gt [System.Version]::new(0, 0, 0, 0)
}

function Find-BundledWebView2RuntimePath($rootPath) {
  $candidateRoots = @((Join-Path $rootPath "FixedRuntime"))
  $candidateRoots += @(Get-ChildItem -LiteralPath $rootPath -Directory -Filter "Microsoft.WebView2.FixedVersionRuntime*" -ErrorAction SilentlyContinue |
    Sort-Object FullName |
    ForEach-Object { $_.FullName })

  foreach ($candidateRoot in $candidateRoots) {
    if (-not (Test-Path -LiteralPath $candidateRoot -PathType Container)) {
      continue
    }

    $directExecutable = Join-Path $candidateRoot "msedgewebview2.exe"
    if (Test-Path -LiteralPath $directExecutable -PathType Leaf) {
      return [System.IO.Path]::GetFullPath($candidateRoot)
    }

    $versionedRuntime = Get-ChildItem -LiteralPath $candidateRoot -Filter "msedgewebview2.exe" -File -Recurse -ErrorAction SilentlyContinue |
      Sort-Object @{ Expression = {
        $parsed = $null
        if ([System.Version]::TryParse($_.Directory.Name, [ref]$parsed)) { $parsed } else { [System.Version]::new(0, 0) }
      }; Descending = $true }, FullName |
      Select-Object -First 1
    if ($versionedRuntime) {
      return [System.IO.Path]::GetFullPath($versionedRuntime.DirectoryName)
    }
  }

  return $null
}

function Get-UsableWebView2Runtime($rootPath, [scriptblock]$ProbeInvoker = $null) {
  $resolvedRoot = [System.IO.Path]::GetFullPath($rootPath)
  $loaderPath = Join-Path $resolvedRoot "WebView2Loader.dll"
  if (-not (Test-Path -LiteralPath $loaderPath -PathType Leaf) -or (Get-Item -LiteralPath $loaderPath).Length -le 0) {
    throw "The staged candidate is missing a usable WebView2Loader.dll."
  }

  if ($null -eq $ProbeInvoker) {
    $ProbeInvoker = ${function:Invoke-WebView2LoaderVersionProbe}
  }

  $fixedRuntimePath = Find-BundledWebView2RuntimePath $resolvedRoot
  $runtimeKind = if ([string]::IsNullOrWhiteSpace($fixedRuntimePath)) { "Evergreen" } else { "FixedRuntime" }
  $browserExecutableFolder = if ($runtimeKind -eq "FixedRuntime") { $fixedRuntimePath } else { $null }

  try {
    $version = [string](& $ProbeInvoker $loaderPath $browserExecutableFolder)
  } catch {
    $target = if ($runtimeKind -eq "FixedRuntime") { "bundled FixedRuntime" } else { "installed Evergreen runtime" }
    throw "The candidate WebView2 loader could not prove a usable $target. $($_.Exception.Message)"
  }

  if (-not (Test-UsableWebView2Version $version)) {
    $target = if ($runtimeKind -eq "FixedRuntime") { "bundled FixedRuntime" } else { "installed Evergreen runtime" }
    throw "The candidate WebView2 loader did not return a usable version for the $target."
  }

  return [pscustomobject]@{
    Kind = $runtimeKind
    Version = $version.Trim()
    RuntimePath = $browserExecutableFolder
    LoaderPath = $loaderPath
  }
}
