# Windows Signing

Paid/stable Windows releases need a trusted signature so customers do not see the worst SmartScreen experience. A free public beta can be unsigned only if the GitHub Release and installer notes say that clearly.

Microsoft documents current signing options for Windows apps in "Code signing options for Windows app developers" and recommends Trusted Signing for many app developers. Microsoft also documents `signtool.exe`, which is included with the Windows SDK.

Useful docs:

- https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control
- https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool

## Manual PFX Sequence

```powershell
powershell -ExecutionPolicy Bypass -File app\publish.ps1
powershell -ExecutionPolicy Bypass -File scripts\sign-windows.ps1 `
  -Path publish\XenonEdgeHost.exe `
  -CertificatePath C:\path\to\code-signing-cert.pfx
powershell -ExecutionPolicy Bypass -File app\build-installer.ps1 -SkipPublish
powershell -ExecutionPolicy Bypass -File scripts\sign-windows.ps1 `
  -Path app\dist\Auxora-Setup-<version>-<timestamp>.exe `
  -CertificatePath C:\path\to\code-signing-cert.pfx
```

Packaging must run again after `publish\XenonEdgeHost.exe` is signed; otherwise the installer contains the earlier unsigned application. The signing script prompts for the certificate password, refuses to overwrite an existing matching certificate, temporarily imports the PFX into the selected user's or machine's personal store, signs by thumbprint without placing the password on a process command line, and attempts to remove every imported certificate and private key when signing finishes or fails. Cleanup errors are collected per certificate so all removals are attempted before one aggregate failure is surfaced.

## Sign With An Installed Certificate

```powershell
powershell -File scripts\sign-windows.ps1 `
  -Path app\dist\Auxora-Setup-<version>-<timestamp>.exe `
  -Thumbprint YOUR_CERT_THUMBPRINT
```

## Release Rule

Do not upload an unsigned installer as a paid/stable customer release. For a free beta, label it as unsigned, publish the SHA256 file, and expect Windows SmartScreen warnings.

Sign `publish\XenonEdgeHost.exe` before packaging so the installed application is trusted, package that signed output, then sign the generated `Auxora-Setup-*.exe`. When an installer SHA256 sidecar already exists, `sign-windows.ps1` regenerates it after signing so the checksum describes the final bytes.

The `Commercial Release Candidate` GitHub workflow performs this order with two fresh, protected `production` signing jobs. Repository build and packaging scripts run only on separate secret-free runners; signing runners download artifacts, sign only the selected executable, remove temporary credentials, and hand the result to a final secret-free verification job. The workflow requires `WINDOWS_SIGNING_PFX_BASE64`, `WINDOWS_SIGNING_PFX_PASSWORD`, and a completed `commercial-launch-evidence.json`. It uploads a candidate artifact for human release approval; it does not automatically sell or publish the build.
