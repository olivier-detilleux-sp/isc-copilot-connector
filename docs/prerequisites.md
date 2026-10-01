# Prerequisites

The setup sequence is [setup.md](setup.md). This page is the Dataverse role, the Graph permissions, and the customizer read behavior.

The customizer reads Copilot Studio data from the Dataverse environment named by `orgApiUrl` on each aggregated agent. Use one Entra app registration and one Dataverse security role. It writes Entra group object ids onto the agent, and email addresses of the agent identity's sponsors and owners.

Do not grant System Administrator, Microsoft Copilot Administrator, or write access for aggregation.

## Entra ID application

1. Create an app registration.
2. Create a client secret. Store it in `.env.local` only. That file is gitignored.
3. Add the application as a Dataverse application user in the target environment. In [Power Platform admin center](https://admin.powerplatform.microsoft.com): **Manage > Environments > (environment) > Settings > Users + permissions > Application users**.
4. `Group.Read.All` is not required for this customizer. Group display names come from entitlements the Microsoft Entra source already aggregates.
5. Grant the Entra source application these Microsoft Graph application permissions, and give admin consent.

   | Permission | Why |
   |---|---|
   | `AgentIdentity.Read.All` | The Entra connector aggregates agent identities (`servicePrincipalType` `ServiceIdentity`). `Application.Read.All` does not return them. The customizer lists owners with `GET /servicePrincipals/{id}/microsoft.graph.agentIdentity/owners`. |
   | `AgentIdentity.ReadWrite.All` | Least-privileged application permission Microsoft documents for `GET /servicePrincipals/{id}/microsoft.graph.agentIdentity/sponsors`. |
   | `User.Read.All` | Resolves `mail` or `userPrincipalName` when the owner or sponsor object does not already include an email. |

   Microsoft lists agent identities with `GET /servicePrincipals/microsoft.graph.agentIdentity`. The Copilot agent attribute `entraIdentityId` is that agent identity's object id. Include `ServiceIdentity` in the source's service principal account filter, for example `servicePrincipalType in ('Application', 'Legacy', 'ServiceIdentity')`.

Token scopes:

| API | Scope |
|---|---|
| Dataverse | `https://{org}.api.{region}.dynamics.com/.default` |
| Power Apps | `https://service.powerapps.com/.default` |
| Microsoft Graph | `https://graph.microsoft.com/.default` |

The same client id and secret request each token. `{org}` comes from `orgApiUrl` on the aggregated record. See the README.

## Dataverse security role

Create one custom role, for example `Copilot Studio Reader`, on the root business unit. Assign only that role to the application user.

In the security role editor, set **Read** to **Organization** on these tables. Leave Create, Write, Delete, Append, Assign, and Share empty.

| Table in the role editor | Logical name | Why |
|---|---|---|
| Agent | `bot` | Agents, publication audience, `publishedon` |
| Copilot component | `botcomponent` | Tools, knowledge, MCP servers, and the component `data` payload |
| Connection Reference | `connectionreference` | Connector and the Power Platform connection id used by a tool |
| Connection Instance | `connectioninstance` | Connected account name, when the environment stores instances |
| User | `systemuser` | Agent owner name and email |

Organization level is required. These rows are owned by makers. User-level Read only returns rows the application user owns.

Reference for the admin center path: [Configure user security in an environment](https://learn.microsoft.com/en-us/power-platform/admin/database-security-configure). Assign the role from **Settings > Users + permissions > Application users > Edit security roles**. See [Manage application users](https://learn.microsoft.com/en-us/power-platform/admin/manage-application-users).

Privilege names behind those checks:

- `prvReadbot`
- `prvReadbotcomponent`
- `prvReadconnectionreference`
- `prvReadConnectionInstance`
- `prvReadUser`

The link from a component to a connection reference is the intersect table `botcomponent_connectionreferenceset`. Reading it succeeded with Read on Copilot component. `$expand=botcomponent_connectionreference` returned an empty list in this environment, so the connector should read the intersect rows directly.

### Do not add

- **Credential** (`credential`, privilege `prvReadcredential`). This is the Power Automate credential table. Copilot Studio tool connections found here are connection references, not rows in that table. The `credentials` column can hold secret material.
- **Team** read. `RetrieveSharedPrincipalsAndAccess` on an agent returns the internal Copilot Studio authoring team (`Chatbotmanager`), not the publication audience.
- Write privileges copied from Bot Contributor or Bot Viewer.

Do not select these columns, even if table Read would allow it: `authenticationconfiguration`, `iconbase64`, `connectionparametersconfig`, `connectionparametersetconfig`, `connectionmetadata`, `credentials`.

## Publication audience

Read these columns on `bot`. Definitions: [bot table](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/bot).

| Column | Use |
|---|---|
| `publishedon` | Empty means the agent has not been published. `statuscode` 1 (Provisioned) is not a publish timestamp. |
| `accesscontrolpolicy` | `0` Any, `1` Copilot readers, `2` Group membership, `3` Any (multi-tenant). |
| `authorizedsecuritygroupids` | Comma-separated Entra group object ids, maximum 20. Microsoft ignores this column unless `accesscontrolpolicy` is `2`. A value may still be stored on an agent whose policy is `0`. |

The customizer splits that column into one value per group object id. On the AZURE-AL agent schema the attribute stays a multi-valued string. It is not an entitlement and it is not mapped to the Entra `group` schema.

## Entra sponsors and owners

For each agent with `entraIdentityId`, the customizer reads the agent identity and writes `additionalOwners`. The attribute is already on the AZURE-AL agent schema (`09c5705b3ecd45e39515761f29d3284d`): string, multi-valued, not an entitlement. Each value is an email address: `mail` when it is present, otherwise `userPrincipalName`.

Sponsors are listed first, then owners. The same address is stored once. A directory object with neither address is omitted. Object ids are not stored. If both list calls fail, the attribute is left unset. Publication fields from Dataverse are still written. Version 4 of customizer `6631cedd-b67e-4289-9688-890dbb7eb0ac` (image `cb44834a-e05c-443d-86f1-273d04780d39`) is the build that does this.

```http
GET https://graph.microsoft.com/v1.0/servicePrincipals/{entraIdentityId}/microsoft.graph.agentIdentity/sponsors?$select=id,mail,userPrincipalName
GET https://graph.microsoft.com/v1.0/servicePrincipals/{entraIdentityId}/microsoft.graph.agentIdentity/owners?$select=id,mail,userPrincipalName
GET https://graph.microsoft.com/v1.0/users/{id}?$select=mail,userPrincipalName
```

References: [List agentIdentity sponsors](https://learn.microsoft.com/en-us/graph/api/agentidentity-list-sponsors?view=graph-rest-1.0), [List agentIdentity owners](https://learn.microsoft.com/en-us/graph/api/agentidentity-list-owners?view=graph-rest-1.0).

## Connected account name

Dataverse `connectionreference.connectionid` is the Power Platform connection id. It is not the signed-in account. `connectioninstance.accountname` is the account name when that table has rows. In `fam_demo (default)` the table is empty, and `connectionparametersconfig` is empty too.

The account name is `properties.accountName` on the Power Platform connection. Reading it requires a token for `https://service.powerapps.com/.default`. A direct read of one connection returns `ConnectionAuthorizationFailed`. The customizer lists connections with the admin route behind [Get-AdminPowerAppConnection](https://learn.microsoft.com/en-us/powershell/module/microsoft.powerapps.administration.powershell/get-adminpowerappconnection) and matches `connectionid`:

```http
GET https://api.powerapps.com/providers/Microsoft.PowerApps/scopes/admin/environments/{environmentId}/connections?api-version=2016-11-01
```

`environmentId` for this demo environment is `Default-dce21e66-3a03-4ea3-b0c7-ffdc0729c732` (`EnvironmentId` from Global Discovery, not the Dataverse organization id). For a Power Platform administrator the cmdlet searches the tenant.

`fam_demo (default)` has a Dataverse database. [Set-AdminPowerAppEnvironmentRoleAssignment](https://learn.microsoft.com/en-us/powershell/module/microsoft.powerapps.administration.powershell/set-adminpowerappenvironmentroleassignment) with `EnvironmentAdmin` applies only to environments without Dataverse and returns 403 here. Assign the Entra directory role **Power Platform Administrator** to the service principal instead. That role is tenant-wide: it can administer every environment, not only this one. It does not by itself add the Dataverse System Administrator role. Do not self-elevate. See [Use service admin roles to manage your tenant](https://learn.microsoft.com/en-us/power-platform/admin/use-service-admin-role-manage-tenant).

A Privileged Role Administrator assigns it in [Microsoft Entra admin center](https://entra.microsoft.com): **Identity > Roles and admins > Power Platform Administrator > Add assignments**, and selects the enterprise application **SailPoint Integration (IDN + IIQ)**. Assignment steps: [Assign Microsoft Entra roles](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/manage-roles-portal).

```powershell
Connect-MgGraph -Scopes "RoleManagement.ReadWrite.Directory"
$sp = Get-MgServicePrincipal -Filter "appId eq '51c2bfcb-a325-40ab-abd8-7eb59c846639'"
$role = Get-MgRoleManagementDirectoryRoleDefinition -Filter "displayName eq 'Power Platform Administrator'"
New-MgRoleManagementDirectoryRoleAssignment -DirectoryScopeId "/" -PrincipalId $sp.Id -RoleDefinitionId $role.Id
```

`$sp.Id` must be the service principal object id (`c3171506-a0d7-4efd-b365-afd68ef4c9f8`), not only the application id.

That directory role alone does not authorize the Business App Platform admin APIs. An administrator signed in as a user must also register the existing app. The service principal cannot register itself. See [Creating a service principal application using API](https://learn.microsoft.com/en-us/power-platform/admin/powerplatform-api-create-service-principal).

The legacy Power Apps modules require **Windows PowerShell 5.1** and .NET Framework. They are not compatible with PowerShell 7 or macOS. Run the following on a Windows workstation or Windows VM:

```powershell
$tenantId = "dce21e66-3a03-4ea3-b0c7-ffdc0729c732"
$appId = "51c2bfcb-a325-40ab-abd8-7eb59c846639"

Install-PackageProvider -Name NuGet -Force
Install-Module -Name Microsoft.PowerApps.Administration.PowerShell -Scope CurrentUser -Force
Install-Module -Name Microsoft.PowerApps.PowerShell -AllowClobber -Scope CurrentUser -Force

Import-Module Microsoft.PowerApps.Administration.PowerShell
Import-Module Microsoft.PowerApps.PowerShell

# Sign in interactively as a Power Platform Administrator.
Add-PowerAppsAccount -Endpoint prod -TenantID $tenantId

# Register the existing application as a Power Platform management application.
New-PowerAppManagementApp -ApplicationId 51c2bfcb-a325-40ab-abd8-7eb59c846639

# Verify the registration.
Get-PowerAppManagementApps
```

`New-PowerAppManagementApp` is documented at [New-PowerAppManagementApp](https://learn.microsoft.com/en-us/powershell/module/microsoft.powerapps.administration.powershell/new-powerappmanagementapp). Do not run `pac admin create-service-principal` for this app: that command creates a new application. Do not select `connectionParameters`.

Sharing one connection with `CanView` is enough for that connection only. It does not list the others.

## What this environment showed

Checked against `https://orgc563e116.api.crm4.dynamics.com` after `Connector Copilot Reader` was added.

Connection references are readable. A tool points at a reference such as `cr1d4_MyHRAgent.shared_googledrive.{id}`. The reference row then has:

- `connectorid`: `/providers/Microsoft.PowerApps/apis/shared_googledrive`
- `connectionid`: the Power Platform connection id

`connectioninstances` is readable and contains no rows. There is no `accountname` to aggregate until Copilot Studio writes instances. Maker versus end-user still comes from the component payload (`connectionProperties.mode` = `Maker` or `Invoker`), not from this table.

The application user `51c2bfcb-a325-40ab-abd8-7eb59c846639` currently also has Bot Contributor, Bot Reader, Bot Viewer, Global Discovery Service Role, and Microsoft Copilot Administrator. Those roles are not required for this read. Bot Reader in particular includes customization, plug-in, and workflow reads. After `Copilot Studio Reader` is assigned and a read of agents, components, and connection references succeeds, remove the extra roles.
