import { describe, expect, it } from 'vitest'
import {
  projectSourceLabels, projectStatusLabels, stepStatusLabels, type ProjectSource, type ProjectStatus, type StepStatus,
} from './types'

describe('projets — libellés et provenance', () => {
  it('couvre les 5 statuts de projet', () => {
    const statuses: ProjectStatus[] = ['active', 'paused', 'in_progress', 'completed', 'cancelled']
    expect(Object.keys(projectStatusLabels).sort()).toEqual([...statuses].sort())
    for (const status of statuses) expect(projectStatusLabels[status].length).toBeGreaterThan(2)
  })

  it('couvre les 3 provenances', () => {
    const sources: ProjectSource[] = ['dao', 'commande_directe', 'operation_commerciale']
    expect(Object.keys(projectSourceLabels).sort()).toEqual([...sources].sort())
  })

  it('couvre les 4 statuts d’étape', () => {
    const statuses: StepStatus[] = ['a_faire', 'en_cours', 'termine', 'bloque']
    expect(Object.keys(stepStatusLabels).sort()).toEqual([...statuses].sort())
  })
})
