import { describe, expect, it } from 'vitest'
import { clientConnectionJson, localApiConnection, newLocalApiKey } from '../localApiConnection'

describe('local API connection details', () => {
  it('exports a reachable loopback URL and supports configured prefixes', () => {
    expect(localApiConnection(1337, '/v1')).toEqual({ origin: 'http://127.0.0.1:1337', baseUrl: 'http://127.0.0.1:1337/v1', modelsUrl: 'http://127.0.0.1:1337/v1/models' })
    expect(localApiConnection(1337, '')?.baseUrl).toBe('http://127.0.0.1:1337')
    expect(localApiConnection(4321, '/api/v1/')?.baseUrl).toBe('http://127.0.0.1:4321/api/v1')
  })

  it.each([0, -1, 65536, 1.5, Number.NaN])('does not advertise an invalid/unassigned port %s', (port) => {
    expect(localApiConnection(port, '/v1')).toBeNull()
  })

  it.each(['/../v1', '/api/./v1', '//example.com', '/v1?secret=value', '/v1#other', 'https://example.com'])('does not export a misleading prefix %s', (prefix) => {
    expect(localApiConnection(1337, prefix)).toBeNull()
  })

  it('uses a cryptographic key and does not insert secrets into exported configuration', () => {
    const first = newLocalApiKey()
    const second = newLocalApiKey()
    expect(first).toMatch(/^rey30_[a-f0-9]{64}$/)
    expect(first).not.toBe(second)
    expect(JSON.parse(clientConnectionJson('http://127.0.0.1:1337/v1', 'owned-model', true))).toEqual({ base_url: 'http://127.0.0.1:1337/v1', api_key: '<API_KEY>', model: 'owned-model' })
    expect(JSON.parse(clientConnectionJson('http://127.0.0.1:1337/v1', 'owned-model', false)).api_key).toBe('local')
  })
})
