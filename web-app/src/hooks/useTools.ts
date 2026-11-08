import { useEffect } from 'react'
import { getServiceHub } from '@/hooks/useServiceHub'
import { SystemEvent } from '@/types/events'
import { useAppState } from './useAppState'
import { useToolAvailable } from './useToolAvailable'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, MCPExtension } from '@rey30-idvj/core'
import { mcpOrchestrator } from '@/lib/mcp-orchestrator/mcp-orchestrator'
import { usePrivacyMode } from '@/hooks/usePrivacyMode'
import { ensurePrivacyMode, getPrivacyModeSnapshot, privacyAllowsTools } from '@/lib/privacyPolicy'

export const useTools = () => {
  const updateTools = useAppState((state) => state.updateTools)
  const updateRagToolNames = useAppState((state) => state.updateRagToolNames)
  const updateMcpToolNames = useAppState((state) => state.updateMcpToolNames)
  const privacyMode = usePrivacyMode((state) => state.mode)
  const privacyReady = usePrivacyMode((state) => state.loaded && !state.saving && !state.error)
  const { isDefaultsInitialized, setDisabledTools, markDefaultsAsInitialized } = useToolAvailable()

  useEffect(() => {
    let cancelled = false
    const clear = () => {
      updateTools([])
      updateMcpToolNames([])
      updateRagToolNames([])
    }
    async function setTools() {
      if (cancelled) return
      try {
        if (!privacyAllowsTools(await ensurePrivacyMode())) {
          if (!cancelled) clear()
          return
        }
        if (cancelled) return
        // A server connect/disconnect/tools-refresh fired this (mcp-update);
        // the orchestrator's per-request tool cache would otherwise only
        // notice via its own TTL, serving stale/reordered tools in the
        // meantime and destabilizing the KV-cache prefix Rey30 IDvj sends.
        mcpOrchestrator.invalidateCache()

        // Get MCP extension first
        const mcpExtension = ExtensionManager.getInstance().get<MCPExtension>(
          ExtensionTypeEnum.MCP
        )

        // Fetch tools and tool names in parallel
        const [mcpTools, ragToolNames] = await Promise.all([
          getServiceHub().mcp().getTools(),
          getServiceHub().rag().getToolNames?.() ?? Promise.resolve([]),
        ])
        if (cancelled) return
        if (!privacyAllowsTools(getPrivacyModeSnapshot())) {
          clear()
          return
        }

        // Update MCP tools
        updateTools(mcpTools)

        const mcpNames = mcpTools.map((t) => t.name)
        const mcpNameSet = new Set(mcpNames)
        const ragOnly = ragToolNames.filter((n) => !mcpNameSet.has(n))
        if (ragOnly.length !== ragToolNames.length) {
          const shadowed = ragToolNames.filter((n) => mcpNameSet.has(n))
          console.warn(
            `[tools] RAG tool(s) shadowed by MCP and routed to MCP: ${shadowed.join(', ')}`
          )
        }
        updateMcpToolNames(mcpNames)
        updateRagToolNames(ragOnly)

        // Initialize default disabled tools for new users (only once)
        if (!isDefaultsInitialized() && mcpTools.length > 0 && mcpExtension?.getDefaultDisabledTools) {
          const defaultDisabled = await mcpExtension.getDefaultDisabledTools()
          if (defaultDisabled.length > 0) {
            setDisabledTools(defaultDisabled)
            markDefaultsAsInitialized()
          }
        }
      } catch (error) {
        if (!cancelled) clear()
        console.error('Failed to fetch MCP tools:', error)
      }
    }
    setTools()

    let unsubscribe = () => {}
    getServiceHub().events().listen(SystemEvent.MCP_UPDATE, setTools).then((unsub) => {
      // Unsubscribe from the event when the component unmounts
      if (cancelled) unsub()
      else unsubscribe = unsub
    }).catch((error) => {
      console.error('Failed to set up MCP update listener:', error)
    })
    return () => { cancelled = true; unsubscribe() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privacyMode, privacyReady])
}
