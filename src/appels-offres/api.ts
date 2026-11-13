import { supabase } from '../lib/supabase'
import type { TenderItemRow, TenderQuoteRow, TenderEventRow, TenderRow, TenderStatus } from './types'

export interface TenderFilters {
  search: string
  status: '' | TenderStatus
  sort: 'deadline' | 'created' | 'number'
  dir: 'asc' | 'desc'
  page: number
  pageSize: number
}

export interface TenderListResult { rows: TenderRow[]; total: number }

function client() {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  return supabase
}

export async function listTenders(filters: TenderFilters): Promise<TenderListResult> {
  const db = client()
  let query = db.from('tenders').select('*, companies!organism_company_id(legal_name, trade_name)', { count: 'exact' })
  const search = filters.search.trim()
  if (search) query = query.or(`title.ilike.%${search}%,tender_number.ilike.%${search}%`)
  if (filters.status) query = query.eq('status', filters.status)
  const column = filters.sort === 'deadline' ? 'submission_deadline' : filters.sort === 'number' ? 'tender_number' : 'created_at'
  query = query.order(column, { ascending: filters.dir === 'asc' }).order('id')
  const from = filters.page * filters.pageSize
  const { data, error, count } = await query.range(from, from + filters.pageSize - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as TenderRow[], total: count ?? 0 }
}

export interface TenderDetail {
  tender: TenderRow
  items: TenderItemRow[]
  quotes: TenderQuoteRow[]
  events: TenderEventRow[]
}

export async function getTender(id: string): Promise<TenderDetail> {
  const db = client()
  const [tender, items, quotes, events] = await Promise.all([
    db.from('tenders').select('*, companies!organism_company_id(legal_name, trade_name)').eq('id', id).single(),
    db.from('tender_items').select('*').eq('tender_id', id).order('position'),
    db.from('tender_quotes').select('*, companies!supplier_company_id(legal_name, trade_name)').eq('tender_id', id).order('quote_xof'),
    db.from('tender_events').select('*, profiles!actor_id(full_name)').eq('tender_id', id).order('created_at', { ascending: false }).limit(60),
  ])
  if (tender.error) throw new Error(tender.error.message)
  if (items.error) throw new Error(items.error.message)
  if (quotes.error) throw new Error(quotes.error.message)
  if (events.error) throw new Error(events.error.message)
  return { tender: tender.data as TenderRow, items: (items.data ?? []) as TenderItemRow[], quotes: (quotes.data ?? []) as TenderQuoteRow[], events: (events.data ?? []) as TenderEventRow[] }
}

export interface CompanyOption { id: string; legal_name: string; trade_name: string | null }

export async function listCompanyOptions(): Promise<CompanyOption[]> {
  const db = client()
  const { data, error } = await db.from('companies').select('id, legal_name, trade_name, is_active').eq('is_active', true).order('legal_name').limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []) as CompanyOption[]
}

export interface TenderPayload {
  p_title: string
  p_organism_company_id: string
  p_sector: string | null
  p_source: string | null
  p_submission_deadline: string
  p_opening_at: string | null
  p_notes: string | null
}

function rpc(name: string, payload: object) {
  return client().rpc(name, payload as Record<string, unknown>)
}

export async function createTender(payload: TenderPayload): Promise<string> {
  const { data, error } = await rpc('tender_create', payload)
  if (error) throw new Error(error.message)
  return String(data)
}

export async function updateTender(id: string, payload: TenderPayload): Promise<void> {
  const { error } = await rpc('tender_update', { p_id: id, ...payload })
  if (error) throw new Error(error.message)
}

export async function setTenderStatus(id: string, status: TenderStatus, extra: { p_awarded_amount_xof?: number; p_lost_reason?: string }): Promise<void> {
  const { error } = await rpc('tender_set_status', { p_id: id, p_status: status, ...extra })
  if (error) throw new Error(error.message)
}

export async function addTenderItem(tenderId: string, item: { p_designation: string; p_quantity: number; p_unit: string | null; p_unit_price_xof: number; p_notes: string | null }): Promise<void> {
  const { error } = await rpc('tender_item_add', { p_tender_id: tenderId, ...item })
  if (error) throw new Error(error.message)
}

export async function removeTenderItem(itemId: string): Promise<void> {
  const { error } = await rpc('tender_item_remove', { p_item_id: itemId })
  if (error) throw new Error(error.message)
}

export async function setTenderQuote(tenderId: string, itemId: string, supplierCompanyId: string, quoteXof: number, source: string | null, notes: string | null): Promise<void> {
  const { error } = await rpc('tender_quote_set', { p_tender_id: tenderId, p_tender_item_id: itemId, p_supplier_company_id: supplierCompanyId, p_quote_xof: quoteXof, p_source: source, p_notes: notes })
  if (error) throw new Error(error.message)
}
