/**
 * Default Projects Service - localStorage implementation
 */

import { ulid } from 'ulidx'
import type { ProjectsService, ThreadFolder } from './types'
import { localStorageKey } from '@/constants/localStorage'

export class DefaultProjectsService implements ProjectsService {
  private storageKey = localStorageKey.threadManagement

  private loadFromStorage(requireReadable = false): ThreadFolder[] {
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (!stored) return []
      const data = JSON.parse(stored)
      return data.state?.folders || []
    } catch (error) {
      console.error('Error loading projects from localStorage:', error)
      if (requireReadable) throw new Error('No se pudieron leer los proyectos guardados.')
      return []
    }
  }

  private saveToStorage(projects: ThreadFolder[]): boolean {
    try {
      const data = {
        state: { folders: projects },
        version: 0,
      }
      localStorage.setItem(this.storageKey, JSON.stringify(data))
      return true
    } catch (error) {
      console.error('Error saving projects to localStorage:', error)
      return false
    }
  }

  async getProjects(): Promise<ThreadFolder[]> {
    return this.loadFromStorage()
  }

  async addProject(name: string, assistantId?: string): Promise<ThreadFolder> {
    const newProject: ThreadFolder = {
      id: ulid(),
      name,
      updated_at: Date.now(),
      assistantId,
    }

    const projects = this.loadFromStorage()
    const updatedProjects = [...projects, newProject]
    this.saveToStorage(updatedProjects)

    return newProject
  }

  async openWorkspaceProject(workspaceFolder: string): Promise<ThreadFolder> {
    const projects = this.loadFromStorage(true)
    const existing = projects.find(project => project.workspaceFolder === workspaceFolder)
    if (existing) return existing

    const baseName = workspaceFolder.split(/[\\/]/).filter(Boolean).at(-1) ?? workspaceFolder
    const names = new Set(projects.map(project => project.name.toLowerCase()))
    let name = baseName
    for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `${baseName} (${suffix})`
    const project = { id: ulid(), name, updated_at: Date.now(), workspaceFolder }
    if (!this.saveToStorage([...projects, project])) throw new Error('No se pudo guardar el proyecto con su carpeta local.')
    return project
  }

  async updateProject(id: string, name: string, assistantId?: string): Promise<void> {
    const projects = this.loadFromStorage()
    const updatedProjects = projects.map((project) =>
      project.id === id
        ? { ...project, name, updated_at: Date.now(), assistantId }
        : project
    )
    this.saveToStorage(updatedProjects)
  }

  async deleteProject(id: string): Promise<void> {
    const projects = this.loadFromStorage()
    const updatedProjects = projects.filter((project) => project.id !== id)
    this.saveToStorage(updatedProjects)
  }

  async getProjectById(id: string): Promise<ThreadFolder | undefined> {
    const projects = this.loadFromStorage()
    return projects.find((project) => project.id === id)
  }

  async setProjects(projects: ThreadFolder[]): Promise<void> {
    this.saveToStorage(projects)
  }
}
