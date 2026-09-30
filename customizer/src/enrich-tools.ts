/**
 * After-endpoint customizer for a tool resource aggregation.
 *
 * Web Services SaaS invokes customizedOperation when the endpoint has
 * isAfterCustomizer=true. The operation id is uniqueNameForEndPoint + ":after"
 * (documentation.sailpoint.com, endpoint_before_customize.html).
 *
 * Relevance AI on company24740-poc uses operationType
 * "Resource Aggregation-Tools" and uniqueNameForEndPoint
 * "List Relevance AI Tools". Microsoft Entra has no such endpoint, so the
 * caller also registers the Copilot tool schema name and resource id.
 * Handlers that the connector does not call are ignored.
 *
 * Agents receive the parent bot publication columns. Tools receive the
 * Dataverse connection reference and the account name of that connection.
 */

export interface ToolCustomizerConfig {
    clientID?: string
    clientId?: string
    clientSecret?: string
    client_secret?: string
    domainName?: string
    azureTenantId?: string
    tenantId?: string
    dataverseUrl?: string
    environmentId?: string
}

export interface FetchResponse {
    ok: boolean
    status: number
    json(): Promise<unknown>
    text(): Promise<string>
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<FetchResponse>

/** Global Discovery EnvironmentId for fam_demo (default), not the Dataverse org id. */
const DEFAULT_ENVIRONMENT_ID = 'Default-dce21e66-3a03-4ea3-b0c7-ffdc0729c732'

const COPILOT_TOOL_RESOURCE_ID = 'microsoft:copilot-tool'
const COPILOT_AGENT_RESOURCE_ID = 'microsoft:copilot-agent'
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const POLICY_LABELS: Record<string, string> = {
    '0': 'Any',
    '1': 'Copilot readers',
    '2': 'Group membership',
    '3': 'Any multi-tenant',
}

export async function enrichToolAggregation(
    config: ToolCustomizerConfig,
    input: unknown,
    fetchImpl: FetchLike = defaultFetch
): Promise<unknown> {
    const extracted = extractRecords(input)
    if (!extracted) {
        return input
    }

    const dataverseUrl = resolveDataverseUrl(config, extracted.records)
    if (!dataverseUrl) {
        return finish(extracted, input)
    }

    const clientId = config.clientID || config.clientId
    const clientSecret = config.clientSecret || config.client_secret
    const tenant = config.azureTenantId || config.tenantId || config.domainName
    if (!clientId || !clientSecret || !tenant) {
        return finish(extracted, input)
    }

    const token = await clientCredentialsToken(fetchImpl, tenant, clientId, clientSecret, dataverseUrl)
    if (!token) {
        return finish(extracted, input)
    }

    const bots = new Map<string, BotPublication | null>()
    const accounts = new Map<string, string | null>()
    let powerAppsToken: string | undefined

    for (const record of extracted.records) {
        const recordKind = kindOf(record)
        if (recordKind === 'agent') {
            await applyPublication(fetchImpl, dataverseUrl, token, record, bots)
            continue
        }
        if (recordKind === 'tool') {
            powerAppsToken = await applyConnection(
                fetchImpl,
                config,
                dataverseUrl,
                token,
                record,
                accounts,
                powerAppsToken
            )
        }
    }

    return finish(extracted, input)
}

interface ExtractedRecords {
    records: AnyRecord[]
    replaceResponse: boolean
}

type AnyRecord = Map<string, unknown> | Record<string, unknown>

interface BotPublication {
    policy: string
    label?: string
    groups?: string[]
}

function extractRecords(input: unknown): ExtractedRecords | undefined {
    if (!input || typeof input !== 'object') {
        return undefined
    }
    if (isConnectorRecord(input)) {
        return { records: [input], replaceResponse: false }
    }
    const body = input as Record<string, unknown>
    if (Array.isArray(body.processedResponseObject)) {
        return { records: body.processedResponseObject as AnyRecord[], replaceResponse: true }
    }
    const raw = rawResponseText(body.rawResponse)
    if (raw) {
        const parsed = parseJson(raw)
        const list = odataList(parsed)
        if (list) {
            return { records: list, replaceResponse: true }
        }
    }
    if (Array.isArray(input)) {
        return { records: input as AnyRecord[], replaceResponse: false }
    }
    return undefined
}

function finish(extracted: ExtractedRecords, input: unknown): unknown {
    if (!extracted.replaceResponse) {
        return input
    }
    return { data: extracted.records.map(toAttributeMap) }
}

function isConnectorRecord(input: object): input is AnyRecord {
    const body = input as { resourceId?: unknown; identity?: unknown; attributes?: unknown }
    const hasAttributes = !!body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes)
    const hasIdentity = typeof body.identity === 'string' || typeof body.resourceId === 'string'
    return hasAttributes && hasIdentity
}

function rawResponseText(raw: unknown): string | undefined {
    if (typeof raw === 'string') {
        return raw
    }
    if (raw && typeof raw === 'object' && typeof (raw as { response?: unknown }).response === 'string') {
        return (raw as { response: string }).response
    }
    return undefined
}

function odataList(parsed: unknown): AnyRecord[] | undefined {
    if (Array.isArray(parsed)) {
        return parsed as AnyRecord[]
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { value?: unknown }).value)) {
        return (parsed as { value: AnyRecord[] }).value
    }
    return undefined
}

function parseJson(raw: string): unknown {
    try {
        return JSON.parse(raw)
    } catch {
        return undefined
    }
}

function resolveDataverseUrl(config: ToolCustomizerConfig, records: AnyRecord[]): string | undefined {
    const configured = trimUrl(config.dataverseUrl)
    if (configured) {
        return configured
    }
    for (const record of records) {
        const fromRecord = trimUrl(asString(getAttr(record, 'orgApiUrl')))
        if (fromRecord) {
            return fromRecord
        }
    }
    return undefined
}

function trimUrl(value: string | undefined): string | undefined {
    if (!value) {
        return undefined
    }
    return value.replace(/\/+$/, '')
}

async function clientCredentialsToken(
    fetchImpl: FetchLike,
    tenant: string,
    clientId: string,
    clientSecret: string,
    dataverseUrl: string
): Promise<string | undefined> {
    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: `${dataverseUrl}/.default`,
        grant_type: 'client_credentials',
    })
    try {
        const response = await fetchImpl(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        })
        if (!response.ok) {
            return undefined
        }
        const payload = (await response.json()) as { access_token?: string }
        return payload.access_token
    } catch {
        return undefined
    }
}

type RecordKind = 'agent' | 'tool' | 'skip'

function kindOf(record: AnyRecord): RecordKind {
    const resourceId = asString(getAttr(record, 'resourceId'))
    if (resourceId === COPILOT_AGENT_RESOURCE_ID) {
        return 'agent'
    }
    if (resourceId === COPILOT_TOOL_RESOURCE_ID) {
        return 'tool'
    }
    if (asString(getAttr(record, 'orgApiUrl'))) {
        return 'agent'
    }
    const identity = asString(getAttr(record, 'identity')) || ''
    if (identity.includes('.crm') && identity.includes('.dynamics.com')) {
        return 'agent'
    }
    if (isGuid(identity)) {
        return 'tool'
    }
    return 'skip'
}

async function applyPublication(
    fetchImpl: FetchLike,
    dataverseUrl: string,
    token: string,
    record: AnyRecord,
    bots: Map<string, BotPublication | null>
): Promise<void> {
    const botId = botIdFromAgent(record)
    if (!botId) {
        return
    }
    const publication = await botPublication(fetchImpl, dataverseUrl, token, botId, bots)
    if (!publication) {
        return
    }
    setAttr(record, 'accesscontrolpolicy', publication.policy)
    if (publication.label) {
        setAttr(record, 'accesscontrolpolicyName', publication.label)
    }
    if (publication.groups && publication.groups.length > 0) {
        setAttr(record, 'authorizedsecuritygroupids', publication.groups)
    }
}

function botIdFromAgent(record: AnyRecord): string | undefined {
    const identity = asString(getAttr(record, 'identity'))
    if (!identity) {
        return undefined
    }
    if (isGuid(identity)) {
        return identity
    }
    const tail = identity.split(':').pop()
    return tail && isGuid(tail) ? tail : undefined
}

async function applyConnection(
    fetchImpl: FetchLike,
    config: ToolCustomizerConfig,
    dataverseUrl: string,
    token: string,
    record: AnyRecord,
    accounts: Map<string, string | null>,
    powerAppsToken: string | undefined
): Promise<string | undefined> {
    const componentId = componentIdFromTool(record)
    if (!componentId) {
        return powerAppsToken
    }
    const references = await connectionReferences(fetchImpl, dataverseUrl, token, componentId)
    if (references.length === 0) {
        return powerAppsToken
    }
    const names = references.map((reference) => reference.name).filter((name): name is string => !!name)
    const connectionIds = references.map((reference) => reference.connectionId).filter((id): id is string => !!id)
    if (names.length > 0) {
        setAttr(record, 'connectionReference', names.join(','))
    }
    if (connectionIds.length > 0) {
        setAttr(record, 'connectionId', connectionIds.join(','))
    }

    const accountNames: string[] = []
    for (const connectionId of connectionIds) {
        let accountName = await instanceAccountName(fetchImpl, dataverseUrl, token, connectionId)
        if (!accountName) {
            if (powerAppsToken === undefined) {
                powerAppsToken = (await powerAppsAccessToken(fetchImpl, config)) || ''
            }
            if (powerAppsToken) {
                accountName = await powerAppsAccountName(
                    fetchImpl,
                    powerAppsToken,
                    config.environmentId || DEFAULT_ENVIRONMENT_ID,
                    connectionId,
                    accounts
                )
            }
        }
        if (accountName) {
            accountNames.push(accountName)
        }
    }
    if (accountNames.length > 0) {
        setAttr(record, 'accountName', accountNames.join(','))
    }
    return powerAppsToken
}

function componentIdFromTool(record: AnyRecord): string | undefined {
    const identity = asString(getAttr(record, 'identity') ?? getAttr(record, 'botcomponentid'))
    return identity && isGuid(identity) ? identity : undefined
}

interface ConnectionReference {
    name?: string
    connectionId?: string
}

async function connectionReferences(
    fetchImpl: FetchLike,
    dataverseUrl: string,
    token: string,
    componentId: string
): Promise<ConnectionReference[]> {
    const filter = encodeURIComponent(`botcomponentid eq ${componentId}`)
    const links = await dataverseGet(
        fetchImpl,
        token,
        `${dataverseUrl}/api/data/v9.2/botcomponent_connectionreferenceset?$select=connectionreferenceid&$filter=${filter}`
    )
    const references: ConnectionReference[] = []
    for (const link of odataValues(links)) {
        const referenceId = asString(link.connectionreferenceid)
        if (!referenceId) {
            continue
        }
        const reference = await dataverseGet(
            fetchImpl,
            token,
            `${dataverseUrl}/api/data/v9.2/connectionreferences(${referenceId})?$select=connectionreferencelogicalname,connectionreferencedisplayname,connectionid`
        )
        if (!reference || typeof reference !== 'object') {
            continue
        }
        const row = reference as Record<string, unknown>
        references.push({
            name: asString(row.connectionreferencelogicalname) || asString(row.connectionreferencedisplayname) || referenceId,
            connectionId: asString(row.connectionid),
        })
    }
    return references
}

async function instanceAccountName(
    fetchImpl: FetchLike,
    dataverseUrl: string,
    token: string,
    connectionId: string
): Promise<string | undefined> {
    const filter = encodeURIComponent(`connectioninternalid eq '${connectionId}'`)
    const instances = await dataverseGet(
        fetchImpl,
        token,
        `${dataverseUrl}/api/data/v9.2/connectioninstances?$select=accountname&$filter=${filter}`
    )
    for (const instance of odataValues(instances)) {
        const accountName = asString(instance.accountname)
        if (accountName) {
            return accountName
        }
    }
    return undefined
}

async function powerAppsAccessToken(fetchImpl: FetchLike, config: ToolCustomizerConfig): Promise<string | undefined> {
    const clientId = config.clientID || config.clientId
    const clientSecret = config.clientSecret || config.client_secret
    const tenant = config.azureTenantId || config.tenantId || config.domainName
    if (!clientId || !clientSecret || !tenant) {
        return undefined
    }
    return clientCredentialsToken(fetchImpl, tenant, clientId, clientSecret, 'https://service.powerapps.com')
}

async function powerAppsAccountName(
    fetchImpl: FetchLike,
    token: string,
    environmentId: string,
    connectionId: string,
    cache: Map<string, string | null>
): Promise<string | undefined> {
    if (cache.has(connectionId)) {
        return cache.get(connectionId) || undefined
    }
    if (cache.size === 0) {
        await loadPowerAppsAccounts(fetchImpl, token, environmentId, cache)
    }
    if (!cache.has(connectionId)) {
        cache.set(connectionId, null)
    }
    return cache.get(connectionId) || undefined
}

async function loadPowerAppsAccounts(
    fetchImpl: FetchLike,
    token: string,
    environmentId: string,
    cache: Map<string, string | null>
): Promise<void> {
    let url: string | undefined =
        `https://api.powerapps.com/providers/Microsoft.PowerApps/scopes/admin/environments/${environmentId}/connections?api-version=2016-11-01`
    let pages = 0
    while (url && pages < 20) {
        pages += 1
        const page = await dataverseGet(fetchImpl, token, url)
        if (!page || typeof page !== 'object') {
            return
        }
        const body = page as { value?: unknown; nextLink?: unknown }
        if (Array.isArray(body.value)) {
            for (const item of body.value) {
                if (!item || typeof item !== 'object') {
                    continue
                }
                const row = item as { name?: unknown; id?: unknown; properties?: { accountName?: unknown } }
                const key = asString(row.name) || connectionIdFromResourceId(asString(row.id))
                const accountName = asString(row.properties?.accountName)
                if (key) {
                    cache.set(key, accountName || null)
                }
            }
        }
        url = asString(body.nextLink)
    }
    if (cache.size === 0) {
        cache.set('\0', null)
    }
}

function connectionIdFromResourceId(resourceId: string | undefined): string | undefined {
    if (!resourceId) {
        return undefined
    }
    const tail = resourceId.split('/').pop()
    return tail || undefined
}

function odataValues(payload: unknown): Record<string, unknown>[] {
    if (payload && typeof payload === 'object' && Array.isArray((payload as { value?: unknown }).value)) {
        return (payload as { value: Record<string, unknown>[] }).value
    }
    return []
}

function isGuid(value: string): boolean {
    return GUID_PATTERN.test(value)
}

async function botPublication(
    fetchImpl: FetchLike,
    dataverseUrl: string,
    token: string,
    botId: string,
    cache: Map<string, BotPublication | null>
): Promise<BotPublication | undefined> {
    if (cache.has(botId)) {
        return cache.get(botId) || undefined
    }
    const bot = await dataverseGet(
        fetchImpl,
        token,
        `${dataverseUrl}/api/data/v9.2/bots(${botId})?$select=accesscontrolpolicy,authorizedsecuritygroupids`
    )
    if (!bot || (bot as { accesscontrolpolicy?: unknown }).accesscontrolpolicy == null) {
        cache.set(botId, null)
        return undefined
    }
    const policy = String((bot as { accesscontrolpolicy: unknown }).accesscontrolpolicy)
    const groups = splitGroupIds(asString((bot as { authorizedsecuritygroupids?: unknown }).authorizedsecuritygroupids))
    const publication: BotPublication = {
        policy,
        label: POLICY_LABELS[policy],
        groups,
    }
    cache.set(botId, publication)
    return publication
}

async function dataverseGet(fetchImpl: FetchLike, token: string, url: string): Promise<unknown> {
    try {
        const response = await fetchImpl(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
            },
        })
        if (!response.ok) {
            return undefined
        }
        return await response.json()
    } catch {
        return undefined
    }
}

function toAttributeMap(record: AnyRecord): Map<string, unknown> {
    if (record instanceof Map) {
        return record
    }
    const map = new Map<string, unknown>()
    const attributes =
        record.attributes && typeof record.attributes === 'object'
            ? (record.attributes as Record<string, unknown>)
            : record
    for (const [key, value] of Object.entries(attributes)) {
        if (key !== 'attributes') {
            map.set(key, value)
        }
    }
    return map
}

function getAttr(record: AnyRecord, key: string): unknown {
    if (record instanceof Map) {
        return record.get(key)
    }
    if (record.attributes && typeof record.attributes === 'object') {
        const attributes = record.attributes as Record<string, unknown>
        if (attributes[key] != null) {
            return attributes[key]
        }
    }
    return record[key]
}

function splitGroupIds(value: string | undefined): string[] | undefined {
    if (!value) {
        return undefined
    }
    const ids = value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    return ids.length > 0 ? ids : undefined
}

function setAttr(record: AnyRecord, key: string, value: string | string[]): void {
    if (record instanceof Map) {
        record.set(key, value)
        return
    }
    if (record.attributes && typeof record.attributes === 'object') {
        ;(record.attributes as Record<string, unknown>)[key] = value
        return
    }
    record[key] = value
}

function asString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim()) {
        return value.trim()
    }
    if (typeof value === 'number') {
        return String(value)
    }
    return undefined
}

function defaultFetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<FetchResponse> {
    return fetch(url, init)
}
