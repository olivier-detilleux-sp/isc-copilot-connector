#!/usr/bin/env python3
"""Read-only exploration of Copilot Studio agents in Dataverse.

Loads credentials from .env.local. Prints a sanitized summary only.
Never prints tokens, client secrets, authenticationconfiguration, or connection parameters.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.local"

SECRET_KEYS = {
    "access_token",
    "client_secret",
    "authenticationconfiguration",
    "credentials",
    "connectionparametersconfig",
    "connectionparametersetconfig",
    "connectionmetadata",
    "password",
    "iconbase64",
    "data",
    "content",
}


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def curl_json(args: list[str]) -> dict:
    completed = subprocess.run(
        ["curl", "-g", "-sS", "--fail-with-body", *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        detail = (completed.stdout or completed.stderr)[:800]
        raise SystemExit(f"curl failed ({completed.returncode}): {detail}")
    return json.loads(completed.stdout)


def token(tenant: str, client_id: str, client_secret: str, scope: str) -> str:
    payload = curl_json(
        [
            "-X",
            "POST",
            f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            "-H",
            "Content-Type: application/x-www-form-urlencoded",
            "--data-urlencode",
            f"client_id={client_id}",
            "--data-urlencode",
            f"client_secret={client_secret}",
            "--data-urlencode",
            f"scope={scope}",
            "--data-urlencode",
            "grant_type=client_credentials",
        ]
    )
    access = payload.get("access_token")
    if not access:
        error = payload.get("error")
        description = (payload.get("error_description") or "")[:400]
        raise SystemExit(f"token failed for {scope}: {error} {description}")
    return access


def post_json(url: str, access_token: str, body: dict) -> dict:
    return curl_json(
        [
            "-X",
            "POST",
            url,
            "-H",
            f"Authorization: Bearer {access_token}",
            "-H",
            "Accept: application/json",
            "-H",
            "Content-Type: application/json",
            "-H",
            "OData-MaxVersion: 4.0",
            "-H",
            "OData-Version: 4.0",
            "--data",
            json.dumps(body),
        ]
    )


def credential_signals(text: str | None) -> dict:
    if not text:
        return {
            "credentialMode": None,
            "actionKind": None,
            "dialogKind": None,
            "mcp": False,
            "operationId": None,
            "connectionReference": None,
        }
    properties = re.search(
        r"connectionProperties[\s\S]{0,180}?mode\s*:\s*\"?(Maker|Invoker)\"?",
        text,
        re.I,
    )
    generic = re.search(r"\bmode\s*:\s*\"?(Maker|Invoker)\"?", text, re.I)
    mode = properties.group(1) if properties else (generic.group(1) if generic else None)
    action = re.search(r"kind\s*:\s*\"?(Invoke[A-Za-z]+)\"?", text)
    operation = re.search(r"operationId\s*:\s*\"?([A-Za-z0-9_\-]+)\"?", text)
    reference = re.search(r"connectionReference\s*:\s*\"?([A-Za-z0-9_\-]+)\"?", text)
    dialog = "TaskDialog" if re.search(r"kind\s*:\s*\"?TaskDialog\"?", text) else None
    action_kind = action.group(1) if action else None
    return {
        "credentialMode": mode,
        "actionKind": action_kind,
        "dialogKind": dialog,
        "mcp": "ModelContextProtocolMetadata" in text or action_kind == "InvokeExternalAgentTaskAction",
        "operationId": operation.group(1) if operation else None,
        "connectionReference": reference.group(1) if reference else None,
    }


def get_json(url: str, access_token: str, headers: dict[str, str] | None = None) -> dict:
    curl_args = [
        url,
        "-H",
        f"Authorization: Bearer {access_token}",
        "-H",
        "Accept: application/json",
    ]
    for key, value in (headers or {}).items():
        curl_args.extend(["-H", f"{key}: {value}"])
    return curl_json(curl_args)


def odata(base: str, path: str, access_token: str) -> dict:
    return get_json(
        base.rstrip("/") + path,
        access_token,
        {
            "OData-MaxVersion": "4.0",
            "OData-Version": "4.0",
            "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=50',
        },
    )


def scrub(value):
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            if key in SECRET_KEYS or key.lower() in SECRET_KEYS:
                cleaned[key] = f"<redacted len={len(str(item))}>"
            elif key.startswith("@odata") and "nextLink" in key:
                cleaned[key] = "<nextLink>"
            else:
                cleaned[key] = scrub(item)
        return cleaned
    if isinstance(value, list):
        return [scrub(item) for item in value]
    if isinstance(value, str) and len(value) > 500:
        return value[:200] + f"...<truncated {len(value)}>"
    return value


def main() -> None:
    env = load_env(ENV_PATH)
    tenant = env["AZURE_TENANT_ID"]
    client_id = env["AZURE_CLIENT_ID"]
    client_secret = env["AZURE_CLIENT_SECRET"]
    dataverse = env["DATAVERSE_URL"]
    graph_id = env.get("GRAPH_CLIENT_ID") or client_id
    graph_secret = env.get("GRAPH_CLIENT_SECRET") or client_secret

    dv = token(tenant, client_id, client_secret, f"{dataverse}/.default")
    print("dataverse_token=ok", file=sys.stderr)

    select = (
        "botid,name,schemaname,statecode,statuscode,authenticationmode,"
        "authenticationtrigger,accesscontrolpolicy,authorizedsecuritygroupids,"
        "publishedon,language,origin,modifiedon,synchronizationstatus"
    )
    bots = odata(
        dataverse,
        f"/api/data/v9.2/bots?$select={select}&$expand=owninguser($select=fullname,internalemailaddress,domainname)&$top=50",
        dv,
    )
    rows = bots.get("value", [])
    print(f"bots={len(rows)}", file=sys.stderr)

    summary = []
    for bot in rows:
        summary.append(
            {
                "botid": bot.get("botid"),
                "name": bot.get("name"),
                "schemaname": bot.get("schemaname"),
                "statecode": bot.get("statecode"),
                "statuscode": bot.get("statuscode"),
                "status": bot.get("statuscode@OData.Community.Display.V1.FormattedValue"),
                "authenticationmode": bot.get("authenticationmode"),
                "authenticationmode_label": bot.get(
                    "authenticationmode@OData.Community.Display.V1.FormattedValue"
                ),
                "authenticationtrigger": bot.get("authenticationtrigger"),
                "authenticationtrigger_label": bot.get(
                    "authenticationtrigger@OData.Community.Display.V1.FormattedValue"
                ),
                "accesscontrolpolicy": bot.get("accesscontrolpolicy"),
                "accesscontrolpolicy_label": bot.get(
                    "accesscontrolpolicy@OData.Community.Display.V1.FormattedValue"
                ),
                "authorizedsecuritygroupids": bot.get("authorizedsecuritygroupids"),
                "publishedon": bot.get("publishedon"),
                "origin": bot.get("origin"),
                "owner": (bot.get("owninguser") or {}).get("internalemailaddress"),
                "ownerName": (bot.get("owninguser") or {}).get("fullname"),
            }
        )
    print(json.dumps({"agents": summary}, indent=2, ensure_ascii=False))

    graph_names: dict[str, str] = {}
    graph_error = None
    try:
        graph = token(tenant, graph_id, graph_secret, "https://graph.microsoft.com/.default")
        print("graph_token=ok", file=sys.stderr)
        group_ids = set()
        for bot in rows:
            raw_ids = bot.get("authorizedsecuritygroupids") or ""
            for group_id in raw_ids.split(","):
                group_id = group_id.strip()
                if group_id:
                    group_ids.add(group_id)
        for group_id in sorted(group_ids):
            try:
                group = get_json(
                    f"https://graph.microsoft.com/v1.0/groups/{group_id}?$select=id,displayName,securityEnabled,mailEnabled,groupTypes",
                    graph,
                )
                graph_names[group_id] = group.get("displayName") or ""
                print(
                    json.dumps(
                        {
                            "group": {
                                "id": group.get("id"),
                                "displayName": group.get("displayName"),
                                "securityEnabled": group.get("securityEnabled"),
                                "mailEnabled": group.get("mailEnabled"),
                                "groupTypes": group.get("groupTypes"),
                            }
                        },
                        ensure_ascii=False,
                    )
                )
            except SystemExit as error:
                print(json.dumps({"groupId": group_id, "graphError": str(error)[:300]}))
    except SystemExit as error:
        graph_error = str(error)
        print(json.dumps({"graph": graph_error[:500]}))

    if not rows:
        return

    sample_ids = [
        "359079c7-3934-f111-88b4-7c1e52fbe77d",
        "7e98d84b-5a98-f011-b4cc-000d3ab3bad1",
        "3a1815b0-cd37-f111-88b4-7c1e52fbe77d",
    ]
    for bot_id in sample_ids:
        try:
            shares = post_json(
                dataverse.rstrip("/") + "/api/data/v9.2/RetrieveSharedPrincipalsAndAccess",
                dv,
                {
                    "Target": {
                        "@odata.type": "Microsoft.Dynamics.CRM.bot",
                        "botid": bot_id,
                    }
                },
            )
        except SystemExit as error:
            print(json.dumps({"botid": bot_id, "shareError": str(error)[:500]}))
            continue
        print(json.dumps({"botid": bot_id, "shares": scrub(shares)}, ensure_ascii=False)[:4000])

    bot_id = "359079c7-3934-f111-88b4-7c1e52fbe77d"
    component_query = urllib.parse.urlencode(
        {
            "$select": "botcomponentid,name,schemaname,componenttype,category,description,data,_parentbotid_value",
            "$expand": "botcomponent_connectionreference($select=connectionreferenceid,connectionreferencelogicalname,connectionreferencedisplayname,connectionid,connectorid)",
            "$filter": f"_parentbotid_value eq {bot_id}",
        },
        safe="(),$",
    )
    components = odata(dataverse, "/api/data/v9.2/botcomponents?" + component_query, dv)
    type_counts: dict[str, int] = {}
    component_rows = []
    connection_ids: set[str] = set()
    for component in components.get("value", []):
        label = str(
            component.get("componenttype@OData.Community.Display.V1.FormattedValue")
            or component.get("componenttype")
        )
        type_counts[label] = type_counts.get(label, 0) + 1
        signals = credential_signals(component.get("data"))
        references = []
        for reference in component.get("botcomponent_connectionreference") or []:
            if reference.get("connectionid"):
                connection_ids.add(reference["connectionid"])
            references.append(
                {
                    "id": reference.get("connectionreferenceid"),
                    "logicalName": reference.get("connectionreferencelogicalname"),
                    "displayName": reference.get("connectionreferencedisplayname"),
                    "connectionId": reference.get("connectionid"),
                    "connectorId": reference.get("connectorid"),
                }
            )
        if signals["actionKind"] or signals["mcp"] or component.get("componenttype") in (15, 16) or references:
            component_rows.append(
                {
                    "botcomponentid": component.get("botcomponentid"),
                    "name": component.get("name"),
                    "componenttype": component.get("componenttype"),
                    "componenttype_label": label,
                    "category": component.get("category"),
                    **signals,
                    "connectionReferences": references,
                }
            )
    print(
        json.dumps(
            {
                "sampleBotId": bot_id,
                "componentCount": len(components.get("value", [])),
                "componentTypes": type_counts,
                "interestingComponents": component_rows,
            },
            indent=2,
            ensure_ascii=False,
        )
    )

    if connection_ids:
        quoted = ",".join(f"'{item}'" for item in sorted(connection_ids))
        instance_query = urllib.parse.urlencode(
            {
                "$select": "connectioninstanceid,connectioninternalid,accountname,connectionstatus,connectioninstancedisplayname,connectorinternalid,_connectionreferenceid_value,_credentialid_value",
                "$filter": f"Microsoft.Dynamics.CRM.In(PropertyName='connectioninternalid',PropertyValues=[{quoted}])",
            },
            safe="()',$",
        )
        try:
            instances = odata(dataverse, "/api/data/v9.2/connectioninstances?" + instance_query, dv)
            print(json.dumps({"connectionInstances": scrub(instances.get("value", []))}, indent=2, ensure_ascii=False)[:6000])
        except SystemExit as error:
            print(json.dumps({"connectionInstanceError": str(error)[:500]}))


if __name__ == "__main__":
    main()
