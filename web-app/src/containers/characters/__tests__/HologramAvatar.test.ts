import { describe, expect, it } from 'vitest'
import { HOLOGRAM_PORTRAITS, hologramFormation, sampleParticles } from '../HologramAvatar'

/** A dark square with a bright disc in the middle, like a face on a dark backdrop. */
function disc(size: number) {
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const inside = (x - size / 2) ** 2 + (y - size / 2) ** 2 < (size / 4) ** 2
    const at = (y * size + x) * 4
    pixels.set(inside ? [230, 230, 230, 255] : [4, 4, 8, 255], at)
  }
  return pixels
}

describe('holograma de partículas', () => {
  it('reparte las partículas sobre lo claro y deja fuera el fondo oscuro', () => {
    let seed = 1
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const particles = sampleParticles(disc(80), 80, 80, 4_000, random)
    // One particle per 2x2 cell of a radius-20 disc (about 1 250 px), plus its rim.
    expect(particles.length).toBeGreaterThan(250)
    expect(particles.length).toBeLessThanOrEqual(4_000)
    const center = { x: 120, y: 150 }
    const far = particles.filter(p => Math.hypot(p.fx - center.x, p.fy - center.y) > 80)
    expect(far.length / particles.length).toBeLessThan(0.05)
  })

  it('forma la cara al hablar o escuchar y se disuelve en esfera en reposo', () => {
    expect(hologramFormation('speaking')).toBe(1)
    expect(hologramFormation('listening')).toBe(1)
    expect(hologramFormation('idle')).toBeLessThan(0.3)
  })

  it('tiene retrato para Plumita y para Blaster', () => {
    expect(Object.keys(HOLOGRAM_PORTRAITS).sort()).toEqual(['kairo', 'literatura'])
    for (const { crop } of Object.values(HOLOGRAM_PORTRAITS)) {
      expect(crop[0]).toBeLessThan(crop[2])
      expect(crop[1]).toBeLessThan(crop[3])
    }
  })
})
