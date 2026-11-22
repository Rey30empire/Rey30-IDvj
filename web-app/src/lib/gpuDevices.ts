import type { DeviceList } from '@/services/hardware/types'

/** A llama.cpp device and whether the `device` setting turns it on. */
export type ActiveDevice = DeviceList & { activated: boolean }

/** One physical GPU, as the one or more backend devices that expose it. */
export interface GpuGroup {
  key: string
  name: string
  devices: ActiveDevice[]
}

export function parseDeviceId(id: string): { backend: string; index: number } {
  const match = /^([A-Za-z]+?)(\d+)$/.exec(id ?? '')
  if (!match) return { backend: id ?? '', index: 0 }
  return { backend: match[1], index: Number(match[2]) }
}

const BACKEND_PRIORITY = [
  'cuda',
  'hip',
  'rocm',
  'sycl',
  'metal',
  'vulkan',
  'opencl',
]

export function backendPriority(backend: string): number {
  const index = BACKEND_PRIORITY.indexOf(backend.toLowerCase())
  return index === -1 ? BACKEND_PRIORITY.length : index
}

// llama.cpp lists one device per backend, so a single physical GPU can appear
// as both CUDA0 and Vulkan0. Group by name and pair same-name devices by their
// per-backend enumeration order.
export function groupDevices(devices: ActiveDevice[]): GpuGroup[] {
  const byName = new Map<string, Map<string, ActiveDevice[]>>()
  for (const device of devices) {
    const { backend } = parseDeviceId(device.id)
    const backends = byName.get(device.name) ?? new Map()
    byName.set(device.name, backends)
    backends.set(backend, [...(backends.get(backend) ?? []), device])
  }

  const groups: GpuGroup[] = []
  for (const [name, backends] of byName) {
    const lists = [...backends.values()]
    for (const list of lists) {
      list.sort((a, b) => parseDeviceId(a.id).index - parseDeviceId(b.id).index)
    }
    const unitCount = Math.max(...lists.map((list) => list.length))
    for (let i = 0; i < unitCount; i++) {
      const unit = lists
        .map((list) => list[i])
        .filter((device): device is ActiveDevice => Boolean(device))
        .sort(
          (a, b) =>
            backendPriority(parseDeviceId(a.id).backend) -
            backendPriority(parseDeviceId(b.id).backend)
        )
      if (unit.length > 0) {
        groups.push({
          key: unit.map((device) => device.id).join('+'),
          name,
          devices: unit,
        })
      }
    }
  }
  return groups
}

// Activated device if any (units are priority-sorted), else the preferred one.
export function selectedDevice(group: GpuGroup): ActiveDevice {
  return group.devices.find((device) => device.activated) ?? group.devices[0]
}

/** Choice meaning "use every GPU", as llama.cpp does by default. */
export const ALL_GPUS = 'all'

/**
 * Which GPU the `device` setting points at: one group's key, {@link ALL_GPUS}
 * when several are on, or '' when every GPU is off (the model runs on the CPU).
 */
export function currentGpuChoice(groups: GpuGroup[]): string {
  const active = groups.filter((group) =>
    group.devices.some((device) => device.activated)
  )
  if (active.length === 0) return ''
  return active.length === 1 ? active[0].key : ALL_GPUS
}

/**
 * Device activations that put the engine on `choice`: one backend device per
 * chosen GPU (the active one, else the preferred backend), everything else
 * off. The same shape the hardware page writes.
 */
export function activationsForGpuChoice(
  groups: GpuGroup[],
  choice: string
): Record<string, boolean> {
  const updates: Record<string, boolean> = {}
  for (const group of groups) {
    const chosen = choice === ALL_GPUS || group.key === choice
    const preferred = selectedDevice(group)
    for (const device of group.devices) {
      updates[device.id] = chosen && device.id === preferred.id
    }
  }
  return updates
}
