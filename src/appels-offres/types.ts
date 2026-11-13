export type TenderStatus = 'preparing' | 'submitted' | 'won' | 'lost' | 'cancelled'

export interface TenderRow {
  id: string
  tender_number: string
  title: string
  organism_company_id: string
  sector: string | null
  source: string | null
  submission_deadline: string
  opening_at: string | null
  status: TenderStatus
  preparation_notes: string | null
  awarded_amount_xof: string | number | null
  awarded_at: string | null
  lost_reason: string | null
  created_by: string
  created_at: string
  updated_at: string
  companies: { legal_name: string; trade_name: string | null } | null
}

export interface TenderItemRow {
  id: string
  tender_id: string
  position: number
  designation: string
  quantity: string | number
  unit: string | null
  unit_price_xof: string | number
  amount_xof: string | number
  notes: string | null
}

export interface TenderQuoteRow {
  id: string
  tender_item_id: string
  supplier_company_id: string
  quote_xof: string | number
  source: string | null
  notes: string | null
  companies: { legal_name: string; trade_name: string | null } | null
}

export interface TenderEventRow {
  id: string
  event_type: string
  details: Record<string, unknown>
  created_at: string
  profiles: { full_name: string | null } | null
}

export const tenderStatusLabels: Record<TenderStatus, string> = {
  preparing: 'En préparation',
  submitted: 'Soumis',
  won: 'Gagné',
  lost: 'Perdu',
  cancelled: 'Annulé',
}

export const tenderStatusClass: Record<TenderStatus, string> = {
  preparing: '',
  submitted: 'crm-status-proposal',
  won: 'crm-status-won',
  lost: 'crm-status-lost',
  cancelled: 'crm-status-cancelled',
}

export const tenderEventLabels: Record<string, string> = {
  created: 'Appel d’offres créé',
  updated: 'Dossier modifié',
  status_submitted: 'Dossier soumis',
  status_won: 'Appel d’offres gagné',
  status_lost: 'Appel d’offres perdu',
  status_cancelled: 'Appel d’offres annulé',
  item_added: 'Ligne ajoutée',
  item_removed: 'Ligne retirée',
  quote_set: 'Devis fournisseur enregistré',
}

export function companyLabel(company: { legal_name: string; trade_name: string | null } | null | undefined): string {
  if (!company) return '—'
  return company.trade_name?.trim() ? company.trade_name : company.legal_name
}

export function xof(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${new Intl.NumberFormat('fr-TG').format(Number(value))} FCFA`
}
