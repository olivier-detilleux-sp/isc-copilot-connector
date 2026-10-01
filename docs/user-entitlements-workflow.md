# Copilot agent user-entitlements workflow

`workflows/map-copilot-agent-user-entitlements.json` is exported from
`company24740-poc`, workflow `b5a61d8a-2206-42a2-a6d3-8cfdc504c9dd`. The tenant
is the source of truth: after editing the workflow in the UI, export it again
into this file. The workflow is enabled there. To deploy it on another tenant,
follow [setup.md](setup.md): replace the API host, replace the hardcoded Entra
source id in **Get Group Entitlement**, configure OAuth client credentials, then
enable the workflow.

## Behavior

The `Machine Identity Created` trigger fires for every source when:

- dataset is `microsoft:copilot`;
- `attributes.accesscontrolpolicy == "2"` (Group membership).

The workflow then correlates the Entra service principal that represents the
agent. That principal is aggregated as a machine account and is left
uncorrelated by the connector. `attributes.entraIdentityId` is the Entra object
id. On the Microsoft Entra source the account `nativeIdentity` starts with that
object id (the connector stores service principals as `objectId:EXT`). The
workflow:

1. calls `GET /machine-accounts/v2` on the machine identity source, with the
   `X-SailPoint-Experimental: true` header, where `name` or `nativeIdentity`
   starts with `entraIdentityId` (limit 1);
2. calls `PATCH /machine-accounts/v1/{id}` on the first result with
   `application/json-patch+json` and the same experimental header;
3. sets `machineIdentity` to the Copilot agent
   (`{ id, name, subtype: AI_AGENT, type: MACHINE_IDENTITY }`);
4. continues to the group mapping when the lookup or the PATCH fails (step
   `catch`), for example when the service principal is not aggregated yet.

`machineIdentity` is not in the documented patchable fields of
`updateMachineAccountV1`; it is documented on the bulk update
(`updateMachineAccountsInBulk`), which this tenant does not serve.

The workflow then iterates over `attributes.authorizedsecuritygroupids` in a
serial loop. That attribute is a multi-valued string of Entra group object
ids, not an entitlement. For every object ID it:

1. calls `GET /entitlements/v1` on source AZURE-AL
   (`bbc7c864783d44e5b4e0022bd85d7a11`), limited to the `group` entitlement
   type;
2. skips the value when no entitlement is found;
3. calls `PATCH /machine-identities/v2/{id}` with
   `application/json-patch+json` and the `X-SailPoint-Experimental: true`
   header;
4. appends `{ entitlementId, sourceId }` to `userEntitlements`.

The serial loop prevents concurrent patches from overwriting each other.

## Authentication

The HTTP Request actions use **OAuth 2.0 - Client Credentials Grant** through
the workflow OAuth parameter `cc1bd197-842a-4b23-964f-ce3e3eec3071`. The export
contains only the parameter reference. The client secret is stored in the
tenant, not in this repository.

The credential needs `idn:entitlement:read`, `idn:mis-identity:manage`,
`idn:mis-account:read`, and `idn:mis-account:manage`. The machine identity
PATCH and the machine account PATCH require the ORG_ADMIN user level.

## Validation

`Machine Identity Created` does not support simulation. Validate the workflow
by creating or reaggregating a test Copilot agent whose Dataverse publication
policy is Group membership. Confirm that:

1. the workflow execution succeeds once;
2. the service principal machine account, when it already exists, has
   `machineIdentity` set to the Copilot agent;
3. every configured object ID resolves to exactly one AZURE-AL group
   entitlement;
4. the machine identity `userEntitlements` contains the corresponding
   entitlement IDs.

The workflow only runs when the Copilot machine identity is created. If the
service principal is aggregated later, this execution does not retry the
correlation. Publication-group changes on an existing agent require a second
workflow based on `Machine Identity Updated`, or a reconciliation process.
