import { describe, expect, it } from 'vitest'
import { displayCompany, emptyCompany, roleCodeLabels, activityTypeLabels, type CompanyInput } from './types'

describe('sociétés (affichage et référentiel)', () => {
  it('affiche le nom commercial en priorité', () => {
    expect(displayCompany({ trade_name: ' Filiale Ouest ', legal_name: 'Comptoir Logistique SARL' })).toBe('Filiale Ouest')
    expect(displayCompany({ trade_name: null, legal_name: 'Comptoir Logistique SARL' })).toBe('Comptoir Logistique SARL')
    expect(displayCompany({ trade_name: '', legal_name: 'Société Vide' })).toBe('Société Vide')
  })

  it('propose exactement les quatre rôles cumulables', () => {
    expect(Object.keys(roleCodeLabels).sort()).toEqual(['agence', 'client', 'fournisseur', 'partenaire'])
  })

  it("propose les six types d'échange attendus par la base", () => {
    expect(Object.keys(activityTypeLabels).sort())
      .toEqual(['call', 'email', 'meeting', 'note', 'other', 'visit'])
  })

  it('fournit une fiche vierge complète', () => {
    const input: CompanyInput = emptyCompany
    expect(Object.keys(input).sort()).toEqual([
      'address', 'city', 'email', 'industry', 'legal_name', 'notes',
      'phone', 'registration_number', 'role_codes', 'tax_number', 'trade_name', 'website',
    ])
    expect(input.role_codes).toEqual([])
  })
})
