# XENEON Edge Widget Extension Contract

XENEON Edge ships with local curated panels only. Third-party packs are not loaded by the host yet.

Before external widget loading is enabled, every pack must provide a signed manifest containing a stable pack ID, version, declared permissions, a local asset list, and a support URL. The host must verify the signature before exposing the pack in the dashboard.

Widgets must be local-first, render all endpoint-controlled text safely, keep secrets out of markup and local browser storage, and use only explicitly granted endpoints. A widget may not invoke Windows actions, launch processes, or access integration credentials directly.

The future manifest will declare only these capability classes:

- `telemetry.read` for read-only local dashboard snapshots.
- `integration.read` for a user-approved integration snapshot.
- `integration.control` for a user-approved, confirmation-gated action.
- `network.local` for an explicitly configured private-network endpoint.

Packs that request additional capabilities, background persistence, remote code, or unrestricted network access must be rejected.
