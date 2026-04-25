# Security Policy

## Supported Versions

| Version | Status |
| --- | --- |
| 0.2.x | Release candidate / beta support |
| 0.1.x | Unsupported preview |

## Reporting A Vulnerability

Use GitHub Security Advisories for private vulnerability reports:

```text
https://github.com/SilverFuel/xeneon-widgets/security/advisories/new
```

Before a paid public launch, add a monitored security inbox to `support.html`, checkout receipts, and release notes.

Please include:

- affected version
- operating system
- a clear reproduction path
- whether local secrets, local network devices, or installer behavior are involved

Do not publish exploit details until a fix is available.

## Security Expectations

- Public Windows releases must be code-signed.
- Public macOS releases must be Developer ID signed and notarized.
- API keys and integration secrets must stay out of plain JSON config.
- Local API endpoints should remain bound to `127.0.0.1`.
- Customers must be able to reset local app data without editing files by hand.
