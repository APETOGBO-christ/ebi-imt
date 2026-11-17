import { describe, expect, it } from 'vitest'
import { emptySettings } from './api'

describe('paramètres généraux (PROMPT 5)', () => {
  it('prépare une fiche de réglages conforme à l’architecture', () => {
    const settings = emptySettings()
    expect(settings.legal_name).toBe('EBI-IMT')
    expect(settings.currency).toBe('XOF')
    expect(settings.retention?.library_years).toBe(5)
    expect(settings.retention?.audit_years).toBe(10)
    expect(settings.finance?.default_vat_pct).toBe(18)
    expect(settings.enabled_modules).toEqual([])
  })

  it('garde la devise FCFA verrouillée', () => {
    expect(emptySettings().currency).toBe('XOF')
  })
})
