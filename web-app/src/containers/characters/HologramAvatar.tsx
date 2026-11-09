import { useEffect, useRef, useState } from 'react'

/**
 * A character drawn as a cloud of light particles that behaves like a person:
 * the portrait is straightened to face the viewer, the lips follow the voice
 * that is playing, the eyes blink and look around, the brows react and the head
 * moves while the body only breathes. Between sentences it comes apart into
 * drifting molecules and assembles again. Plain canvas 2D, no extra dependencies.
 *
 * The portraits are personal photos kept in `public/hologram/` (ignored by
 * git), so a build without them simply shows no hologram.
 */

export type HologramState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

type Point = [number, number]

export type HologramPortrait = {
  src: string
  /** Facial landmarks in image pixels; the mouth is the line between the lips. */
  leftEye: Point
  rightEye: Point
  mouth: Point
}

/** Portraits for the characters that have one, by profile id. */
export const HOLOGRAM_PORTRAITS: Record<string, HologramPortrait> = {
  literatura: { src: '/hologram/plumita.png', leftEye: [342, 337], rightEye: [498, 337], mouth: [420, 482] },
  kairo: { src: '/hologram/blaster.webp', leftEye: [533, 172], rightEye: [598, 192], mouth: [544, 257] },
  coder: { src: '/hologram/coder.png', leftEye: [487, 725], rightEye: [712, 727], mouth: [590, 995] },
}

/** The element a screen with room offers for the full-size hologram. */
export const HOLOGRAM_STAGE_ID = 'hologram-stage'

/** Sphere or hologram, never both: only characters with a portrait can have the hologram. */
export function usesHologram(profile: { baseId: string; avatar: { display?: 'sphere' | 'hologram' } }): boolean {
  return profile.baseId in HOLOGRAM_PORTRAITS && profile.avatar.display !== 'sphere'
}

const SAMPLE_WIDTH = 240
const SAMPLE_HEIGHT = 300
const MAX_PARTICLES = 18_000
const WIDTH = 240
const HEIGHT = 300
/** Canvas pixels per drawing unit, so the full-size hologram stays sharp. */
const RENDER_SCALE = 2
const CAMERA_DISTANCE = 420
const BOND_SIZE = 4
const DISSOLVE_CYCLE_MS = 11_000
/** With no call the hologram only decorates the chat, so it draws at a lower rate. */
const IDLE_FRAME_MS = 33
/** Eye distance as a share of the sample width, and eye height as a share of its height. */
const EYE_SPAN = 0.27
const EYE_LEVEL = 0.4

export type FaceMarks = { leftEye: Point; rightEye: Point; mouth: Point }

export type FaceWeights = { jaw: number; lip: number; lid: number; lidY: number; brow: number; head: number }

type Particle = FaceWeights & {
  /** Where the particle sits in the portrait, in canvas pixels. */
  fx: number
  fy: number
  /** How far it stands out of the portrait plane, toward the viewer. */
  fz: number
  /** Where its molecule flies when the face comes apart, and how far. */
  dirX: number
  dirY: number
  reach: number
  /** Offset from the first atom of its molecule. */
  ox: number
  oy: number
  x: number
  y: number
  light: number
  phase: number
}

const fade = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

/** How a portrait is turned and scaled so the eyes are level. */
export function faceLayout({ leftEye, rightEye, mouth }: HologramPortrait) {
  const midX = (leftEye[0] + rightEye[0]) / 2
  const midY = (leftEye[1] + rightEye[1]) / 2
  const angle = -Math.atan2(rightEye[1] - leftEye[1], rightEye[0] - leftEye[0])
  const eyeDistance = Math.hypot(rightEye[0] - leftEye[0], rightEye[1] - leftEye[1])
  const scale = (SAMPLE_WIDTH * EYE_SPAN) / eyeDistance
  const offsetX = mouth[0] - midX
  const offsetY = mouth[1] - midY
  const alignedX = offsetX * Math.cos(angle) - offsetY * Math.sin(angle)
  const alignedY = offsetX * Math.sin(angle) + offsetY * Math.cos(angle)
  const centerX = SAMPLE_WIDTH / 2
  const eyeY = SAMPLE_HEIGHT * EYE_LEVEL
  const halfSpan = (SAMPLE_WIDTH * EYE_SPAN) / 2
  const marks: FaceMarks = {
    leftEye: [centerX - halfSpan, eyeY],
    rightEye: [centerX + halfSpan, eyeY],
    mouth: [centerX + alignedX * scale, eyeY + alignedY * scale],
  }
  return { midX, midY, angle, scale, centerX, eyeY, marks }
}

/** Which facial movements carry a point of the face, from 0 (none) to 1 (fully). */
export function faceWeights(x: number, y: number, { leftEye, rightEye, mouth }: FaceMarks): FaceWeights {
  const span = rightEye[0] - leftEye[0]
  const dx = Math.abs(x - mouth[0])
  const dy = y - mouth[1]
  const chin = (mouth[1] - leftEye[1]) * 0.5
  const lipHalf = span * 0.34
  let jaw = 0
  if (dy >= 0) {
    // Cheeks at lip height stay put, so only the mouth opens and not the whole face.
    const cheek = fade((dx - lipHalf * 0.8) / (lipHalf * 0.6))
    jaw = (1 - fade((dx - lipHalf) / (span * 0.55))) * (1 - fade((dy - chin) / (chin * 0.5))) * (1 - cheek * (1 - fade(dy / (chin * 0.8))))
  }
  const lip = dy < 0 && dy > -chin * 0.35 ? (1 - fade(dx / lipHalf)) * (1 - fade(-dy / (chin * 0.35))) : 0
  let lid = 0
  let lidY = 0
  let brow = 0
  for (const [eyeX, eyeY] of [leftEye, rightEye]) {
    const eye = ((x - eyeX) / (span * 0.24)) ** 2 + ((y - eyeY) / (span * 0.13)) ** 2
    if (eye < 1) { lid = 1 - eye; lidY = eyeY }
    const arch = ((x - eyeX) / (span * 0.36)) ** 2 + ((y - (eyeY - span * 0.3)) / (span * 0.12)) ** 2
    if (arch < 1) brow = 1 - arch
  }
  return { jaw, lip, lid, lidY, brow, head: 1 - fade((dy - chin * 1.1) / (chin * 1.6)) }
}

const STILL_FACE: FaceWeights = { jaw: 0, lip: 0, lid: 0, lidY: 0, brow: 0, head: 1 }

/** Pick particles from the portrait: brighter pixels are likelier, so the face, hair and clothes read while the dark backdrop drops out. */
export function sampleParticles(pixels: Uint8ClampedArray, width: number, height: number, max = MAX_PARTICLES, random = Math.random, marks?: FaceMarks): Particle[] {
  const scale = Math.min(WIDTH / width, HEIGHT / height) * 0.92
  const offsetX = (WIDTH - width * scale) / 2
  const offsetY = (HEIGHT - height * scale) / 2
  const toCanvas = ([x, y]: Point): Point => [offsetX + x * scale, offsetY + y * scale]
  const face = marks && { leftEye: toCanvas(marks.leftEye), rightEye: toCanvas(marks.rightEye), mouth: toCanvas(marks.mouth) }
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
    const fx = offsetX + (x + random() * stride * 0.6) * scale
    const fy = offsetY + (y + random() * stride * 0.6) * scale
    // The head as a rounded volume, with bright features a little in front.
    const nx = (fx - WIDTH / 2) / (WIDTH * 0.4)
    const ny = (fy - HEIGHT * 0.42) / (HEIGHT * 0.48)
    // The nose stands out, which is what makes a turning head read as one.
    const noseTop = face ? face.leftEye[1] : 0
    const noseSpan = face ? face.rightEye[0] - face.leftEye[0] : 1
    const nose = face && fy > noseTop && fy < face.mouth[1] ? Math.exp(-(((fx - face.mouth[0]) / (noseSpan * 0.16)) ** 2)) * 22 : 0
    const fz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * 62 + light * 12 + nose
    const weights = face ? faceWeights(fx, fy, face) : STILL_FACE
    // The face is what matters: clothes stay faint and the crop melts away instead of ending in a straight edge.
    const melt = face ? (1 - fade((Math.hypot((fx - WIDTH / 2) / (WIDTH * 0.5), (fy - HEIGHT / 2) / (HEIGHT * 0.5)) - 0.74) / 0.28)) * (0.3 + 0.7 * weights.head) : 1
    if (light * melt < 0.04) continue
    particles.push({ fx, fy, fz, dirX: Math.cos(theta), dirY: Math.sin(theta), reach: 40 + random() * 85, ox: 0, oy: 0, x: fx, y: fy, light: light * melt, phase: random() * Math.PI * 2, ...weights })
  }
  // Neighbours leave together, as small molecules.
  particles.forEach((particle, index) => {
    const lead = particles[index - (index % BOND_SIZE)]
    particle.dirX = lead.dirX
    particle.dirY = lead.dirY
    particle.reach = lead.reach
    particle.ox = particle.fx - lead.fx
    particle.oy = particle.fy - lead.fy
  })
  return particles
}

/**
 * How far the face has come apart for a state: 0 is whole, 1 is all molecules.
 * It stays whole while speaking, so the lips can be read; otherwise it keeps
 * dissolving and assembling.
 */
export function hologramDissolve(state: HologramState, time: number): number {
  if (state === 'speaking') return 0
  if (state === 'error') return 0.6
  if (state === 'thinking') return 0.28 + 0.12 * Math.sin(time * 0.002)
  const moment = ((time % DISSOLVE_CYCLE_MS) + DISSOLVE_CYCLE_MS) % DISSOLVE_CYCLE_MS
  return moment >= 6500 && moment < 8500 ? 1 : 0
}

/** Turns a point of the face around the canvas center and projects it with perspective. */
export function rotateFace(x: number, y: number, z: number, yaw: number, pitch: number, roll = 0): { x: number; y: number } {
  const centerX = WIDTH / 2
  const centerY = HEIGHT / 2
  const rawX = x - centerX
  const rawY = y - centerY
  const dx = rawX * Math.cos(roll) - rawY * Math.sin(roll)
  const dy = rawX * Math.sin(roll) + rawY * Math.cos(roll)
  const turnedX = dx * Math.cos(yaw) + z * Math.sin(yaw)
  const turnedZ = z * Math.cos(yaw) - dx * Math.sin(yaw)
  const turnedY = dy * Math.cos(pitch) - turnedZ * Math.sin(pitch)
  const depth = dy * Math.sin(pitch) + turnedZ * Math.cos(pitch)
  const perspective = CAMERA_DISTANCE / (CAMERA_DISTANCE - depth)
  return { x: centerX + turnedX * perspective, y: centerY + turnedY * perspective }
}

/** How closed the eyes are `elapsed` ms into a blink: fast down, slower up. */
export function blinkAmount(elapsed: number): number {
  if (elapsed < 0) return 0
  if (elapsed < 70) return elapsed / 70
  return Math.max(0, 1 - (elapsed - 70) / 120)
}

function loadPortrait(portrait: HologramPortrait): Promise<{ particles: Particle[]; span: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      const layout = faceLayout(portrait)
      const canvas = document.createElement('canvas')
      canvas.width = SAMPLE_WIDTH
      canvas.height = SAMPLE_HEIGHT
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) { reject(new Error('Sin contexto 2D')); return }
      context.fillStyle = '#000'
      context.fillRect(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT)
      context.translate(layout.centerX, layout.eyeY)
      context.scale(layout.scale, layout.scale)
      context.rotate(layout.angle)
      context.drawImage(image, -layout.midX, -layout.midY)
      const particles = sampleParticles(context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data, SAMPLE_WIDTH, SAMPLE_HEIGHT, MAX_PARTICLES, Math.random, layout.marks)
      resolve({ particles, span: (layout.marks.rightEye[0] - layout.marks.leftEye[0]) * 0.92 })
    }
    image.onerror = () => reject(new Error('Retrato no disponible'))
    image.src = portrait.src
  })
}

const SIZE_CLASS = {
  stage: 'h-full w-auto max-w-full object-contain',
  call: 'h-auto w-[240px] rounded-2xl border border-cyan-400/20 shadow-[0_0_40px_rgba(92,225,230,0.18)]',
  corner: 'h-auto w-[150px] rounded-2xl border border-cyan-400/20 shadow-[0_0_40px_rgba(92,225,230,0.18)]',
}

export function HologramAvatar({ portrait, state, level, color, label, size }: {
  portrait: HologramPortrait
  state: HologramState
  /** Voice amplitude, 0 to 1. */
  level: number
  /** Accent color of the light, `#rrggbb`. */
  color: string
  label: string
  size: keyof typeof SIZE_CLASS
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const live = useRef({ state, level })
  live.current = { state, level }
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let particles: Particle[] = []
    let span = 60
    let frame = 0
    let stopped = false
    // Starts apart, so the face assembles when it appears.
    let dissolve = 1
    let lastDraw = 0
    let open = 0
    let raise = 0
    let gazeX = 0
    let gazeY = 0
    let headYaw = 0
    let lookX = 0
    let lookY = 0
    let nextLook = 0
    let blinkStart = -1000
    let nextBlink = 0
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const rgb = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color)
    const [r, g, b] = rgb ? rgb.slice(1).map(part => parseInt(part, 16)) : [92, 225, 230]

    const draw = (time: number) => {
      const element = canvas.current
      const context = element?.getContext('2d')
      if (!element || !context || stopped) return
      const { state: now, level: voice } = live.current
      if (now === 'idle' && !reduced && time - lastDraw < IDLE_FRAME_MS) { frame = requestAnimationFrame(draw); return }
      lastDraw = time
      dissolve = reduced ? 0 : dissolve + (hologramDissolve(now, time) - dissolve) * 0.05
      const speaking = now === 'speaking' ? Math.max(0, Math.min(1, voice)) : 0

      if (!reduced) {
        if (time >= nextBlink) {
          blinkStart = time
          // People blink every few seconds, now and then twice in a row.
          nextBlink = time + (Math.random() < 0.18 ? 260 : 1800 + Math.random() * 3800)
        }
        if (time >= nextLook) {
          // While talking or listening the eyes stay near the viewer; thinking, they wander up.
          const roam = now === 'thinking' ? 1 : now === 'speaking' || now === 'listening' ? 0.5 : 0.9
          lookX = (Math.random() * 2 - 1) * roam
          lookY = now === 'thinking' ? -0.6 - Math.random() * 0.4 : (Math.random() * 2 - 1) * roam * 0.5
          nextLook = time + 500 + Math.random() * 2400
        }
        gazeX += (lookX - gazeX) * 0.35
        gazeY += (lookY - gazeY) * 0.35
        // The eyes get there first and the head follows, as when a person looks aside.
        headYaw += (lookX * 0.34 - headYaw) * 0.035
      }
      const blink = reduced ? 0 : blinkAmount(time - blinkStart)
      const mouth = Math.min(1, speaking * 1.4)
      open += (mouth - open) * (mouth > open ? 0.55 : 0.3)
      const browGoal = now === 'speaking' ? 0.35 + speaking * 0.65 : now === 'listening' ? 0.5 : now === 'thinking' ? 0.3 : 0
      raise += (browGoal - raise) * 0.12

      const yaw = reduced ? 0 : headYaw + Math.sin(time * 0.00131) * 0.025 + (now === 'speaking' ? Math.sin(time * 0.0031) * 0.05 : 0)
      const pitch = reduced ? 0 : Math.sin(time * 0.0009) * 0.03 + open * 0.02 + (now === 'thinking' ? -0.04 : 0)
      const roll = reduced ? 0 : Math.sin(time * 0.00071) * 0.018 + (now === 'listening' ? 0.04 : 0)
      const breath = reduced ? 0 : Math.sin(time * 0.0016) * 0.9

      context.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0)
      // A fading trail, not a full clear: moving particles leave a faint streak.
      context.globalCompositeOperation = 'source-over'
      context.fillStyle = reduced ? 'rgba(4, 8, 16, 1)' : 'rgba(4, 8, 16, 0.7)'
      context.fillRect(0, 0, WIDTH, HEIGHT)
      context.globalCompositeOperation = 'lighter'
      // A speaking mouth barely opens: more than this reads as a deformed face.
      const jawTravel = span * 0.11
      const eyeTravel = span * 0.07
      const browTravel = span * 0.05
      for (const particle of particles) {
        let fx = particle.fx
        let fy = particle.fy
        if (particle.jaw) fy += particle.jaw * open * jawTravel
        if (particle.lip) fy -= particle.lip * open * jawTravel * 0.25
        if (particle.lid) {
          const grip = Math.min(1, particle.lid * 2.5)
          fy = particle.lidY + (fy - particle.lidY) * (1 - blink * grip) + gazeY * eyeTravel * 0.5 * grip
          fx += gazeX * eyeTravel * grip
        }
        if (particle.brow) fy -= particle.brow * raise * browTravel
        const turned = rotateFace(fx, fy, particle.fz, yaw, pitch, roll)
        const faceX = fx + (turned.x - fx) * particle.head
        const faceY = fy + (turned.y - fy) * particle.head + (1 - particle.head) * breath
        let goalX = faceX
        let goalY = faceY
        let loose = 0
        if (dissolve > 0.005) {
          // It starts at the top of the head and runs down, with some scatter.
          const delay = (particle.fy / HEIGHT) * 0.6 + (particle.phase / (Math.PI * 2)) * 0.4
          loose = fade((dissolve - delay * 0.55) / 0.45)
          if (loose > 0) {
            goalX += (particle.ox * 4 + particle.dirX * particle.reach) * loose + Math.sin(time * 0.0011 + particle.reach) * 9 * loose
            goalY += (particle.oy * 4 + particle.dirY * particle.reach) * loose + Math.cos(time * 0.0013 + particle.reach) * 9 * loose - loose * loose * 18
          }
        }
        // A few atoms are always flaking off the head, so it is never a still picture.
        let flake = 1
        if (!reduced && particle.phase < 0.35 && particle.head > 0.5 && !particle.jaw && !particle.lid) {
          const age = (time * 0.00035 + particle.reach / 125) % 1
          goalY -= age * age * 34
          goalX += particle.dirX * age * 14
          flake = 1 - age
        }
        // Lips and eyes have to keep up with the voice; the rest may trail a little.
        const follow = reduced || particle.jaw || particle.lid || particle.lip ? 1 : 0.35
        particle.x += (goalX - particle.x) * follow
        particle.y += (goalY - particle.y) * follow
        // Brightness follows the portrait, so dark features (eyes, mouth) stay dark.
        const alpha = Math.min(1, (particle.light ** 1.6 * (0.95 + speaking * 0.25) + loose * 0.35 + (now === 'thinking' ? 0.08 * Math.sin(time * 0.006 + particle.phase) : 0)) * flake)
        const atom = 1.15 + loose * 0.9
        context.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`
        context.fillRect(particle.x, particle.y, atom, atom)
      }
      if (dissolve > 0.03) {
        context.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(0.4 * Math.min(1, dissolve * 2)).toFixed(2)})`
        context.lineWidth = 0.35
        context.beginPath()
        for (let lead = 0; lead + BOND_SIZE <= particles.length; lead += BOND_SIZE * 3) {
          for (let atom = lead; atom < lead + BOND_SIZE - 1; atom++) {
            const from = particles[atom]
            const to = particles[atom + 1]
            const distance = Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
            if (distance > 3 && distance < 40) {
              context.moveTo(from.x, from.y)
              context.lineTo(to.x, to.y)
            }
          }
        }
        context.stroke()
      }
      if (!reduced) frame = requestAnimationFrame(draw)
    }

    loadPortrait(portrait).then(loaded => {
      if (stopped) return
      particles = loaded.particles
      span = loaded.span
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
      width={WIDTH * RENDER_SCALE}
      height={HEIGHT * RENDER_SCALE}
      hidden={!ready}
      className={`pointer-events-none bg-[#040810] ${SIZE_CLASS[size]}`}
    />
  )
}
