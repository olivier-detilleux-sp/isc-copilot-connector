/// <reference types="node" />
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { enrichToolAggregation, type FetchLike, type FetchResponse } from './enrich-tools.ts'

type AttributeBag = Record<string, string | string[] | undefined>

const CONFIG = {
    clientID: 'app-id',
    clientSecret: 'secret',
    domainName: 'famdemo.onmicrosoft.com',
    dataverseUrl: 'https://org.api.crm4.dynamics.com',
}

const COMPONENT = 'b08e369d-7d77-4ea5-9ee6-9fd3d3b94c09'
const BOT = '3debefca-b52e-f111-88b4-7c1e52fbe77d'
const REFERENCE = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const CONNECTION = '72c0fc9f846e4f73b06a4a0c1884db14'

function jsonResponse(status: number, body: unknown): FetchResponse {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    }
}

function agentFetch(): { fetchImpl: FetchLike; urls: string[] } {
    const urls: string[] = []
    const fetchImpl: FetchLike = async (url) => {
        urls.push(url)
        if (url.includes('/oauth2/v2.0/token')) {
            return jsonResponse(200, { access_token: 'token' })
        }
        if (url.includes(`/bots(${BOT})`)) {
            return jsonResponse(200, {
                accesscontrolpolicy: 2,
                authorizedsecuritygroupids: '639d5ebc-782c-4300-9b01-67b394167442, 11111111-2222-3333-4444-555555555555',
            })
        }
        return jsonResponse(404, {})
    }
    return { fetchImpl, urls }
}

describe('enrichToolAggregation', () => {
    it('returns the input unchanged when the payload is not an aggregation response', async () => {
        const input = { unexpected: true }
        const result = await enrichToolAggregation(CONFIG, input, async () => jsonResponse(500, {}))
        assert.equal(result, input)
    })

    it('adds the publication policy onto Copilot agent records', async () => {
        const { fetchImpl, urls } = agentFetch()
        const agent: { identity: string; attributes: AttributeBag } = {
            identity: `orgc563e116.api.crm4.dynamics.com:${BOT}`,
            attributes: {
                identity: BOT,
                name: "Brock Farmer's Google Drive Agent",
                orgApiUrl: 'https://orgc563e116.api.crm4.dynamics.com',
            },
        }
        const result = await enrichToolAggregation(CONFIG, agent, fetchImpl)

        assert.equal(result, agent)
        assert.equal(agent.attributes.accesscontrolpolicy, '2')
        assert.equal(agent.attributes.accesscontrolpolicyName, 'Group membership')
        assert.deepEqual(agent.attributes.authorizedsecuritygroupids, [
            '639d5ebc-782c-4300-9b01-67b394167442',
            '11111111-2222-3333-4444-555555555555',
        ])
        assert.equal(urls.filter((url) => url.includes(`/bots(${BOT})`)).length, 1)
        assert.equal(urls.filter((url) => url.includes('/botcomponents(')).length, 0)
    })

    it('adds the connection reference and account name onto a tool', async () => {
        const urls: string[] = []
        const fetchImpl: FetchLike = async (url) => {
            urls.push(url)
            if (url.includes('/oauth2/v2.0/token')) {
                return jsonResponse(200, { access_token: 'token' })
            }
            if (url.includes('botcomponent_connectionreferenceset')) {
                return jsonResponse(200, { value: [{ connectionreferenceid: REFERENCE }] })
            }
            if (url.includes(`/connectionreferences(${REFERENCE})`)) {
                return jsonResponse(200, {
                    connectionreferencelogicalname: 'cr1d4_Brock.shared_googledrive.listfiles',
                    connectionid: CONNECTION,
                })
            }
            if (url.includes('/connectioninstances?')) {
                return jsonResponse(200, { value: [] })
            }
            if (url.includes('/scopes/admin/environments/') && url.includes('/connections?')) {
                return jsonResponse(200, {
                    value: [{ name: CONNECTION, properties: { accountName: 'amanda.ross@204.sailpointtechnologies.com' } }],
                })
            }
            return jsonResponse(404, {})
        }
        const tool: { identity: string; datasetId: string; resourceId: string; attributes: AttributeBag } = {
            identity: COMPONENT,
            datasetId: 'microsoft:copilot',
            resourceId: 'microsoft:copilot-tool',
            attributes: { identity: COMPONENT, name: 'List files in folder' },
        }
        const result = await enrichToolAggregation(CONFIG, tool, fetchImpl)

        assert.equal(result, tool)
        assert.equal(tool.attributes.connectionReference, 'cr1d4_Brock.shared_googledrive.listfiles')
        assert.equal(tool.attributes.connectionId, CONNECTION)
        assert.equal(tool.attributes.accountName, 'amanda.ross@204.sailpointtechnologies.com')
        assert.equal((tool.attributes as { accesscontrolpolicy?: string }).accesscontrolpolicy, undefined)
        assert.ok(urls.some((url) => url.includes('scope=https%3A%2F%2Fservice.powerapps.com%2F.default') || url.includes('/oauth2/v2.0/token')))
        assert.ok(urls.some((url) => url.includes('/scopes/admin/environments/Default-dce21e66-3a03-4ea3-b0c7-ffdc0729c732/connections')))
    })

    it('uses connectioninstance.accountname when that table has a row', async () => {
        const urls: string[] = []
        const fetchImpl: FetchLike = async (url) => {
            urls.push(url)
            if (url.includes('/oauth2/v2.0/token')) {
                return jsonResponse(200, { access_token: 'token' })
            }
            if (url.includes('botcomponent_connectionreferenceset')) {
                return jsonResponse(200, { value: [{ connectionreferenceid: REFERENCE }] })
            }
            if (url.includes(`/connectionreferences(${REFERENCE})`)) {
                return jsonResponse(200, {
                    connectionreferencelogicalname: 'cr1d4_Brock.shared_googledrive.listfiles',
                    connectionid: CONNECTION,
                })
            }
            if (url.includes('/connectioninstances?')) {
                return jsonResponse(200, { value: [{ accountname: 'maker@famdemo.onmicrosoft.com' }] })
            }
            return jsonResponse(404, {})
        }
        const tool: { identity: string; resourceId: string; attributes: AttributeBag } = {
            identity: COMPONENT,
            resourceId: 'microsoft:copilot-tool',
            attributes: { identity: COMPONENT, name: 'List files in folder' },
        }
        await enrichToolAggregation(CONFIG, tool, fetchImpl)

        assert.equal(tool.attributes.accountName, 'maker@famdemo.onmicrosoft.com')
        assert.equal(urls.some((url) => url.includes('api.powerapps.com')), false)
    })

    it('skips Dataverse when the source config has no dataverseUrl', async () => {
        let called = false
        const { dataverseUrl: _ignored, ...sourceConfig } = CONFIG
        const tool: { identity: string; resourceId: string; attributes: AttributeBag } = {
            identity: COMPONENT,
            resourceId: 'microsoft:copilot-tool',
            attributes: { identity: COMPONENT, name: 'List files in folder' },
        }
        const result = await enrichToolAggregation(sourceConfig, tool, async () => {
            called = true
            return jsonResponse(500, {})
        })

        assert.equal(result, tool)
        assert.equal(called, false)
        assert.equal((tool.attributes as { connectionReference?: string }).connectionReference, undefined)
    })

    it('leaves records unchanged when Dataverse rejects the token request', async () => {
        const fetchImpl: FetchLike = async () => jsonResponse(401, {})
        const agent: { identity: string; attributes: AttributeBag } = {
            identity: `org.crm4.dynamics.com:${BOT}`,
            attributes: { name: "Brock Farmer's Google Drive Agent", orgApiUrl: 'https://org.api.crm4.dynamics.com' },
        }
        const result = await enrichToolAggregation(CONFIG, agent, fetchImpl)

        assert.equal(result, agent)
        assert.equal((agent.attributes as { accesscontrolpolicy?: string }).accesscontrolpolicy, undefined)
        assert.equal(agent.attributes.name, "Brock Farmer's Google Drive Agent")
    })
})
