import { generateText } from 'ai'
import { CHAT_SLOT_ID } from '@/constants/models'
import { useModelProvider } from '@/hooks/useModelProvider'
import { isLiteraryModelProvider, literaryLibraryContext } from '@/lib/literaryLibrary'
import { ModelFactory } from '@/lib/model-factory'
import { responseGuidance } from '@/lib/responseGuidance'
import { getOriginalProfile } from './profiles'

const maxQueryLength = 4000
const plumaModelId = 'Qwen3.5-9B-Q4_K_M'

export const plumaRealtimeInstructions = [
  responseGuidance,
  'Eres Pluma, lectora y editora literaria. Habla en español natural con frases breves, sin marcas de Markdown ni símbolos sueltos.',
  'Respond with interleaved text and audio.',
  'Responde directamente a saludos, despedidas y charla breve, sin usar herramientas. Ante un saludo, di una sola frase breve y termina.',
  'Para consultar la biblioteca local, analizar pasajes, escribir o revisar una obra o resolver una petición que requiera razonamiento, llama a consultar_pluma con la petición completa y sus restricciones.',
  'Al preparar la consulta, conserva lo que oíste. No añadas títulos, nombres propios ni restricciones que el usuario no haya dicho.',
  'Al hablar, usa el resultado de la consulta y conserva su distinción entre citas, interpretación y creación original. Si falta una fuente, dilo. Nunca inventes citas ni rutas.',
].join(' ')

export const plumaReasoningTool = {
  type: 'function',
  name: 'consultar_pluma',
  description: 'Consulta la biblioteca local y pide a Qwen3.5-9B un análisis o una respuesta literaria. Úsala para obras, citas, escritura, revisión y razonamiento.',
  parameters: {
    type: 'object',
    properties: {
      consulta: { type: 'string', description: 'La petición completa en español, incluidas sus restricciones.', maxLength: maxQueryLength },
    },
    required: ['consulta'],
    additionalProperties: false,
  },
} as const

export async function answerWithPluma(query: string, sessionId: string, signal?: AbortSignal): Promise<string> {
  const text = query.trim()
  if (!text || text.length > maxQueryLength) throw new Error('La consulta de Pluma está vacía o es demasiado larga.')
  signal?.throwIfAborted()

  const provider = useModelProvider.getState().getProviderByName('llamacpp')
  if (!provider || provider.active === false || !isLiteraryModelProvider(provider)) {
    throw new Error('Activa llama.cpp en Rey30 para consultar la biblioteca de Pluma.')
  }
  const models = provider.models.filter(model => !model.embedding && !model.capabilities?.includes('embeddings'))
  const modelId = models.find(model => model.id === plumaModelId)?.id ??
    models.find(model => /^Qwen3\.5-9B(?:$|-)/i.test(model.id))?.id
  if (!modelId) throw new Error('Instala Qwen3.5-9B en Rey30 para consultar la biblioteca de Pluma.')

  const context = await literaryLibraryContext(text, { kind: 'realtime', sessionId })
  signal?.throwIfAborted()
  const model = await ModelFactory.createModel(modelId, provider, {
    id_slot: CHAT_SLOT_ID,
    thread_id: 'background:pluma-voz',
  }, true)
  signal?.throwIfAborted()

  const result = await generateText({
    model,
    system: [
      responseGuidance,
      getOriginalProfile('literatura').instructions,
      'Redacta en español una respuesta lista para decir en voz alta, sin marcas de Markdown ni símbolos sueltos. Usa un párrafo breve salvo que la petición necesite una lectura o creación más extensa. Usa solo fragmentos pertinentes y atribuye cada cita a la ruta relativa presente en el resultado.',
      context,
    ].filter(Boolean).join('\n\n'),
    prompt: text,
    maxOutputTokens: 768,
    maxRetries: 0,
    abortSignal: signal,
  })
  signal?.throwIfAborted()
  const answer = result.text.trim()
  if (!answer) throw new Error('Qwen3.5-9B no devolvió una respuesta para esta consulta.')
  return answer
}
