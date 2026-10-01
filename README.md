# ISC Copilot Studio connector

Customizer for the Microsoft Entra source in Identity Security Cloud. It enriches Copilot Studio agents and tools that Entra already aggregates.

## What it adds

After `std:machine-identity:list` and `std:agent:list`, each Copilot agent (`microsoft:copilot-agent`) receives publication fields from the Dataverse `bot` row:

- `accesscontrolpolicy`
- `accesscontrolpolicyName`
- `authorizedsecuritygroupids`, a multi-valued list of Entra group object ids

The Dataverse host is `orgApiUrl` on that agent. The customizer does not read a Dataverse URL from the source configuration. Dataverse stores the group ids in one comma-separated column. The customizer splits it. Display names come from group entitlements the Entra source already aggregates. On the demo source the attribute is a group entitlement (`isEntitlement` and `isGroup`) that references the Entra `group` schema (`identityAttribute` `objectId`).

The same agent also receives `additionalOwners`, a multi-valued list of email addresses. Those addresses are the sponsors and owners of the Entra agent identity (`entraIdentityId`), not the Dataverse owner. Sponsors come first, then owners. Each value is `mail`, or `userPrincipalName` when `mail` is empty. The same address is stored once. Object ids are not stored. A Graph failure leaves `additionalOwners` unset and still keeps the publication fields. Details and permissions are in [docs/prerequisites.md](docs/prerequisites.md).

After `std:resource:list`, each Copilot tool (`microsoft:copilot-tool`) receives `connectionReference`, `connectionId`, and `accountName`. The reference comes from `botcomponent_connectionreferenceset` and `connectionreference`. `accountName` comes from `connectioninstance` when that table has a row, otherwise from the Power Apps admin connection list (`properties.accountName`). A tool uses its own `orgApiUrl` when present, otherwise the host from another record in the same response. If none is present, Dataverse enrichment for that tool is skipped.

SDK 1.2.7 has no typed after-handler for these commands. The handlers are stored on `customizer.handlers`. Records for other resource ids are returned unchanged. A Dataverse or token failure leaves the affected fields as Entra sent them.

The agent and tool schemas must already contain these attributes. Identity Security Cloud drops attributes that are not on the schema. On AZURE-AL (`bbc7c864783d44e5b4e0022bd85d7a11`), `additionalOwners` is on the Microsoft Copilot Studio Agent schema (`09c5705b3ecd45e39515761f29d3284d`): string, multi-valued, not an entitlement.

## Deployed customizer

Version 4 is uploaded on `company24740-poc` and linked to source AZURE-AL. The next aggregation uses it.

| | |
|---|---|
| Customizer | `6631cedd-b67e-4289-9688-890dbb7eb0ac` |
| Image | `cb44834a-e05c-443d-86f1-273d04780d39` |
| Version | 4 |

## Source configuration

`readConfig()` returns the Entra source connector attributes:

| Attribute | Use |
|---|---|
| `clientID` | App registration |
| `clientSecret` | Client secret already stored on the source |
| `domainName` | Token tenant |
| `environmentId` | Optional Power Apps environment id |

`orgApiUrl` on the agent selects the Dataverse host. A tool record uses its own `orgApiUrl` when present, otherwise the host from another record in the same response. If none is present, Dataverse enrichment is skipped. A `dataverseUrl` connector attribute is ignored.

When `environmentId` is absent, the customizer uses `Default-dce21e66-3a03-4ea3-b0c7-ffdc0729c732`.

## Prerequisites

[docs/prerequisites.md](docs/prerequisites.md). The Entra source application needs Microsoft Graph application permissions so the connector can aggregate agent identities and the customizer can read their sponsors and owners. Copy `.env.example` to `.env.local` for the exploration script. Do not commit `.env.local`.

## Build and test

From `customizer/`:

```bash
npm install
npm test
npm run build
```

`npm run pack-zip` needs `connector-spec.json` plus `npm_package_name` and `npm_package_version`, or the zip is named `undefined`. Upload it with `sail connectors customizers upload`. The source is linked to the customizer id, so the next aggregation uses the latest uploaded version.

## Exploration script

`scripts/explore_agents.py` is a read-only Dataverse check. It loads `.env.local` and prints a sanitized summary.

## User-entitlements workflow

`workflows/map-copilot-agent-user-entitlements.json` is exported from the
tenant. It reacts to a new Copilot machine identity on any source whose
publication policy is Group membership (`accesscontrolpolicy` is `2`),
correlates the Entra service principal machine account whose native identity
matches `entraIdentityId`, resolves `authorizedsecuritygroupids` to ISC group
entitlements, and appends them to `userEntitlements`. Its HTTP actions use a
workflow OAuth parameter stored in
the tenant. See
[docs/user-entitlements-workflow.md](docs/user-entitlements-workflow.md).
