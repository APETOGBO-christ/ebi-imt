export type TenderStatus = 'identifie' | 'a_analyser' | 'en_preparation' | 'attente_documents' | 'pret_deposer' | 'depose' | 'en_evaluation' | 'gagne' | 'perdu' | 'annule'

export const preDepositStatuses: TenderStatus[] = ['identifie', 'a_analyser', 'en_preparation', 'attente_documents', 'pret_deposer']

/** Transitions autorisées (miroir client de tender_set_status, M30). */
export const allowedTransitions: Record<TenderStatus, TenderStatus[]> = {
  identifie: ['a_analyser', 'en_preparation', 'attente_documents', 'pret_deposer', 'depose', 'annule'],
  a_analyser: ['en_preparation', 'attente_documents', 'pret_deposer', 'depose', 'annule'],
  en_preparation: ['attente_documents', 'pret_deposer', 'depose', 'annule'],
  attente_documents: ['en_preparation', 'pret_deposer', 'depose', 'annule'],
  pret_deposer: ['depose', 'annule'],
  depose: ['en_evaluation', 'gagne', 'perdu', 'annule'],
  en_evaluation: ['gagne', 'perdu', 'annule'],
  gagne: [], perdu: [], annule: [],
}

export const terminalStatuses: TenderStatus[] = ['gagne', 'perdu', 'annule']

export type TenderCategory = 'dao' | 'pieces_administratives' | 'offre_technique' | 'offre_financiere' | 'devis_fournisseurs' | 'justificatifs' | 'correspondances' | 'proces_verbaux' | 'resultats'

export const tenderCategoryLabels: Record<TenderCategory, string> = {
  dao: 'DAO (dossier d’appel d’offres)',
  pieces_administratives: 'Pièces administratives',
  offre_technique: 'Offre technique',
  offre_financiere: 'Offre financière',
  devis_fournisseurs: 'Devis fournisseurs',
  justificatifs: 'Justificatifs',
  correspondances: 'Correspondances',
  proces_verbaux: 'Procès-verbaux',
  resultats: 'Résultats',
}

export interface TenderRow {
  id: string
  tender_number: string
  title: string
  organism_company_id: string
  sector: string | null
  source: string | null
  description: string | null
  publication_date: string | null
  submission_deadline: string
  opening_at: string | null
  status: TenderStatus
  observations: string | null
  estimated_amount_xof: string | number | null
  our_amount_xof: string | number | null
  awarded_amount_xof: string | number | null
  awarded_at: string | null
  lost_reason: string | null
  responsible_id: string | null
  created_by: string
  created_at: string
  updated_at: string
  companies: { legal_name: string; trade_name: string | null } | { legal_name: string; trade_name: string | null }[] | null
  profiles?: { full_name: string | null } | { full_name: string | null }[] | null
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
  companies: { legal_name: string; trade_name: string | null } | { legal_name: string; trade_name: string | null }[] | null
}

export interface TenderEventRow {
  id: string
  event_type: string
  details: Record<string, unknown>
  created_at: string
  profiles: { full_name: string | null } | { full_name: string | null }[] | null
}

export interface TenderTaskRow {
  id: string
  tender_id: string
  title: string
  due_date: string | null
  assignee_id: string | null
  is_done: boolean
  created_at: string
  profiles?: { full_name: string | null } | { full_name: string | null }[] | null
}

export interface TenderReminderRow {
  id: string
  tender_id: string
  remind_at: string
  note: string | null
  is_done: boolean
  created_at: string
}

export interface TenderCommentRow {
  id: string
  tender_id: string
  author_id: string
  body: string
  created_at: string
  profiles?: { full_name: string | null } | { full_name: string | null }[] | null
}

export interface TenderDocumentRow {
  id: string
  tender_id: string
  document_id: string
  category: TenderCategory
  title: string
  created_at: string
  documents?: { content_hash: string | null; metadata: Record<string, unknown> | null; created_at: string } | { content_hash: string | null; metadata: Record<string, unknown> | null; created_at: string }[] | null
}

export interface LinkedOrderRow { id: string; order_number: string; amount_xof: string | number; order_status: string }
export interface LinkedProposalRow { id: string; proposal_number: string; status: string }

export const tenderStatusLabels: Record<TenderStatus, string> = {
  identifie: 'Identifié',
  a_analyser: 'À analyser',
  en_preparation: 'En préparation',
  attente_documents: 'En attente de documents',
  pret_deposer: 'Prêt à déposer',
  depose: 'Déposé',
  en_evaluation: 'En évaluation',
  gagne: 'Gagné',
  perdu: 'Perdu',
  annule: 'Annulé',
}

export const tenderStatusClass: Record<TenderStatus, string> = {
  identifie: '',
  a_analyser: 'crm-status-negotiation',
  en_preparation: 'crm-status-proposal',
  attente_documents: 'crm-status-negotiation',
  pret_deposer: 'crm-status-proposal',
  depose: 'crm-status-qualified',
  en_evaluation: 'crm-status-proposal',
  gagne: 'crm-status-won',
  perdu: 'crm-status-lost',
  annule: 'crm-status-cancelled',
}

/** Libellés rétrocompatibles pour l'historique des migrations 20-29. */
export const tenderEventLabels: Record<string, string> = {
  created: 'Appel d’offres créé',
  updated: 'Dossier modifié',
  status_submitted: 'Dossier déposé',
  status_won: 'Appel d’offres gagné',
  status_lost: 'Appel d’offres perdu',
  status_cancelled: 'Appel d’offres annulé',
  status_identifie: 'Marqué identifié',
  status_a_analyser: 'Marqué à analyser',
  status_en_preparation: 'Passé en préparation',
  status_attente_documents: 'En attente de documents',
  status_pret_deposer: 'Prêt à déposer',
  status_depose: 'Dossier déposé',
  status_en_evaluation: 'En évaluation',
  status_gagne: 'Appel d’offres gagné',
  status_perdu: 'Appel d’offres perdu',
  status_annule: 'Appel d’offres annulé',
  item_added: 'Ligne ajoutée',
  item_removed: 'Ligne retirée',
  quote_set: 'Devis fournisseur enregistré',
}

export function companyLabel(company: { legal_name: string; trade_name: string | null } | null | undefined): string {
  if (!company) return '—'
  return company.trade_name?.trim() ? company.trade_name : company.legal_name
}

/** Premier élément d'un embed PostgREST (tableau par défaut). */
export function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export function xof(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${new Intl.NumberFormat('fr-TG').format(Number(value))} FCFA`
}

export function shortDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-TG', { day: '2-digit', month: 'short', year: 'numeric' })
}
