import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ execute: vi.fn(), toast: vi.fn(), tools: vi.fn(async () => []) }))
vi.mock('@/lib/agentTools', () => ({ executeAgentTool: h.execute, validateCoworkFolder: vi.fn(async (folder: string) => folder) }))
vi.mock('sonner', () => ({ toast: { success: h.toast } }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ mcp: () => ({ getTools: h.tools }) }) }))

import { loadPlumaProject, runProjectTool, savePlumaProject, type PlumaProjectStorage } from '../pluma-project'
import { plumaActions } from '../pluma-actions'

const call = (name: string, args: object) => ({ function: { name, arguments: JSON.stringify(args) } })
function store(initial: string | null = null): PlumaProjectStorage {
  let value = initial
  return { read: async () => value, write: async next => { value = next } }
}

describe('edición de proyectos por voz', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); h.execute.mockResolvedValue({ content: 'ok' }) })

  it('empieza apagado y no permite edición sin carpeta', async () => {
    expect(await loadPlumaProject(store())).toEqual({ folder: null, canEdit: false })
    expect(await savePlumaProject({ folder: null, canEdit: true }, store())).toEqual({ folder: null, canEdit: false })
    expect(await loadPlumaProject(store('{roto'))).toEqual({ folder: null, canEdit: false })
  })

  it('no ofrece herramientas de proyecto hasta activar el permiso', async () => {
    await savePlumaProject({ folder: 'C:/app', canEdit: false })
    let actions = await plumaActions()
    expect(actions.owns('proyecto_editar')).toBe(false)
    expect(actions.prompt).toBeUndefined()
    await savePlumaProject({ folder: 'C:/app', canEdit: true })
    actions = await plumaActions()
    expect(actions.owns('proyecto_editar')).toBe(true)
    expect(actions.prompt).toContain('C:/app')
    expect(actions.maxRounds).toBe(8)
  })

  it('edita dentro de la carpeta en modo escritura y lo avisa en pantalla', async () => {
    const result = await runProjectTool(call('proyecto_editar', { ruta: 'a.ts', buscar: 'uno', texto: 'dos' }), 'C:/app', 's')
    expect(h.execute).toHaveBeenCalledWith('edit', { path: 'a.ts', edits: [{ old_string: 'uno', new_string: 'dos' }] }, 's', 'C:/app', 'session', false, true)
    expect(result).toContain('Guardado a.ts')
    expect(h.toast).toHaveBeenCalledWith('Plumita editó a.ts')
  })

  it.each([
    ['Windows en inglés', 'ERROR: The system cannot find the file specified. (os error 2)'],
    ['Windows en español', 'ERROR: El sistema no puede encontrar el archivo especificado. (os error 2)'],
    ['carpeta que no existe', 'ERROR: The system cannot find the path specified. (os error 3)'],
    ['Linux', 'ERROR: No such file or directory (os error 2)'],
  ])('crea el archivo cuando de verdad no existe (%s)', async (_name, error) => {
    h.execute.mockResolvedValueOnce({ error }).mockResolvedValueOnce({ content: 'ok' })
    expect(await runProjectTool(call('proyecto_crear', { ruta: 'b.ts', texto: 'x' }), 'C:/app', 's')).toContain('Creado b.ts')
    expect(h.execute.mock.calls.map(([name]) => name)).toEqual(['read', 'write'])
  })

  it('comprueba sin leer el contenido, para que un archivo no pueda hacerse pasar por inexistente', async () => {
    h.execute.mockResolvedValueOnce({ error: 'ERROR: offset 1000000000 is beyond end of file (3 lines total)' })
    await runProjectTool(call('proyecto_crear', { ruta: 'a.log', texto: 'x' }), 'C:/app', 's')
    expect(h.execute.mock.calls[0][1]).toEqual({ path: 'a.log', offset: 1_000_000_000, limit: 1 })
  })

  it.each([
    ['con contenido', { content: 'ok' }],
    ['de texto, al comprobarlo', { error: 'ERROR: offset 1000000000 is beyond end of file (3 lines total)' }],
    ['binario o en UTF-16', { error: 'ERROR: not a UTF-8 text file' }],
  ])('nunca sobrescribe un archivo existente %s', async (_name, probe) => {
    h.execute.mockResolvedValueOnce(probe)
    const result = await runProjectTool(call('proyecto_crear', { ruta: 'a.ts', texto: 'x' }), 'C:/app', 's')
    expect(result).toContain('ya existe')
    expect(h.execute.mock.calls.map(([name]) => name)).toEqual(['read'])
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('no crea el archivo si no puede saber si existe', async () => {
    h.execute.mockResolvedValueOnce({ error: 'ERROR: Access is denied. (os error 5)' })
    const result = await runProjectTool(call('proyecto_crear', { ruta: 'a.ts', texto: 'x' }), 'C:/app', 's')
    expect(result).toContain('no lo toqué')
    expect(h.execute.mock.calls.map(([name]) => name)).toEqual(['read'])
  })

  describe('rutas protegidas', () => {
    it.each([
      '.git/hooks/pre-commit',
      '.GIT\\hooks\\pre-commit',
      'sub/.git/config',
      '.git./hooks/pre-commit',
      '.git /hooks/pre-commit',
      '.git::$INDEX_ALLOCATION/hooks/pre-commit',
      'git~1/hooks/pre-commit',
      'C:/app/.git/hooks/pre-commit',
      '.husky/pre-commit',
      '.github/workflows/ci.yml',
      '.vscode/tasks.json',
    ])('no escribe en %s', async ruta => {
      const created = await runProjectTool(call('proyecto_crear', { ruta, texto: 'x' }), 'C:/app', 's')
      const edited = await runProjectTool(call('proyecto_editar', { ruta, buscar: 'a', texto: 'b' }), 'C:/app', 's')
      expect(created).toContain('protegida')
      expect(edited).toContain('protegida')
      expect(h.execute).not.toHaveBeenCalled()
      expect(h.toast).not.toHaveBeenCalled()
    })

    it.each([
      '.env', 'config/.env.local', '.ENV.production', '.git/config', '.ssh/config', 'claves/id_rsa', 'claves/id_ed25519',
      'cert.PEM', 'servidor.key', 'firma.pfx', 'firma.p12', '.npmrc', '.netrc',
    ])('no lee ni escribe el archivo secreto %s', async ruta => {
      const read = await runProjectTool(call('proyecto_leer', { ruta }), 'C:/app', 's')
      const edited = await runProjectTool(call('proyecto_editar', { ruta, buscar: 'a', texto: 'b' }), 'C:/app', 's')
      expect(read).toContain('protegida')
      expect(edited).toContain('protegida')
      expect(h.execute).not.toHaveBeenCalled()
    })

    it('no lista por dentro una carpeta protegida', async () => {
      expect(await runProjectTool(call('proyecto_listar', { ruta: '.git/hooks' }), 'C:/app', 's')).toContain('protegida')
      expect(h.execute).not.toHaveBeenCalled()
    })

    it.each(['src/main.ts', '.env.example', '.env.sample', 'docs/.gitkeep', '.gitignore', 'digit~/x.ts', 'keys.ts', 'github/ci.yml'])('deja trabajar con %s', async ruta => {
      await runProjectTool(call('proyecto_leer', { ruta }), 'C:/app', 's')
      expect(h.execute.mock.calls.map(([name]) => name)).toEqual(['read'])
    })

    it('saca de la búsqueda las líneas de archivos protegidos', async () => {
      h.execute.mockResolvedValueOnce({ content: '.env:1:TOKEN=abc\nsrc/a.ts:3:const TOKEN = leer()\n.git/config:9:url = https://TOKEN@x\ncert.pem:2:TOKEN' })
      const result = await runProjectTool(call('proyecto_buscar', { texto: 'TOKEN' }), 'C:/app', 's')
      expect(result).toBe('src/a.ts:3:const TOKEN = leer()')
    })

    it('avisa cuando todos los resultados de la búsqueda eran protegidos', async () => {
      h.execute.mockResolvedValueOnce({ content: '.env:1:TOKEN=abc' })
      expect(await runProjectTool(call('proyecto_buscar', { texto: 'TOKEN' }), 'C:/app', 's')).toBe('(Sin resultados.)')
    })
  })

  it('devuelve el error al modelo y no anuncia un cambio que falló', async () => {
    h.execute.mockResolvedValueOnce({ error: 'fuera de la carpeta' })
    expect(await runProjectTool(call('proyecto_editar', { ruta: '../x', buscar: 'a', texto: 'b' }), 'C:/app', 's')).toContain('fuera de la carpeta')
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('no tiene herramientas para borrar ni ejecutar', async () => {
    expect(await runProjectTool(call('proyecto_borrar', { ruta: 'a.ts' }), 'C:/app', 's')).toBe('Herramienta desconocida.')
    expect(h.execute).not.toHaveBeenCalled()
  })
})
