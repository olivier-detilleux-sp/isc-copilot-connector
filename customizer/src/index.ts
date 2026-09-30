import {
    Context,
    createConnectorCustomizer,
    CustomizerType,
    logger,
    readConfig,
    StandardCommand,
} from '@sailpoint/connector-sdk'
import { enrichToolAggregation, ToolCustomizerConfig } from './enrich-tools'

const COPILOT_TOOL_RESOURCE_ID = 'microsoft:copilot-tool'
const COPILOT_AGENT_RESOURCE_ID = 'microsoft:copilot-agent'

export const connectorCustomizer = async () => {
    const config = (await readConfig()) as ToolCustomizerConfig

    const handler = async (_context: Context, input: unknown) => {
        if (isUnrelatedResource(input)) {
            return input
        }
        logger.info('Running Copilot Studio customizer')
        return enrichToolAggregation(config, input)
    }

    const customizer = createConnectorCustomizer()
    // SDK 1.2.7 has no typed afterStd* method for these commands.
    // Connector._exec still looks up after:<command> on customizer.handlers.
    customizer.handlers.set(customizer.handlerKey(CustomizerType.After, StandardCommand.StdResourceList), handler)
    customizer.handlers.set(customizer.handlerKey(CustomizerType.After, StandardCommand.StdMachineIdentityList), handler)
    customizer.handlers.set(customizer.handlerKey(CustomizerType.After, StandardCommand.StdAgentList), handler)

    return customizer
}

function isUnrelatedResource(input: unknown): boolean {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return false
    }
    const resourceId = (input as { resourceId?: unknown }).resourceId
    if (typeof resourceId !== 'string') {
        return false
    }
    return resourceId !== COPILOT_TOOL_RESOURCE_ID && resourceId !== COPILOT_AGENT_RESOURCE_ID
}
