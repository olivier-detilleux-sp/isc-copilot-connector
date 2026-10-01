# Set up Copilot Studio on a new Entra source

This is the path for a new Identity Security Cloud tenant. The Microsoft Entra SaaS connector aggregates users, groups, service principals, and Copilot Studio agents. This repository adds publication data, connection account names, and Entra sponsor and owner emails, then maps publication groups onto the machine identity.

SailPoint Agentic Fabric is required for Copilot Studio aggregation. See [Microsoft Copilot Studio Agents Management](https://documentation.sailpoint.com/connectors/saas/msentraid/help/saas_connectivity/microsoft_entra_id/copilot_studio_agents.html).

## 1. Create the Entra source

Create a Microsoft Entra SaaS source and configure the connection the way SailPoint documents it. Do not duplicate that setup here.

- [Integrating SailPoint with Microsoft Entra SaaS](https://documentation.sailpoint.com/connectors/saas/msentraid/help/saas_connectivity/microsoft_entra_id/integrating_sailpoint_microsoft_entra_id.html)
- [Connection Settings](https://documentation.sailpoint.com/connectors/saas/msentraid/help/saas_connectivity/microsoft_entra_id/connection_settings.html)
- [Required Permissions](https://documentation.sailpoint.com/connectors/saas/msentraid/help/saas_connectivity/microsoft_entra_id/administrator_permission.html)

Use the same app registration for the source and for the customizer. Client id, client secret, and domain name are read from the source configuration.

## 2. Prerequisites for Copilot Studio agents

The Entra connector permissions above are not enough to read Copilot Studio agents or their Entra agent identities.

### Power Platform application user

Add the source service principal as an application user on every Power Platform environment that hosts agents. In the [Power Platform admin center](https://admin.powerplatform.microsoft.com): **Manage > (environment) > Settings > Users + permissions > Application users > New app user**.

Assign one custom Dataverse security role, for example `Copilot Studio Reader`, with Organization Read on the tables the customizer queries. The role, the privileges, and the Power Apps admin registration used to read connection account names are in [prerequisites.md](prerequisites.md).

SailPoint also documents a BotReader role and the Global Discovery Service Role on [Microsoft Copilot Studio Agents Management](https://documentation.sailpoint.com/connectors/saas/msentraid/help/saas_connectivity/microsoft_entra_id/copilot_studio_agents.html). Aggregation in this project does not need Write on `bot` or `botcomponent`. Write is only required if you use the connector to activate or deactivate agents.

### Microsoft Graph application permissions

Grant these on the source app registration and give admin consent. They are in addition to the connector permissions in the SailPoint page above.

| Permission | Why |
|---|---|
| `AgentIdentity.Read.All` | The connector aggregates agent identities (`servicePrincipalType` `ServiceIdentity`). `Application.Read.All` does not return them. The customizer lists owners with `GET /servicePrincipals/{id}/microsoft.graph.agentIdentity/owners`. |
| `AgentIdentity.ReadWrite.All` | Least-privileged application permission Microsoft documents for listing sponsors. |
| `User.Read.All` | Resolves `mail` or `userPrincipalName` when the sponsor or owner object has no email. |

Microsoft lists agent identities with `GET /servicePrincipals/microsoft.graph.agentIdentity`. The Copilot agent attribute `entraIdentityId` is that object id.

`Group.Read.All` is not required. Group names come from entitlements the Entra source already aggregates.

## 3. Entra source settings

### Machine Identity Governance Settings

On the source, open **Machine Identity Governance Settings** and select **Enable Microsoft Copilot Studio Agents**. Save. This is the switch documented in [Microsoft Copilot Studio Agents Management](https://documentation.sailpoint.com/connectors/saas/msentraid/help/saas_connectivity/microsoft_entra_id/copilot_studio_agents.html).

### Feature Management

Open **Feature Management** and follow [Manage Microsoft Entra Service Principals as Accounts](https://documentation.sailpoint.com/connectors/saas/msentraid/help/saas_connectivity/microsoft_entra_id/manage_service_principals.html).

1. Select **Manage Microsoft Entra Service Principals as Accounts**.
2. Set **Service Principal Account Filter** so agent identities are included. The connector default is `servicePrincipalType eq 'Application'`, which skips them. At least:

   ```
   servicePrincipalType in ('ServiceIdentity')
   ```

   To keep application and legacy principals as well:

   ```
   servicePrincipalType in ('Application', 'Legacy', 'ServiceIdentity')
   ```

3. Select **Manage Role Memberships**.
4. Select **Manage Application Role Memberships**.

### Account schema

On the account schema, add:

| Name | Type | Entitlement | Multi-valued |
|---|---|---|---|
| `appRoleAssignments` | `applicationRole` | yes | yes |

Then refresh the service principal account attributes that the feature writes onto the schema. Turn off **Include Attributes in Schema for managing azure Service Principal as account**, save, turn it back on, and save. Confirm `appRoleAssignments` is still present. If the toggle removed it, add it again.

### Machine accounts

Under machine accounts, create a subtype named **Agent Identity**.

**Classification.** Enable classification.

- If only agent identities should become machine accounts, remove the existing rules and add one rule: account attribute `spn_servicePrincipalType` **Equals** `ServiceIdentity`.
- If the current rules must stay, add that same rule immediately after `spn_servicePrincipalType` **Equals** `Legacy`.

**Mappings.** For the account subtype, use `spn_servicePrincipalType` as the account attribute.

## 4. Dataset Management

Open **Dataset Management** and select **Microsoft Copilot Studio**.

Identity Security Cloud drops attributes that are not on the resource schema. Add the attributes below before the first aggregation that uses the customizer. Other Copilot resources (knowledge, MCP servers) stay on the connector schema. This customizer does not write to them.

### Microsoft Copilot Studio Agent

The connector already aggregates `entraIdentityId`, `orgApiUrl`, and `owner`. `orgApiUrl` is the Dataverse host. Do not store a Dataverse URL on the source.

Add:

| Attribute | Type | Multi-valued | Entitlement | Written by |
|---|---|---|---|---|
| `accesscontrolpolicy` | String | no | no | Customizer, from Dataverse `bot.accesscontrolpolicy` (`0` Any, `1` Copilot readers, `2` Group membership, `3` Any multi-tenant) |
| `accesscontrolpolicyName` | String | no | no | Customizer label for that policy |
| `authorizedsecuritygroupids` | String | yes | no | Customizer. Dataverse stores one comma-separated string. The customizer splits it into Entra group object ids. Not an entitlement and not mapped to the Entra `group` schema. |
| `additionalOwners` | String | yes | no | Customizer. Email addresses of the Entra agent identity sponsors, then owners. `mail`, otherwise `userPrincipalName`. The same address is stored once. Object ids are not stored. |

This resource is where owner correlation and additional-owners correlation are configured:

- Primary owner: the connector attribute `owner` (UPN or email).
- Additional owners: `additionalOwners` (Entra sponsors and owners).

### Microsoft Copilot Studio Tool

Add these string attributes. They are not entitlements and not multi-valued. When a tool has several connection references, the customizer joins the values with a comma.

| Attribute | Written by |
|---|---|
| `connectionReference` | Dataverse connection reference logical name |
| `connectionId` | Power Platform connection id |
| `accountName` | `connectioninstance.accountname` when that table has a row, otherwise `properties.accountName` from the Power Apps admin connection list |

A tool uses `orgApiUrl` on its own record when that attribute is present, otherwise the host from another record in the same response.

## 5. Save the source

Save the source after the schema and dataset changes. A later save of the Entra configuration form can drop connector attributes that the form does not show. `environmentId` is one of those. The customizer uses it only for the Power Apps account-name fallback. When it is absent, the customizer uses the demo environment `Default-dce21e66-3a03-4ea3-b0c7-ffdc0729c732`, which is wrong for another tenant.

Set it with `updateSourceV1` (`PATCH /sources/v1/{id}`, content type `application/json-patch+json`):

```json
[{ "op": "add", "path": "/connectorAttributes/environmentId", "value": "Default-{entra-tenant-guid}" }]
```

`Default-{entra-tenant-guid}` is the Global Discovery environment id, not the Dataverse organization id. Skip this patch when tool account names are not required.

The customizer ignores a `dataverseUrl` connector attribute.

## 6. Build and upload the customizer

Clone the repository:

```bash
git clone https://github.com/olivier-detilleux-sp/isc-copilot-connector.git
cd isc-copilot-connector/customizer
npm install
npm test
npm run build
```

Package the zip. `npm_package_name` and `npm_package_version` must be set, or the zip is named `undefined`.

```bash
export npm_package_name=copilot-tool-resource-customizer
export npm_package_version=0.1.0
npx spcx package
```

The zip is `dist/copilot-tool-resource-customizer-0.1.0.zip`.

Point the SailPoint CLI at the tenant with `--env`. Do not pass `--debug`. Debug logging prints the access token.

```bash
sail --env <env> connectors customizers create "Copilot Studio"
sail --env <env> connectors customizers upload -c <customizer-id> -f dist/copilot-tool-resource-customizer-0.1.0.zip
sail --env <env> connectors instances list
sail --env <env> connectors customizers link -c <customizer-id> -i <connector-instance-id>
```

`create` prints the customizer id. `instances list` shows the Entra source connector instance. Linking is required. The next aggregation uses the latest uploaded version of the linked customizer.

On `company24740-poc` the linked customizer is `6631cedd-b67e-4289-9688-890dbb7eb0ac`, version 4, image `cb44834a-e05c-443d-86f1-273d04780d39`. A new tenant needs its own customizer and its own link.

## 7. Deploy the workflow

`workflows/map-copilot-agent-user-entitlements.json` is an export from `company24740-poc`, where the workflow is enabled. Behavior is described in [user-entitlements-workflow.md](user-entitlements-workflow.md). On a new tenant, review the file before you enable it.

Before you enable it on a new tenant:

1. Replace every `https://company24740-poc.api.identitynow-demo.com` host with the target API host. Demo tenants use `https://{tenant}.api.identitynow-demo.com`. Other tenants use `https://{tenant}.api.identitynow.com`.
2. In **Get Group Entitlement**, replace the hardcoded source id `bbc7c864783d44e5b4e0022bd85d7a11` with the new Entra source id. **Get Machine Account** already filters with `{{$.trigger.machineIdentity.sourceId}}`.
3. Replace the workflow owner with an identity in the target tenant. Remove the exported workflow id when you create a new workflow.
4. Configure authentication on every HTTP Request step. The export only stores a reference to an OAuth parameter that exists in `company24740-poc`. Create **OAuth 2.0 - Client Credentials Grant** for the target tenant (token URL, client id, client secret). The credential needs `idn:entitlement:read`, `idn:mis-identity:manage`, `idn:mis-account:read`, and `idn:mis-account:manage`. The machine identity PATCH and the machine account PATCH require the ORG_ADMIN user level.
5. Enable the workflow after those steps. Create it disabled, then enable it. `Machine Identity Created` cannot be simulated.

Create from the CLI after the file matches the target tenant:

```bash
sail --env <env> workflow create -f workflows/map-copilot-agent-user-entitlements.json
```

The client secret is not in the file. Finish the OAuth parameter in the UI, then enable the workflow.

## 8. Aggregate

Run aggregation in this order:

1. **Entitlements**, so Entra groups and application roles exist before anything references them.
2. **Accounts**, so service principals are aggregated and agent identities are classified as Agent Identity machine accounts.
3. **Microsoft Copilot Studio** dataset resources, so agents and tools are aggregated and the customizer can enrich them.

The workflow runs when a Copilot machine identity is created. Account aggregation first gives the service principal a chance to exist before that event. If the principal is aggregated later, this workflow does not retry the correlation.
