import { describe, it, expect } from 'vitest'
import {
  backendFromDeviceIds,
  evaluateConfiguredGpuOffload,
  evaluateGpuOffload,
  evaluateEmbeddingVector,
} from './readiness'

describe('backendFromDeviceIds', () => {
  // The backend is read off the device the engine actually enumerated, which
  // is what makes it trustworthy: a configured name never proved the runtime
  // had loaded.
  it('strips the device index to name the backend', () => {
    expect(backendFromDeviceIds(['CUDA0'])).toBe('cuda')
    expect(backendFromDeviceIds(['Vulkan0'])).toBe('vulkan')
    expect(backendFromDeviceIds(['Metal0'])).toBe('metal')
    expect(backendFromDeviceIds(['ROCm1'])).toBe('rocm')
  })

  it('lists distinct backends when several are present', () => {
    expect(backendFromDeviceIds(['CUDA0', 'CUDA1'])).toBe('cuda')
    expect(backendFromDeviceIds(['CUDA0', 'Vulkan0', 'Vulkan1'])).toBe('cuda, vulkan')
  })

  it('is empty when no device was enumerated', () => {
    expect(backendFromDeviceIds([])).toBe('')
    expect(backendFromDeviceIds(['', '  '])).toBe('')
  })

  // A multi-digit index must not eat part of the name.
  it('only strips trailing digits', () => {
    expect(backendFromDeviceIds(['Vulkan10'])).toBe('vulkan')
  })
})

describe('configured GPU readiness', () => {
  const nvidia = { id: 'CUDA0', name: 'NVIDIA GeForce RTX 3060 Ti' }
  const amd = { id: 'Vulkan1', name: 'AMD Radeon AI PRO R9700' }

  it('reports the configured AMD even when CUDA appears first', () => {
    expect(evaluateConfiguredGpuOffload([nvidia, amd], 'Vulkan1', 2)).toMatchObject({
      backend: 'vulkan', status: 'ok', engineDeviceCount: 1, devices: [amd],
    })
  })

  it('warns if the configured AMD is missing and does not count the NVIDIA as selected', () => {
    expect(evaluateConfiguredGpuOffload([nvidia], 'Vulkan1', 2)).toMatchObject({
      backend: '', status: 'warning', reason: 'selectedDevicesUnavailable',
      engineDeviceCount: 0, devices: [], missingDeviceIds: ['Vulkan1'],
    })
  })

  it('reports automatic inventory and respects an explicit offload opt-out', () => {
    expect(evaluateConfiguredGpuOffload([nvidia, amd], '', 2)).toMatchObject({ devices: [nvidia, amd] })
    expect(evaluateConfiguredGpuOffload([nvidia, amd], 'none', 2)).toMatchObject({
      backend: 'cpu', status: 'ok', engineDeviceCount: 0, offloadDisabled: true,
    })
  })
})

describe('evaluateGpuOffload', () => {
  it('passes a machine with no GPU without expecting offload', () => {
    const result = evaluateGpuOffload({
      engineDeviceCount: 0,
      hardwareGpuCount: 0,
    })
    expect(result.status).toBe('ok')
    expect(result.gpuExpected).toBe(false)
    expect(result.reason).toBeUndefined()
  })

  it('passes a GPU the engine can actually use', () => {
    const result = evaluateGpuOffload({
      engineDeviceCount: 1,
      hardwareGpuCount: 1,
    })
    expect(result.status).toBe('ok')
    expect(result.gpuExpected).toBe(true)
  })

  // The one failure worth reporting now that the engine ships with the app: a
  // GPU is present but the engine cannot reach it, which is a driver or runtime
  // problem. There is no longer a "wrong variant installed" case.
  it('warns when a present GPU is invisible to the engine', () => {
    const result = evaluateGpuOffload({
      engineDeviceCount: 0,
      hardwareGpuCount: 1,
    })
    expect(result.status).toBe('warning')
    expect(result.reason).toBe('runtimeUnreachable')
  })

  it('reports the engine device count it based the verdict on', () => {
    expect(
      evaluateGpuOffload({ engineDeviceCount: 2, hardwareGpuCount: 2 })
        .engineDeviceCount
    ).toBe(2)
  })
})


describe('evaluateEmbeddingVector', () => {
  it('accepts a healthy vector and reports its dimension', () => {
    const result = evaluateEmbeddingVector([0.1, -0.2, 0.3])
    expect(result.ok).toBe(true)
    expect(result.dimension).toBe(3)
    expect(result.problem).toBeUndefined()
  })

  it('rejects a missing vector', () => {
    expect(evaluateEmbeddingVector(undefined).problem).toBe('missing')
    expect(evaluateEmbeddingVector(null).problem).toBe('missing')
    expect(evaluateEmbeddingVector('nope').problem).toBe('missing')
  })

  // vector-db rejects this later with "embedding is empty"; catching it during
  // setup turns a first-attachment failure into an onboarding warning.
  it('rejects an empty vector', () => {
    const result = evaluateEmbeddingVector([])
    expect(result.ok).toBe(false)
    expect(result.problem).toBe('empty')
    expect(result.dimension).toBe(0)
  })

  it('rejects non-finite values that sqlite-vec would refuse', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const result = evaluateEmbeddingVector([0.1, bad, 0.3])
      expect(result.ok, String(bad)).toBe(false)
      expect(result.problem).toBe('nonFinite')
    }
  })

  it('rejects non-numeric entries', () => {
    expect(evaluateEmbeddingVector([0.1, '0.2', 0.3]).problem).toBe('nonFinite')
  })

  // An all-zero vector makes cosine similarity divide by zero, so retrieval
  // silently returns nothing useful. It signals a misconfigured pooling type.
  it('rejects a degenerate all-zero vector', () => {
    const result = evaluateEmbeddingVector([0, 0, 0])
    expect(result.ok).toBe(false)
    expect(result.problem).toBe('degenerate')
    expect(result.dimension).toBe(3)
  })
})
