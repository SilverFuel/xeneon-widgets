# Auxora Extension Contract

Auxora ships with local curated panels only. Third-party packs are inspected but are not runnable unless every trust check passes.

An extension uses an `auxora-extension.json` manifest. Its entrypoint must remain inside its extension directory, every requested permission must be allowlisted, the entrypoint SHA256 must match, and the RSA-PSS SHA256 signature must verify against a publisher in `assets/trusted-extension-publishers.json`.

The signed payload is five newline-separated values: extension ID, version, forward-slash entrypoint, alphabetically sorted comma-separated permissions, and uppercase entrypoint SHA256.

Before external widget loading is enabled, every pack must provide a signed manifest containing a stable pack ID, version, declared permissions, a local asset list, and a support URL. The host must verify the signature before exposing the pack in the dashboard.

Widgets must be local-first, render all endpoint-controlled text safely, keep secrets out of markup and local browser storage, and use only explicitly granted endpoints. A widget may not invoke Windows actions, launch processes, or access integration credentials directly.

The manifest may declare only these capabilities:

- `system.read` and `network.read` for read-only local telemetry.
- `audio.read` and `audio.control` for user-approved sound access.
- `smart-home.read` and `smart-home.control` for approved local integrations.
- `actions.execute` for allowlisted, confirmation-gated actions.

Packs that request additional capabilities, background persistence, remote code, or unrestricted network access must be rejected.
