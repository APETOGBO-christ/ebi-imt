import { describe, expect, it } from 'vitest'
import {
  deliveryStatusLabels, invoiceStatusLabels, paymentMethodLabels, paymentStatusLabels,
  purchaseStatusLabels, purchaseTransitions, xof, type PurchaseStatus,
} from './types'

describe('achats — statuts et transitions (M45)', () => {
  it('couvre les 8 statuts d’achat', () => {
    const statuses: PurchaseStatus[] = ['draft', 'submitted', 'confirmed', 'sent', 'partially_received', 'received', 'closed', 'cancelled']
    expect(Object.keys(purchaseStatusLabels).sort()).toEqual([...statuses].sort())
  })

  it('le brouillon se soumet ou s’annule', () => {
    expect(purchaseTransitions.draft.map(item => item.to)).toEqual(['submitted', 'cancelled'])
  })

  it('la validation et la clôture exigent un validateur', () => {
    expect(purchaseTransitions.submitted.find(item => item.to === 'confirmed')?.validate).toBe(true)
    expect(purchaseTransitions.received.find(item => item.to === 'closed')?.validate).toBe(true)
  })

  it('les statuts terminaux n’ont aucune transition', () => {
    expect(purchaseTransitions.closed).toEqual([])
    expect(purchaseTransitions.cancelled).toEqual([])
  })

  it('la réception partielle précède la réception complète', () => {
    expect(purchaseTransitions.sent.map(item => item.to)).toEqual(expect.arrayContaining(['partially_received', 'received']))
    expect(purchaseTransitions.partially_received.map(item => item.to)).toEqual(['received', 'cancelled'])
  })
})

describe('achats — libellés factures, décaissements et réceptions', () => {
  it('couvre les statuts de facture', () => {
    expect(Object.keys(invoiceStatusLabels).sort()).toEqual(['disputed', 'paid', 'partially_paid', 'received', 'rejected'])
  })

  it('couvre les statuts de décaissement et les moyens de paiement', () => {
    expect(Object.keys(paymentStatusLabels).sort()).toEqual(['confirmed', 'pending', 'rejected'])
    expect(Object.keys(paymentMethodLabels).sort()).toEqual(['bank_transfer', 'cash', 'cheque', 'mobile_money'])
  })

  it('couvre les statuts de livraison', () => {
    expect(Object.keys(deliveryStatusLabels).sort()).toEqual(['cancelled', 'delivered', 'in_transit', 'partial', 'planned'])
  })

  it('formate les montants en FCFA', () => {
    expect(xof(1500000)).toContain('FCFA')
    expect(xof(null)).toBe('—')
  })
})
