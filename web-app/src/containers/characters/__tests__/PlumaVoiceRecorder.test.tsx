import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlumaVoiceRecorder } from '../PlumaVoiceRecorder'
import type { VoiceRecorder } from '@/lib/characters/voice-recorder'

const fakeRecorder = (wav = 'UklGRg==') => {
  const recorder: VoiceRecorder = { level: vi.fn(() => 0.5), finish: vi.fn(async () => wav), cancel: vi.fn() }
  return { recorder, start: vi.fn(async () => recorder) }
}

describe('grabar mi voz para Pluma', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('graba, pide unos segundos de voz y la guarda en Lore con su nombre', async () => {
    const { recorder, start } = fakeRecorder('V0FW')
    const onSave = vi.fn(async () => undefined)
    render(<PlumaVoiceRecorder disabled={false} onSave={onSave} start={start} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Grabar mi voz' })) })
    expect(start).toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Grabación de voz' })).toHaveTextContent('Lee en voz alta')
    const finish = () => screen.getByRole('button', { name: /Sigue hablando|Terminar y usar esta voz/ })
    expect(finish()).toBeDisabled()
    await act(async () => { vi.advanceTimersByTime(6_000) })
    expect(screen.getByRole('timer')).toHaveTextContent('0:06 / 0:30')
    expect(finish()).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Nombre en Lore'), { target: { value: 'Rey hablando' } })
    await act(async () => { fireEvent.click(finish()) })
    expect(recorder.finish).toHaveBeenCalled()
    expect(onSave).toHaveBeenCalledWith('Rey hablando', 'V0FW')
    expect(screen.getByRole('button', { name: 'Grabar mi voz' })).toBeInTheDocument()
  })

  it('cancelar suelta el micrófono sin guardar nada', async () => {
    const { recorder, start } = fakeRecorder()
    const onSave = vi.fn(async () => undefined)
    render(<PlumaVoiceRecorder disabled={false} onSave={onSave} start={start} singing />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Grabarme cantando' })) })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(recorder.cancel).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('se detiene solo al llegar a medio minuto', async () => {
    const { recorder, start } = fakeRecorder()
    const onSave = vi.fn(async () => undefined)
    render(<PlumaVoiceRecorder disabled={false} onSave={onSave} start={start} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Grabar mi voz' })) })
    await act(async () => { vi.advanceTimersByTime(31_000) })
    expect(recorder.finish).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('Mi voz', 'UklGRg==')
  })

  it('dice qué pasó si el micrófono no se puede usar o la toma no sirve', async () => {
    const denied = vi.fn(async () => { throw new DOMException('no', 'NotAllowedError') })
    const { unmount } = render(<PlumaVoiceRecorder disabled={false} onSave={vi.fn()} start={denied} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Grabar mi voz' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('no tiene permiso para usar el micrófono')
    unmount()
    const { recorder, start } = fakeRecorder()
    recorder.finish = vi.fn(async () => { throw new Error('No se oye tu voz.') })
    render(<PlumaVoiceRecorder disabled={false} onSave={vi.fn()} start={start} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Grabar mi voz' })) })
    await act(async () => { vi.advanceTimersByTime(6_000) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Terminar y usar esta voz' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('No se oye tu voz.')
  })

  it('no graba durante una llamada', () => {
    render(<PlumaVoiceRecorder disabled onSave={vi.fn()} start={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Grabar mi voz' })).toBeDisabled()
  })
})
