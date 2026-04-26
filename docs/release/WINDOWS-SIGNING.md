# Windows Signing

Paid/stable Windows releases need a trusted signature so customers do not see the worst SmartScreen experience. A free public beta can be unsigned only if the GitHub Release and installer notes say that clearly.

Microsoft documents current signing options for Windows apps in "Code signing options for Windows app developers" and recommends Trusted Signing for many app developers. Microsoft also documents `signtool.exe`, which is included with the Windows SDK.

Useful docs:

- https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control
- https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool

## Build

```powershell
npm run release:windows
```

The unsigned installer appears in:

```text
app\dist
```

## Sign With A PFX

```powershell
powershell -File scripts\sign-windows.ps1 `
  -Path app\dist\XenonEdgeHost-Setup-0.2.0-YYYYMMDD-HHMM.exe `
  -CertificatePath C:\path\to\code-signing-cert.pfx
```

The script will prompt for the certificate password.

## Sign With An Installed Certificate

```powershell
powershell -File scripts\sign-windows.ps1 `
  -Path app\dist\XenonEdgeHost-Setup-0.2.0-YYYYMMDD-HHMM.exe `
  -Thumbprint YOUR_CERT_THUMBPRINT
```

## Release Rule

Do not upload an unsigned installer as a paid/stable customer release. For a free beta, label it as unsigned, publish the SHA256 file, and expect Windows SmartScreen warnings.
