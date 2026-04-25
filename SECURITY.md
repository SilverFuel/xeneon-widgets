# Security Policy

## Supported Versions

| Version | Status |
| --- | --- |
| 0.2.x | Release candidate / beta support |
| 0.1.x | Unsupported preview |

## Reporting A Vulnerability

Before selling publicly, replace this placeholder with a monitored security contact:

```text
security@example.com
```

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
