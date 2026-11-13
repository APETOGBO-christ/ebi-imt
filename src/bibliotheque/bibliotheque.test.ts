import { describe, expect, it } from 'vitest'
import { sha256Hex } from './api'
import { displayTitle, formatBytes, imageMimeTypes, type DocumentRow } from './types'

describe('bibliothèque (préparation des dépôts)', () => {
  it('calcule le SHA-256 côté navigateur (vecteur de référence)', async () => {
    const buffer = new TextEncoder().encode('abc').buffer as ArrayBuffer
    expect(await sha256Hex(buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const empty = new TextEncoder().encode('').buffer as ArrayBuffer
    expect(await sha256Hex(empty)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('affiche le titre déclaré, sinon le nom du fichier', () => {
    expect(displayTitle({ metadata: { title: 'Contrat cadre' }, storage_path: 'library/2026/11/u/contrat-cadre.pdf' })).toBe('Contrat cadre')
    expect(displayTitle({ metadata: null, storage_path: 'library/2026/11/u/contrat-cadre.pdf' })).toBe('contrat-cadre.pdf')
    expect(displayTitle({ metadata: { title: '   ' }, storage_path: 'library/x/y/fiche.png' })).toBe('fiche.png')
  })

  it('formate les tailles en unités lisibles', () => {
    expect(formatBytes(5)).toBe('5 o')
    expect(formatBytes(2048)).toBe('2 Ko')
    expect(formatBytes(3 * 1_048_576)).toBe('3.0 Mo')
  })

  it("reconnaît les types d'image prévisualisables", () => {
    expect(imageMimeTypes).toContain('image/png')
    expect(imageMimeTypes).not.toContain('application/pdf')
  })

  it("garde la structure attendue d'un document", () => {
    const row: DocumentRow = {
      id: '1', document_type: 'library_document', storage_path: 'library/x', content_hash: null,
      metadata: {}, family_key: null, document_version: null, supersedes_id: null,
      issued_at: null, created_at: '', deleted_at: null, deleted_by: null,
      deleted_reason: null, created_by: null, document_links: [],
    }
    expect(row.document_type).toBe('library_document')
    expect(row.deleted_at).toBeNull()
  })
})
