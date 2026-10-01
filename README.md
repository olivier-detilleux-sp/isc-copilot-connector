# ISC Copilot Studio connector

Customizer and workflow for Microsoft Copilot Studio agents aggregated by the Microsoft Entra SaaS connector in Identity Security Cloud.

To configure a new source, follow [docs/setup.md](docs/setup.md). That guide covers the Entra source, Power Platform and Graph prerequisites, service principal and machine-account settings, dataset schema attributes, the customizer upload, the workflow, and the aggregation order.

## What the customizer adds

After `std:machine-identity:list` and `std:agent:list`, each Copilot agent (`microsoft:copilot-agent`) receives:

- `accesscontrolpolicy`, `accesscontrolpolicyName`, and multi-valued `authorizedsecuritygroupids` from the Dataverse `bot` row. The Dataverse host is `orgApiUrl` on the agent. `authorizedsecuritygroupids` is a multi-valued string, not an entitlement.
- `additionalOwners`, the email addresses of the Entra agent identity sponsors and owners (`entraIdentityId`).

After `std:resource:list`, each Copilot tool (`microsoft:copilot-tool`) receives `connectionReference`, `connectionId`, and `accountName`.

[docs/prerequisites.md](docs/prerequisites.md) explains the Dataverse privileges and the Power Apps registration. [docs/user-entitlements-workflow.md](docs/user-entitlements-workflow.md) describes what the workflow does after you deploy it.

`scripts/explore_agents.py` is a read-only Dataverse check. It loads `.env.local`. Do not commit `.env.local`.
