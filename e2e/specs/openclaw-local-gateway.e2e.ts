import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertSafeE2eHome, canonicalPath, containsPath, launchContext } from '../launch-guard.js'
import { assertNoModelOrChat, object, qaIpc } from '../helpers/metadata-profile.js'

describe('puente oficial OpenClaw con Gateway privado local', () => {
  it('conecta el proceso stdio real y consulta conversaciones desde el IPC de Rey30', async () => {
    const profile = assertSafeE2eHome(process.env.REY30_E2E_HOME!, launchContext())
    const receiptPath = process.env.REY30_E2E_OPENCLAW_ENTRY
    assert(receiptPath, 'Prepara una entrada OpenClaw local para esta prueba opt-in')
    const config = object(JSON.parse(readFileSync(receiptPath, 'utf8')))
    assert.equal(config.type, 'stdio')
    assert.equal(config.active, true)
    assert(Array.isArray(config.args))
    assert(config.args.includes('ws://127.0.0.1:18809'), 'Se requiere el Gateway privado de prueba')
    assert(config.args.includes('--token-file'))
    assert(!config.args.includes('--token'))

    const appConfig = object(await qaIpc('get_app_configurations'))
    assert.equal(typeof appConfig.data_folder, 'string')
    const dataFolder = canonicalPath(String(appConfig.data_folder))
    assert(dataFolder !== profile && containsPath(profile, dataFolder))
    assertNoModelOrChat(dataFolder)

    const appVersion = await qaIpc('plugin:app|version')
    await qaIpc('activate_mcp_server', { name: 'OpenClaw', config })
    let tools: string[] = []
    try {
      const connected = await qaIpc('get_connected_servers')
      assert(Array.isArray(connected) && connected.includes('OpenClaw'))
      const available = await qaIpc('get_tools_for_servers', { serverNames: ['OpenClaw'] })
      assert(Array.isArray(available))
      tools = available.map((tool) => {
        const definition = object(tool)
        assert.equal(definition.server, 'OpenClaw')
        return String(definition.name)
      })
      assert(tools.includes('conversations_list'))
      const result = object(await qaIpc('call_tool', {
        serverName: 'OpenClaw', toolName: 'conversations_list', arguments: { limit: 1 },
      }))
      assert.notEqual(result.isError, true, 'La consulta de solo lectura falló')
      assert(Array.isArray(result.content) && result.content.length)
      const content = object(result.content[0])
      assert.equal(content.type, 'text')
      assert.equal(typeof content.text, 'string')
      const output = object(result.structuredContent)
      assert.deepEqual(output.conversations, [], 'El Gateway aislado debe comenzar sin conversaciones')
    } finally {
      await qaIpc('deactivate_mcp_server', { name: 'OpenClaw' })
    }

    const connected = await qaIpc('get_connected_servers')
    assert(Array.isArray(connected) && !connected.includes('OpenClaw'))
    assertNoModelOrChat(dataFolder)
    const repo = resolve(import.meta.dirname, '../..')
    const binary = join(repo, 'src-tauri', 'target', 'debug', 'Rey30-IDvj.exe')
    writeFileSync(join(repo, 'artifacts/qa/openclaw-gateway-20261105/native-mcp-receipt.json'), JSON.stringify({
      completedAt: new Date().toISOString(), appVersion, profile, status: 'passed',
      binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
      nativeCommands: ['activate_mcp_server', 'get_connected_servers', 'get_tools_for_servers', 'call_tool', 'deactivate_mcp_server'],
      endpoint: 'ws://127.0.0.1:18809', transport: 'stdio', tools, conversationsCount: 0,
      outboundMessagesSent: 0, modelRequestsBySpec: 0, nativeClientDisconnected: true,
    }, null, 2) + '\n')
  })
})
