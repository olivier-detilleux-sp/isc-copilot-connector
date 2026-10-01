# Set up Copilot Studio on a new Entra source

This is the path for a new Identity Security Cloud tenant. The Microsoft Entra SaaS connector aggregates users, groups, service principals, and Copilot Studio agents. This repository adds publication data, connection account names, and Entra sponsor and owner emails, then maps publication groups onto the machine identity.

SailPoint Agentic Fabric is required for Copilot Studio aggregation. See [Microsoft Copilot Studio Agents Management](https://documentation.sailpoint.com/connectors/saas/msentraid/help/saas_connectivity/microsoft_entra_id/copilot_studio_agents.html).

## 1. Create the Entra source

Create a Microsoft Entra SaaS source and configure the connection the way SailPoint documents it. Do not duplicate that setup here.

- [Integrating SailPoint with Microsoft Entra SaaS](https://documentation.sailpoint.com/connectors/saas/msentraid/help/saas_connectivity/microsoft_entra_id/integrating_sailpoint_microsoft_entra_id.html)
- [Connection Settings](https://documentation.sailpoint.com/connectors/saas/msentraid/help/saas_connectivity/microsoft_entra_id/connection_settings.html)
- [Required Permissions](https://documentation.sailpoint.com/connectors/saas/msentraid/help/saas_connectivity/microsoft_entra_id/administrator_permission.html)

Use the same app registration for the source and for the customizer. Client id, client secret, and domain name are read from the source configuration.

## 2. Grant the app access to Copilot Studio and agent identities

Use the same app registration as the Entra source. Create the Dataverse role before the application user, so the user can receive it immediately.

### Dataverse security role

In the [Power Platform admin center](https://admin.powerplatform.microsoft.com), open the environment, then **Settings > Users + permissions > Security roles**. Create a custom role on the root business unit, for example `Copilot Studio Reader`.

On **Custom Tables**, set **Read** to **Organization** for these tables. Leave every other privilege empty.

| Table in the role editor | Logical name | Used for |
|---|---|---|
| Agent | `bot` | Agents and publication (`accesscontrolpolicy`, `authorizedsecuritygroupids`) |
| Copilot component | `botcomponent` | Tools, and the link from a tool to its connection reference |
| Connection Reference | `connectionreference` | Connection reference name and connection id |
| Connection Instance | `connectioninstance` | Connected account name, when the environment stores instances |

Organization level is required. These rows are owned by makers. [prerequisites.md](prerequisites.md) lists the privilege names and the columns the customizer does not read.

### Application user

Still in that environment, go to **Settings > Users + permissions > Application users > New app user**. Add the source service principal. Assign:

- the custom role you just created
- the built-in **Global Discovery Service Role**, which the Entra connector uses to list Power Platform environments

Repeat this for every environment that hosts agents you want to aggregate.

### Power Platform Administrator

The customizer reads `accountName` from the Power Apps admin connection list when `connectioninstance` has no row. That call needs two things:

1. A Privileged Role Administrator assigns the directory role **Power Platform Administrator** to the source service principal. In the [Microsoft Entra admin center](https://entra.microsoft.com): **Identity > Roles and admins > Power Platform Administrator > Add assignments**.
2. An administrator signed in as a user registers this existing app. The service principal cannot register itself. On Windows PowerShell 5.1:

```powershell
Install-Module Microsoft.PowerApps.Administration.PowerShell -Scope CurrentUser -Force
Import-Module Microsoft.PowerApps.Administration.PowerShell
Add-PowerAppsAccount -Endpoint prod -TenantID <entra-tenant-guid>
New-PowerAppManagementApp -ApplicationId <app-id>
```

[prerequisites.md](prerequisites.md) explains why this role is tenant-wide and why `New-PowerAppManagementApp` is the command to use.

### Microsoft Graph application permissions

On the app registration, add these application permissions and grant admin consent. They sit on top of the permissions in the SailPoint Entra connector page from step 1.

| Permission | Used for |
|---|---|
| `AgentIdentity.Read.All` | Aggregating agent identities (`servicePrincipalType` `ServiceIdentity`) and listing their owners |
| `AgentIdentity.ReadWrite.All` | Listing sponsors. This is the application permission Microsoft documents for that read |
| `User.Read.All` | `mail` or `userPrincipalName` when the sponsor or owner object has no email |

`entraIdentityId` on the Copilot agent is the agent identity object id.

## 3. Entra source settings

Edit the source from VS Code. Install the **SailPoint Identity Security Cloud** extension and the **SailPoint SaaS Connectivity** extension. In the ISC extension, add the tenant. Open the Entra source from that tenant, apply the settings in this section and in Dataset Management, then save. The same tenant is reused later to deploy the customizer.

You can make the same changes in the Identity Security Cloud admin UI. Saving from the extension is enough.

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

Save the source in the extension after the schema and dataset changes.

`environmentId` is not on the Entra configuration form. A later save of that form can drop it. The customizer uses it only for the Power Apps account-name fallback. When it is absent, the customizer uses the demo environment `Default-dce21e66-3a03-4ea3-b0c7-ffdc0729c732`, which is wrong for another tenant. Add it on the source in the extension, then save. The API equivalent is `updateSourceV1` (`PATCH /sources/v1/{id}`, content type `application/json-patch+json`):

```json
[{ "op": "add", "path": "/connectorAttributes/environmentId", "value": "Default-{entra-tenant-guid}" }]
```

`Default-{entra-tenant-guid}` is the Global Discovery environment id, not the Dataverse organization id. Skip this patch when tool account names are not required.

The customizer ignores a `dataverseUrl` connector attribute.

## 6. Upload the customizer

Clone the repository and install the dependencies:

```bash
git clone https://github.com/olivier-detilleux-sp/isc-copilot-connector.git
cd isc-copilot-connector/customizer
npm install
```

### VS Code extension

This is the simplest upload.

1. Open the `customizer` folder in VS Code.
2. The tenant is already in the ISC extension from the source setup above. Add it now if that step was skipped.
3. In the **SaaS Connectivity** section, click **+** and create a customizer. Give it a name.
4. Right-click that customizer and select **Deploy**.

Deploy builds the package and uploads it. Link the customizer to the Entra source from the same view if it is not already linked. The next aggregation uses the latest deployed version.

### SailPoint CLI

Use this when you are not deploying from the extension.

```bash
npm test
npm run build
export npm_package_name=copilot-tool-resource-customizer
export npm_package_version=0.1.0
npx spcx package
```

`npm_package_name` and `npm_package_version` must be set, or the zip is named `undefined`. The zip is `dist/copilot-tool-resource-customizer-0.1.0.zip`.

Point the CLI at the tenant with `--env`. Do not pass `--debug`. Debug logging prints the access token.

```bash
sail --env <env> connectors customizers create "Copilot Studio"
sail --env <env> connectors customizers upload -c <customizer-id> -f dist/copilot-tool-resource-customizer-0.1.0.zip
sail --env <env> connectors instances list
sail --env <env> connectors customizers link -c <customizer-id> -i <connector-instance-id>
```

`create` prints the customizer id. `instances list` shows the Entra source connector instance. Linking is required.

On `company24740-poc` the linked customizer is `6631cedd-b67e-4289-9688-890dbb7eb0ac`, version 4, image `cb44834a-e05c-443d-86f1-273d04780d39`. A new tenant needs its own customizer and its own link.

## 7. Deploy the workflow

`workflows/map-copilot-agent-user-entitlements.json` is an export from `company24740-poc`, where the workflow is enabled. Behavior is described in [user-entitlements-workflow.md](user-entitlements-workflow.md).

### VS Code extension

Use the tenant already configured in the ISC extension:

1. Open the **Workflows** section.
2. Import or upload `workflows/map-copilot-agent-user-entitlements.json`.
3. Open the imported workflow in the Identity Security Cloud UI.

### Identity Security Cloud UI

You can also import the JSON directly from the Workflows page in Identity Security Cloud. Import it as a disabled workflow.

### Review and configure

Review the workflow in the visual workflow editor. You do not need to edit the JSON file. Before enabling it:

1. Replace every `https://company24740-poc.api.identitynow-demo.com` host with the target API host. Demo tenants use `https://{tenant}.api.identitynow-demo.com`. Other tenants use `https://{tenant}.api.identitynow.com`.
2. In **Get Group Entitlement**, replace the hardcoded source id `bbc7c864783d44e5b4e0022bd85d7a11` with the new Entra source id. **Get Machine Account** already filters with `{{$.trigger.machineIdentity.sourceId}}`.
3. Set the workflow owner to an identity in the target tenant.
4. Configure authentication on every HTTP Request step. The export only stores a reference to an OAuth parameter that exists in `company24740-poc`. Create **OAuth 2.0 - Client Credentials Grant** for the target tenant (token URL, client id, client secret). The credential needs `idn:entitlement:read`, `idn:mis-identity:manage`, `idn:mis-account:read`, and `idn:mis-account:manage`. The machine identity PATCH and the machine account PATCH require the ORG_ADMIN user level.
5. Save, then enable the workflow. `Machine Identity Created` cannot be simulated.

### SailPoint CLI

The CLI is an alternative to the extension and UI:

```bash
sail --env <env> workflow create -f workflows/map-copilot-agent-user-entitlements.json
```

The client secret is not in the file. After creation, review and configure the workflow in the UI as described above, then enable it.

## 8. Aggregate

Run aggregation in this order:

1. **Entitlements**, so Entra groups and application roles exist before anything references them.
2. **Accounts**, so service principals are aggregated and agent identities are classified as Agent Identity machine accounts.
3. **Microsoft Copilot Studio** dataset resources, so agents and tools are aggregated and the customizer can enrich them.

The workflow runs when a Copilot machine identity is created. Account aggregation first gives the service principal a chance to exist before that event. If the principal is aggregated later, this workflow does not retry the correlation.
