import { getServiceHub } from '@/hooks/useServiceHub'
import type { AvatarPoint } from './types'

const invoke = <T>(command: string, args: Record<string, unknown> = {}) => getServiceHub().core().invoke<T>(command, args)

/** Copies the picked picture into the data folder; resolves null when the dialog is closed. */
export const chooseAvatarImage = () => invoke<string | null>('avatar_image_choose')

const images = new Map<string, Promise<string>>()

/** The saved picture as a data URL, which the hologram's canvas can read. */
export function avatarImageData(file: string): Promise<string> {
  let image = images.get(file)
  if (!image) {
    image = invoke<string>('avatar_image_data', { file })
    images.set(file, image)
    image.catch(() => images.delete(file))
  }
  return image
}

export function deleteAvatarImage(file: string): Promise<void> {
  images.delete(file)
  return invoke<void>('avatar_image_delete', { file }).catch(() => undefined)
}

/**
 * Why three marks cannot be a face: first the eye on the left of the picture,
 * then the one on the right, then the mouth below them.
 */
export function portraitProblem([leftEye, rightEye, mouth]: AvatarPoint[]): string | undefined {
  if (!leftEye || !rightEye || !mouth) return 'Marca los dos ojos y la boca.'
  if (rightEye[0] - leftEye[0] < 4) return 'Primero va el ojo que queda a la izquierda de la foto y después el de la derecha.'
  if (mouth[1] <= Math.max(leftEye[1], rightEye[1])) return 'La boca tiene que quedar debajo de los ojos.'
  return undefined
}
