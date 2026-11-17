import { describe, expect, it } from 'vitest'
import {
  allowedTransitions, availabilityLabels, preDepositStatuses, tenderItemCategoryLabels,
  tenderTotals, terminalStatuses, type TenderStatus,
} from './types'

describe('appels d’offres — totaux HT / TVA / TTC', () => {
  it('calcule HT, TVA et TTC à partir des lignes', () => {
    const items = [{ amount_xof: '100000' }, { amount_xof: 50000 }]
    const totals = tenderTotals(items, 18)
    expect(totals.ht).toBe(150000)
    expect(totals.tva).toBe(27000)
    expect(totals.ttc).toBe(177000)
  })

  it('gère les lignes vides et un taux nul', () => {
    const totals = tenderTotals([], 0)
    expect(totals.ht).toBe(0)
    expect(totals.tva).toBe(0)
    expect(totals.ttc).toBe(0)
  })

  it('arrondit la TVA au franc', () => {
    const totals = tenderTotals([{ amount_xof: 33333 }], 18)
    expect(totals.tva).toBe(6000)
    expect(totals.ttc).toBe(39333)
  })
})

describe('appels d’offres — machine à états (M41)', () => {
  it('les statuts terminaux n’ont aucune transition', () => {
    for (const status of terminalStatuses) expect(allowedTransitions[status]).toEqual([])
  })

  it('chaque statut a une entrée dans la table de transitions', () => {
    const statuses: TenderStatus[] = ['identifie', 'a_analyser', 'en_analyse', 'decision_soumission', 'en_preparation', 'en_validation', 'attente_documents', 'pret_deposer', 'depose', 'en_evaluation', 'gagne', 'perdu', 'annule', 'abandonne']
    for (const status of statuses) expect(allowedTransitions[status]).toBeDefined()
  })

  it('depose ne permet plus d’éditer les lignes (hors pré-dépôt)', () => {
    expect(preDepositStatuses).not.toContain('depose')
    expect(preDepositStatuses).toContain('en_analyse')
    expect(preDepositStatuses).toContain('decision_soumission')
    expect(preDepositStatuses).toContain('en_validation')
  })

  it('depose mène vers évaluation, gain, perte ou annulation', () => {
    expect(allowedTransitions.depose).toEqual(expect.arrayContaining(['en_evaluation', 'gagne', 'perdu', 'annule']))
  })

  it('abandonne est terminal et accessible avant le dépôt', () => {
    expect(allowedTransitions.en_preparation).toContain('abandonne')
    expect(allowedTransitions.abandonne).toEqual([])
  })
})

describe('appels d’offres — libellés', () => {
  it('couvre les catégories de lignes et la disponibilité', () => {
    expect(tenderItemCategoryLabels).toEqual({ equipement: 'Équipement', prestation: 'Prestation' })
    expect(Object.keys(availabilityLabels).sort()).toEqual(['a_commander', 'en_stock', 'sur_devis'])
  })
})
