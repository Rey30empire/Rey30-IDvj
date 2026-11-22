import { describe, expect, it } from 'vitest'
import { blinkAmount, faceLayout, faceWeights, headPose, HOLOGRAM_PORTRAITS, hologramDissolve, rotateFace, sampleParticles, usesHologram } from '../HologramAvatar'

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

  it('se desintegra y se vuelve a formar, salvo mientras habla', () => {
    expect(hologramDissolve('idle', 1_000)).toBe(0)
    expect(hologramDissolve('idle', 7_000)).toBe(1)
    expect(hologramDissolve('listening', 18_000)).toBe(1)
    expect(hologramDissolve('idle', 10_000)).toBe(0)
    expect(hologramDissolve('speaking', 7_000)).toBe(0)
    expect(hologramDissolve('thinking', 500)).toBeGreaterThan(0)
  })

  it('mueve en bloque cada molécula al desintegrarse', () => {
    const particles = sampleParticles(disc(80), 80, 80, 4_000)
    expect(particles[1].dirX).toBe(particles[0].dirX)
    expect(particles[1].reach).toBe(particles[0].reach)
    expect(particles[4].reach).not.toBe(particles[0].reach)
  })

  it('usa holograma o esfera, y solo holograma si hay retrato', () => {
    const avatar = (display?: 'sphere' | 'hologram') => ({ display })
    expect(usesHologram({ baseId: 'literatura', avatar: avatar() })).toBe(true)
    expect(usesHologram({ baseId: 'literatura', avatar: avatar('sphere') })).toBe(false)
    expect(usesHologram({ baseId: 'nara', avatar: avatar('hologram') })).toBe(false)
  })

  it('da volumen a la cara: el centro sobresale y al girar se desplaza más que el borde', () => {
    const particles = sampleParticles(disc(80), 80, 80, 4_000)
    const byDistance = [...particles].sort((a, b) => Math.hypot(a.fx - 120, a.fy - 126) - Math.hypot(b.fx - 120, b.fy - 126))
    expect(byDistance[0].fz).toBeGreaterThan(byDistance[byDistance.length - 1].fz)
    expect(rotateFace(120, 150, 0, 0, 0)).toEqual({ x: 120, y: 150 })
    const shift = (z: number) => rotateFace(120, 150, z, 0.3, 0).x - 120
    expect(shift(60)).toBeGreaterThan(shift(0))
  })

  it('tiene retrato con ojos y boca para Plumita, Blaster y Coder', () => {
    expect(Object.keys(HOLOGRAM_PORTRAITS).sort()).toEqual(['coder', 'kairo', 'literatura'])
    for (const { leftEye, rightEye, mouth } of Object.values(HOLOGRAM_PORTRAITS)) {
      expect(leftEye[0]).toBeLessThan(rightEye[0])
      expect(mouth[1]).toBeGreaterThan(Math.max(leftEye[1], rightEye[1]))
    }
  })

  it('endereza la cara sin deformarla: ojos a la misma altura y boca donde cae', () => {
    for (const portrait of Object.values(HOLOGRAM_PORTRAITS)) {
      const { marks, angle, scale, midX, midY, centerX, eyeY } = faceLayout(portrait)
      expect(marks.leftEye[1]).toBe(marks.rightEye[1])
      const place = ([x, y]: [number, number]) => {
        const rx = (x - midX) * Math.cos(angle) - (y - midY) * Math.sin(angle)
        const ry = (x - midX) * Math.sin(angle) + (y - midY) * Math.cos(angle)
        return [centerX + rx * scale, eyeY + ry * scale]
      }
      expect(place(portrait.mouth)[0]).toBeCloseTo(marks.mouth[0])
      expect(place(portrait.mouth)[1]).toBeCloseTo(marks.mouth[1])
      expect(place(portrait.rightEye)[0]).toBeCloseTo(marks.rightEye[0])
      expect(place(portrait.rightEye)[1]).toBeCloseTo(eyeY)
    }
  })

  it('reparte el movimiento: la boca abre la mandíbula, los ojos parpadean y el cuerpo no gira', () => {
    const marks = { leftEye: [90, 120], rightEye: [150, 120], mouth: [120, 190] } as Parameters<typeof faceWeights>[2]
    expect(faceWeights(120, 195, marks).jaw).toBeGreaterThan(0.9)
    expect(faceWeights(120, 185, marks).jaw).toBe(0)
    expect(faceWeights(120, 185, marks).lip).toBeGreaterThan(0)
    expect(faceWeights(175, 191, marks).jaw).toBeLessThan(0.05)
    expect(faceWeights(90, 120, marks)).toMatchObject({ lid: 1, lidY: 120 })
    expect(faceWeights(90, 102, marks).brow).toBeGreaterThan(0.9)
    expect(faceWeights(120, 150, marks).head).toBe(1)
    expect(faceWeights(120, 290, marks).head).toBe(0)
  })

  it('mira de frente: la cabeza solo se mece un poco, haga lo que haga', () => {
    for (const state of ['idle', 'listening', 'thinking', 'speaking', 'error'] as const) {
      for (let time = 0; time < 60_000; time += 37) {
        const pose = headPose(state, time, 1)
        expect(Math.abs(pose.yaw)).toBeLessThanOrEqual(0.05)
        expect(Math.abs(pose.pitch)).toBeLessThanOrEqual(0.06)
        expect(Math.abs(pose.roll)).toBeLessThanOrEqual(0.04)
      }
    }
  })

  it('no desdobla la nariz ni los rasgos al moverse: puntos vecinos se mueven juntos', () => {
    // A lit face with a bright nose ridge down the middle, like a real portrait.
    const size = 120
    const pixels = new Uint8ClampedArray(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const inside = (x - 60) ** 2 + (y - 60) ** 2 < 45 ** 2
      const ridge = Math.abs(x - 60) < 3 && y > 45 && y < 75
      pixels.set(inside ? (ridge ? [250, 250, 250, 255] : [120, 120, 120, 255]) : [0, 0, 0, 255], (y * size + x) * 4)
    }
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const marks = { leftEye: [40, 45], rightEye: [80, 45], mouth: [60, 80] } as Parameters<typeof faceWeights>[2]
    const particles = sampleParticles(pixels, size, size, 20_000, random, marks)
    // Compared with the face at rest, which already has its perspective.
    const rest = particles.map(p => rotateFace(p.fx, p.fy, p.fz, 0, 0, 0))
    let worst = 0
    for (const state of ['idle', 'speaking', 'thinking'] as const) {
      for (let time = 0; time < 20_000; time += 211) {
        const { yaw, pitch, roll } = headPose(state, time, 1)
        const moved = particles.map(p => rotateFace(p.fx, p.fy, p.fz, yaw, pitch, roll))
        for (let a = 0; a < particles.length; a += 3) {
          for (let b = a + 1; b < Math.min(particles.length, a + 40); b++) {
            if (Math.hypot(particles[a].fx - particles[b].fx, particles[a].fy - particles[b].fy) > 3) continue
            const before = [rest[b].x - rest[a].x, rest[b].y - rest[a].y]
            const after = [moved[b].x - moved[a].x, moved[b].y - moved[a].y]
            worst = Math.max(worst, Math.hypot(after[0] - before[0], after[1] - before[1]))
          }
        }
      }
    }
    // Neighbours that drift apart by a pixel or more show a doubled or protruding feature.
    expect(worst).toBeLessThan(0.5)
  })

  it('parpadea rápido al cerrar y más lento al abrir', () => {
    expect(blinkAmount(-5)).toBe(0)
    expect(blinkAmount(70)).toBe(1)
    expect(blinkAmount(130)).toBeCloseTo(0.5)
    expect(blinkAmount(400)).toBe(0)
  })
})
