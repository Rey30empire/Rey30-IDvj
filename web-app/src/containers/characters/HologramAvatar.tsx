import { useEffect, useRef, useState } from 'react'

/**
 * A character drawn as a cloud of light particles: they gather into the face
 * from a portrait while the character listens, thinks or talks, swell with
 * the voice level while it speaks, and loosen back into a slow spinning sphere
 * when the call is idle. Plain canvas 2D, no extra dependencies.
 *
 * The portraits are personal photos kept in `public/hologram/` (ignored by
 * git), so a build without them simply shows no hologram.
 */

export type HologramState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

export type HologramPortrait = {
  src: string
  /** Normalized crop of the head and shoulders: [left, top, right, bottom]. */
  crop: [number, number, number, number]
}

/** Portraits for the characters that have one, by profile id. */
export const HOLOGRAM_PORTRAITS: Record<string, HologramPortrait> = {
  literatura: { src: '/hologram/plumita.webp', crop: [0.31, 0.005, 0.64, 0.2] },
  kairo: { src: '/hologram/blaster.webp', crop: [0.3, 0, 0.7, 0.22] },
}

const SAMPLE_WIDTH = 200
const MAX_PARTICLES = 16_000
const WIDTH = 240
const HEIGHT = 300

type Particle = {
  /** Where the particle sits in the portrait, in canvas pixels. */
  fx: number
  fy: number
  /** Where it sits on the idle sphere (unit sphere coordinates). */
  sx: number
  sy: number
  sz: number
  x: number
  y: number
  light: number
  phase: number
}

/** Pick particles from the portrait: brighter pixels are likelier, so the face, hair and clothes read while the dark backdrop drops out. */
export function sampleParticles(pixels: Uint8ClampedArray, width: number, height: number, max = MAX_PARTICLES, random = Math.random): Particle[] {
  const scale = Math.min(WIDTH / width, HEIGHT / height) * 0.92
  const offsetX = (WIDTH - width * scale) / 2
  const offsetY = (HEIGHT - height * scale) / 2
  const luma = (x: number, y: number) => {
    const at = (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4
    return (0.299 * pixels[at] + 0.587 * pixels[at + 1] + 0.114 * pixels[at + 2]) / 255
  }
  // A halftone: one particle per grid cell, as bright as the portrait there.
  // Keeping every cell (not a random draw) is what keeps eyes, nose and mouth
  // readable; the dark backdrop drops out below a small threshold.
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / max)))
  // The backdrop is whatever fills the border of the crop (a studio wall is
  // rarely black): only what stands out from it becomes light.
  const border: number[] = []
  for (let x = 0; x < width; x++) border.push(luma(x, 0), luma(x, height - 1))
  for (let y = 0; y < height; y++) border.push(luma(0, y), luma(width - 1, y))
  border.sort((a, b) => a - b)
  const backdrop = border[Math.floor(border.length / 2)] ?? 0
  const span = Math.max(0.15, 1 - backdrop)
  const cells: { x: number; y: number; light: number }[] = []
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const light = Math.max(0, luma(x, y) - backdrop) / span
      const edge = Math.abs(luma(x + stride, y) - luma(x - stride, y)) + Math.abs(luma(x, y + stride) - luma(x, y - stride))
      const value = Math.min(1, light * 1.1 + edge * 0.8)
      if (value > 0.1) cells.push({ x, y, light: value })
    }
  }
  const particles: Particle[] = []
  for (const { x, y, light } of cells.slice(0, max)) {
    const theta = random() * Math.PI * 2
    const cos = random() * 2 - 1
    const ring = Math.sqrt(1 - cos * cos)
    const fx = offsetX + (x + random() * stride * 0.6) * scale
    const fy = offsetY + (y + random() * stride * 0.6) * scale
    particles.push({ fx, fy, sx: ring * Math.cos(theta), sy: cos, sz: ring * Math.sin(theta), x: fx, y: fy, light, phase: random() * Math.PI * 2 })
  }
  return particles
}

/** How gathered into the face the cloud should be for a state: 0 is the sphere, 1 the face. */
export function hologramFormation(state: HologramState): number {
  return state === 'idle' ? 0.12 : state === 'error' ? 0.45 : 1
}

function loadPortrait(portrait: HologramPortrait): Promise<Particle[]> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      const [left, top, right, bottom] = portrait.crop
      const sx = image.naturalWidth * left
      const sy = image.naturalHeight * top
      const sw = image.naturalWidth * (right - left)
      const sh = image.naturalHeight * (bottom - top)
      const width = SAMPLE_WIDTH
      const height = Math.round(SAMPLE_WIDTH * (sh / sw))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) { reject(new Error('Sin contexto 2D')); return }
      context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height)
      resolve(sampleParticles(context.getImageData(0, 0, width, height).data, width, height))
    }
    image.onerror = () => reject(new Error('Retrato no disponible'))
    image.src = portrait.src
  })
}

export function HologramAvatar({ portrait, state, level, color, label }: {
  portrait: HologramPortrait
  state: HologramState
  /** Voice amplitude, 0 to 1. */
  level: number
  /** Accent color of the light, `#rrggbb`. */
  color: string
  label: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const live = useRef({ state, level })
  live.current = { state, level }
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let particles: Particle[] = []
    let frame = 0
    let stopped = false
    let formation = 0
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const rgb = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color)
    const [r, g, b] = rgb ? rgb.slice(1).map(part => parseInt(part, 16)) : [92, 225, 230]

    const draw = (time: number) => {
      const element = canvas.current
      const context = element?.getContext('2d')
      if (!element || !context || stopped) return
      const { state: now, level: voice } = live.current
      const target = hologramFormation(now)
      formation += (target - formation) * (reduced ? 1 : 0.045)
      const spin = time * 0.00025
      const speaking = now === 'speaking' ? Math.max(0, Math.min(1, voice)) : 0
      const breathe = now === 'listening' ? 0.5 + 0.5 * Math.sin(time * 0.003) : 0
      // A fading trail, not a full clear: moving particles leave a faint streak.
      context.globalCompositeOperation = 'source-over'
      context.fillStyle = reduced ? 'rgba(4, 8, 16, 1)' : 'rgba(4, 8, 16, 0.55)'
      context.fillRect(0, 0, WIDTH, HEIGHT)
      context.globalCompositeOperation = 'lighter'
      const radius = 92 + speaking * 10
      for (const particle of particles) {
        const angle = spin + particle.phase * 0.02
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const depth = particle.sx * sin + particle.sz * cos
        const sphereX = WIDTH / 2 + (particle.sx * cos - particle.sz * sin) * radius
        const sphereY = HEIGHT / 2 + particle.sy * radius
        // Small enough that the features stay readable while the voice moves them.
        const wobble = reduced ? 0 : (0.25 + speaking * 1.4 + breathe * 0.5) * Math.sin(time * 0.004 + particle.phase)
        const goalX = sphereX + (particle.fx - sphereX) * formation + wobble
        const goalY = sphereY + (particle.fy - sphereY) * formation + wobble * 0.6
        particle.x += (goalX - particle.x) * (reduced ? 1 : 0.12)
        particle.y += (goalY - particle.y) * (reduced ? 1 : 0.12)
        const shade = formation > 0.5 ? particle.light : 0.35 + 0.5 * (depth + 1) / 2
        // Brightness follows the portrait, so dark features (eyes, mouth) stay dark.
        const alpha = Math.min(1, shade ** 1.6 * (0.95 + speaking * 0.4) + (now === 'thinking' ? 0.1 * Math.sin(time * 0.006 + particle.phase) : 0))
        context.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`
        context.fillRect(particle.x, particle.y, 1.4, 1.4)
      }
      if (!reduced) frame = requestAnimationFrame(draw)
    }

    loadPortrait(portrait).then(sampled => {
      if (stopped) return
      particles = sampled
      setReady(true)
      frame = requestAnimationFrame(draw)
    }).catch(() => setReady(false))

    const visibility = () => {
      cancelAnimationFrame(frame)
      if (!document.hidden && !stopped && particles.length) frame = requestAnimationFrame(draw)
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [portrait, color])

  return (
    <canvas
      ref={canvas}
      data-testid="hologram-avatar"
      data-state={state}
      role="img"
      aria-label={label}
      width={WIDTH}
      height={HEIGHT}
      hidden={!ready}
      className="pointer-events-none rounded-2xl border border-cyan-400/20 bg-[#040810] shadow-[0_0_40px_rgba(92,225,230,0.18)]"
    />
  )
}
