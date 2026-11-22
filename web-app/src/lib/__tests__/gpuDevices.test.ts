import { describe, expect, it } from 'vitest'
import {
  ALL_GPUS,
  activationsForGpuChoice,
  currentGpuChoice,
  groupDevices,
  type ActiveDevice,
} from '../gpuDevices'

const device = (id: string, name: string, activated = true): ActiveDevice => ({
  id,
  name,
  mem: 24_000,
  free: 20_000,
  activated,
})

describe('groupDevices', () => {
  it('joins the backends of one physical GPU and prefers CUDA', () => {
    const groups = groupDevices([
      device('Vulkan0', 'RTX 4090'),
      device('CUDA0', 'RTX 4090'),
      device('Vulkan1', 'Radeon 780M'),
    ])
    expect(groups.map((g) => [g.name, g.devices.map((d) => d.id)])).toEqual([
      ['RTX 4090', ['CUDA0', 'Vulkan0']],
      ['Radeon 780M', ['Vulkan1']],
    ])
  })
})

describe('GPU choice', () => {
  const twoGpus = (cuda: boolean, vulkan0: boolean, radeon: boolean) =>
    groupDevices([
      device('CUDA0', 'RTX 4090', cuda),
      device('Vulkan0', 'RTX 4090', vulkan0),
      device('Vulkan1', 'Radeon 780M', radeon),
    ])

  it('reads the current choice from the device setting', () => {
    expect(currentGpuChoice(twoGpus(true, false, false))).toBe('CUDA0+Vulkan0')
    expect(currentGpuChoice(twoGpus(false, false, true))).toBe('Vulkan1')
    expect(currentGpuChoice(twoGpus(true, true, true))).toBe(ALL_GPUS)
    expect(currentGpuChoice(twoGpus(false, false, false))).toBe('')
  })

  it('turns on one backend of the chosen GPU and nothing else', () => {
    const groups = twoGpus(true, true, true)
    expect(activationsForGpuChoice(groups, 'Vulkan1')).toEqual({
      CUDA0: false,
      Vulkan0: false,
      Vulkan1: true,
    })
    expect(activationsForGpuChoice(groups, 'CUDA0+Vulkan0')).toEqual({
      CUDA0: true,
      Vulkan0: false,
      Vulkan1: false,
    })
  })

  it('keeps the backend already in use, and uses every GPU for "all"', () => {
    const groups = twoGpus(false, true, false)
    expect(activationsForGpuChoice(groups, ALL_GPUS)).toEqual({
      CUDA0: false,
      Vulkan0: true,
      Vulkan1: true,
    })
  })
})
