# ISC Copilot Studio connector

Customizer for the Microsoft Entra source in Identity Security Cloud. It enriches Copilot Studio agents and tools that Entra already aggregates.

## What it adds

After `std:machine-identity:list` and `std:agent:list`, each Copilot agent (`microsoft:copilot-agent`) receives publication fields from the Dataverse `bot` row:

- `accesscontrolpolicy`
- `accesscontrolpolicyName`
- `authorizedsecuritygroupids`, a multi-valued list of Entra group object ids

Dataverse stores those ids in one comma-separated column. The customizer splits it. Display names come from group entitlements the Entra source already aggregates. On the demo source the attribute is a group entitlement (`isEntitlement` and `isGroup`) that references the Entra `group` schema (`identityAttribute` `objectId`).

After `std:resource:list`, each Copilot tool (`microsoft:copilot-tool`) receives `connectionReference`, `connectionId`, and `accountName`. The reference comes from `botcomponent_connectionreferenceset` and `connectionreference`. `accountName` comes from `connectioninstance` when that table has a row, otherwise from the Power Apps admin connection list (`properties.accountName`).

SDK 1.2.7 has no typed after-handler for these commands. The handlers are stored on `customizer.handlers`. Records for other resource ids are returned unchanged. A Dataverse or token failure leaves the record as Entra sent it.

The agent and tool schemas must already contain these attributes. Identity Security Cloud drops attributes that are not on the schema.

## Source configuration

`readConfig()` returns the Entra source connector attributes:

| Attribute | Use |
|---|---|
| `clientID` | App registration |
| `clientSecret` | Client secret already stored on the source |
| `domainName` | Token tenant |
| `dataverseUrl` | Dataverse Web API host, no trailing slash |
| `environmentId` | Optional Power Apps environment id |

`dataverseUrl` is not a field on the Entra configuration screen. Store it with `PATCH /sources/v1/{id}` (`updateSourceV1`, content type `application/json-patch+json`):

```json
[{ "op": "add", "path": "/connectorAttributes/dataverseUrl", "value": "https://{org}.api.{region}.dynamics.com" }]
```

Saving the Entra form later can drop keys the form does not know. If `dataverseUrl` is missing, the customizer uses `orgApiUrl` on the record when that attribute is present. If neither is present, it skips Dataverse.

When `environmentId` is absent, the customizer uses `Default-dce21e66-3a03-4ea3-b0c7-ffdc0729c732`.

## Prerequisites

[docs/prerequisites.md](docs/prerequisites.md). Copy `.env.example` to `.env.local` for the exploration script. Do not commit `.env.local`.

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
