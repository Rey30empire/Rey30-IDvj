import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { browser } from '@wdio/globals'
import { assertNoModelOrChat, object, prepareMetadataProfile, qaIpc } from '../helpers/metadata-profile.js'
import { canonicalPath, containsPath } from '../launch-guard.js'

const TEXT = 'Esta es una prueba local de voz de Rey30, sin reproducir sonido.'
const VOICE = 'espeak:es-419+m1'
const PARAMETERS = { rate: 1, pitch: 1, volume: 0.7 }
const EXPECTED_VOICES = ['m1', 'm2', 'm3', 'm4', 'm5', 'f3'].map(variant => `espeak:es-419+${variant}`)

function inspectWave(bytes: Buffer) {
  assert(bytes.length > 44 && bytes.length <= 8 * 1024 * 1024, 'The fixed short phrase must produce a bounded, nonempty WAV')
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE')
  const end = bytes.readUInt32LE(4) + 8
  assert.equal(end, bytes.length, 'The RIFF size must match the decoded bytes')
  let format: { encoding: number; channels: number; sampleRate: number; byteRate: number; blockAlign: number; bits: number } | undefined
  let pcm: Buffer | undefined
  let offset = 12
  while (offset + 8 <= end) {
    const name = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    assert(start + size <= end, 'WAV chunk exceeds the RIFF boundary')
    if (name === 'fmt ') {
      assert(size >= 16, 'PCM format chunk is incomplete')
      format = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8), blockAlign: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) }
    }
    if (name === 'data') pcm = bytes.subarray(start, start + size)
    offset = start + size + (size % 2)
  }
  assert.equal(offset, end, 'WAV chunks must consume the RIFF payload')
  assert(format && pcm && pcm.length > 0, 'PCM format and data chunks are required')
  assert.equal(format.encoding, 1, 'The local eSpeak engine must return uncompressed PCM')
  assert.equal(format.channels, 1)
  assert.equal(format.bits, 16)
  assert(format.sampleRate >= 16_000 && format.sampleRate <= 48_000, 'Unexpected local synthesis sample rate')
  assert.equal(format.blockAlign, format.channels * 2)
  assert.equal(format.byteRate, format.sampleRate * format.blockAlign)
  assert.equal(pcm.length % format.blockAlign, 0)
  const samples = pcm.length / 2
  let squares = 0
  let peak = 0
  for (let index = 0; index < pcm.length; index += 2) {
    const value = pcm.readInt16LE(index) / 32768
    squares += value * value
    peak = Math.max(peak, Math.abs(value))
  }
  const rms = Math.sqrt(squares / samples)
  assert(rms > 0 && rms <= 1 && peak > 0, 'The synthesized waveform must contain nonzero audio samples')
  return { bytes: bytes.length, ...format, samples, seconds: samples / format.sampleRate, rms, peak, sha256: createHash('sha256').update(bytes).digest('hex') }
}

describe('native local character audio IPC without playback, microphone or LLM', () => {
  let fixture: Awaited<ReturnType<typeof prepareMetadataProfile>> | undefined
  let artifacts: string | undefined
  let appVersion: unknown
  let completed = false
  let catalog: Record<string, unknown> | undefined
  let wave: ReturnType<typeof inspectWave> | undefined
  let invalidRejected = false
  let successfulSynthesisRequests = 0
  let validSynthesisRequests = 0
  let invalidSynthesisRequests = 0
  const ownedJobs: string[] = []

  before(async () => {
    await browser.setTimeout({ script: 90_000 })
    fixture = await prepareMetadataProfile()
    const repo = canonicalPath(resolve(import.meta.dirname, '../..'))
    const output = canonicalPath(join(repo, 'artifacts', 'qa', 'character-audio-e2e'))
    assert(containsPath(repo, output))
    mkdirSync(output, { recursive: true })
    artifacts = mkdtempSync(join(output, 'run-'))
    appVersion = await qaIpc('plugin:app|version')
    assert.equal(appVersion, object(JSON.parse(readFileSync(join(repo, 'src-tauri', 'tauri.conf.json'), 'utf8'))).version, 'Run against the final matching native binary')
  })

  it('queries six installed Spanish variants and produces one measured PCM WAV through the real native bridge', async () => {
    assert(TEXT.length < 100)
    const catalogJob = randomUUID()
    ownedJobs.push(catalogJob)
    catalog = object(await qaIpc('character_audio_capabilities', { jobId: catalogJob }))
    assert.equal(catalog.localOnly, true)
    assert.equal(catalog.dictation, true, 'This distribution must expose its already installed local dictation resources')
    assert.equal(catalog.dictationLanguage, 'es')
    assert(Array.isArray(catalog.voices))
    const voices = catalog.voices.map(value => object(value))
    const spanish = voices.filter(voice => typeof voice.id === 'string' && voice.id.startsWith('espeak:es-419+'))
    assert.deepEqual(spanish.map(voice => voice.id).sort(), [...EXPECTED_VOICES].sort())
    assert(spanish.every(voice => voice.language === 'es-419' && voice.provider === 'eSpeak NG' && typeof voice.name === 'string'))

    const jobId = randomUUID()
    ownedJobs.push(jobId)
    validSynthesisRequests += 1
    const result = object(await qaIpc('character_audio_synthesize', { jobId, text: TEXT, voiceId: VOICE, ...PARAMETERS }))
    successfulSynthesisRequests += 1
    assert.equal(result.localOnly, true)
    assert.equal(result.mime, 'audio/wav')
    assert(typeof result.audioBase64 === 'string' && result.audioBase64.length <= 12 * 1024 * 1024 && result.audioBase64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(result.audioBase64), 'Native audio must be bounded, valid base64')
    const bytes = Buffer.from(result.audioBase64, 'base64')
    wave = inspectWave(bytes)
    writeFileSync(join(artifacts!, 'local-tts-sample.wav'), bytes)

    // The native validator rejects this request before starting its synthesis helper.
    const invalidJob = randomUUID()
    ownedJobs.push(invalidJob)
    invalidSynthesisRequests += 1
    await assert.rejects(
      qaIpc('character_audio_synthesize', { jobId: invalidJob, text: TEXT, voiceId: VOICE, ...PARAMETERS, rate: 0 }),
      /parámetros de voz están fuera de rango/,
    )
    invalidRejected = true
    assert(fixture!.requests.every(request => request.allowed))
    assertNoModelOrChat(fixture!.data)
    completed = true
  })

  after(async () => {
    for (const jobId of ownedJobs) await qaIpc('character_audio_cancel', { jobId }).catch(() => {})
    if (fixture) await fixture.close()
    if (artifacts) writeFileSync(join(artifacts, 'receipt.json'), JSON.stringify({
      status: completed ? 'passed' : 'incomplete-or-failed',
      scope: 'real-native-encoded-powershell-resource-dir-audio-ipc',
      appVersion, profile: fixture?.profile, data: fixture?.data,
      catalog: catalog ? { localOnly: catalog.localOnly, dictation: catalog.dictation, dictationLanguage: catalog.dictationLanguage, voices: catalog.voices } : null,
      synthesis: { text: TEXT, voiceId: VOICE, parameters: PARAMETERS, successfulRequests: successfulSynthesisRequests, validRequestsAttempted: validSynthesisRequests, invalidRequestsAttempted: invalidSynthesisRequests, invalidRejected, wav: wave ?? null },
      fixtureRequests: fixture?.requests,
      janModelRequests: 0, cloudRequestsBySpec: 0, microphoneRequests: 0, playbackRequests: 0, asrTranscriptionRequests: 0, asrModelLoadsRequested: 0, llmInferenceRequests: 0,
      humanListeningAccepted: false,
      limits: ['WAV bytes are synthesized and inspected but never played', 'Installed ASR availability is checked without loading an ASR model or transcribing', 'No physical microphone, perceived voice quality, prosody or conversational-model acceptance', 'Network observations are limited to the owned metadata fixture; this is not a system-wide packet capture'],
    }, null, 2))
    if (fixture) {
      assert(fixture.requests.every(request => request.allowed), 'The metadata-only provider received a prohibited request')
      assertNoModelOrChat(fixture.data)
    }
  })
})
