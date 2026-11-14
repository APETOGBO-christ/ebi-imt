import { supabase } from '../lib/supabase'
import { uploadDocument } from '../bibliotheque/api'
import type {
  TenderCategory, TenderCommentRow, TenderDocumentRow, TenderEventRow, TenderItemRow,
  TenderQuoteRow, TenderReminderRow, TenderRow, TenderStatus, TenderTaskRow,
} from './types'
import { firstEmbed } from './types'

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

function rpc(name: string, payload: object) {
  return client().rpc(name, payload as Record<string, unknown>)
}

export async function listTenders(filters: TenderFilters): Promise<TenderListResult> {
  const db = client()
  let query = db.from('tenders').select('*, companies!organism_company_id(legal_name, trade_name), profiles!responsible_id(full_name)', { count: 'exact' })
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
  tasks: TenderTaskRow[]
  reminders: TenderReminderRow[]
  comments: TenderCommentRow[]
  documents: TenderDocumentRow[]
  linkedOrders: { id: string; order_number: string; amount_xof: string | number; order_status: string }[]
  linkedProposals: { id: string; proposal_number: string; status: string }[]
  linkedDeliveries: { id: string; delivery_number: string; kind: string; status: string; delivered_at: string | null }[]
}

export async function getTender(id: string): Promise<TenderDetail> {
  const db = client()
  const [tender, items, quotes, events, tasks, reminders, comments, documents, orders, proposals, deliveries] = await Promise.all([
    db.from('tenders').select('*, companies!organism_company_id(legal_name, trade_name), profiles!responsible_id(full_name)').eq('id', id).single(),
    db.from('tender_items').select('*, offer_templates!offer_template_id(name)').eq('tender_id', id).order('position'),
    db.from('tender_quotes').select('*, companies!supplier_company_id(legal_name, trade_name)').eq('tender_id', id).order('quote_xof'),
    db.from('tender_events').select('*, profiles!actor_id(full_name)').eq('tender_id', id).order('created_at', { ascending: false }).limit(80),
    db.from('tender_tasks').select('*, profiles!assignee_id(full_name)').eq('tender_id', id).order('is_done').order('due_date', { ascending: true, nullsFirst: false }),
    db.from('tender_reminders').select('*').eq('tender_id', id).order('remind_at'),
    db.from('tender_comments').select('*, profiles!author_id(full_name)').eq('tender_id', id).order('created_at', { ascending: false }).limit(100),
    db.from('tender_documents').select('*, documents(content_hash, metadata, created_at)').eq('tender_id', id).order('created_at', { ascending: false }),
    db.from('orders').select('id, order_number, amount_xof, order_status').eq('tender_id', id).order('created_at', { ascending: false }),
    db.from('commercial_proposals').select('id, proposal_number, status').eq('tender_id', id).order('created_at', { ascending: false }),
    db.from('deliveries').select('id, delivery_number, kind, status, delivered_at, orders!inner(tender_id)').eq('orders.tender_id', id).order('created_at', { ascending: false }).then(
      result => result.error ? { data: [] } : result
    ),
  ])
  if (tender.error) throw new Error(tender.error.message)
  if (items.error) throw new Error(items.error.message)
  if (quotes.error) throw new Error(quotes.error.message)
  if (events.error) throw new Error(events.error.message)
  if (tasks.error) throw new Error(tasks.error.message)
  if (reminders.error) throw new Error(reminders.error.message)
  if (comments.error) throw new Error(comments.error.message)
  if (documents.error) throw new Error(documents.error.message)
  if (orders.error) throw new Error(orders.error.message)
  if (proposals.error) throw new Error(proposals.error.message)
  return {
    tender: tender.data as TenderRow,
    items: (items.data ?? []) as TenderItemRow[],
    quotes: (quotes.data ?? []) as TenderQuoteRow[],
    events: (events.data ?? []) as TenderEventRow[],
    tasks: (tasks.data ?? []) as TenderTaskRow[],
    reminders: (reminders.data ?? []) as TenderReminderRow[],
    comments: (comments.data ?? []) as TenderCommentRow[],
    documents: (documents.data ?? []) as TenderDocumentRow[],
    linkedOrders: (orders.data ?? []) as TenderDetail['linkedOrders'],
    linkedProposals: (proposals.data ?? []) as TenderDetail['linkedProposals'],
    linkedDeliveries: ((deliveries as { data?: unknown }).data ?? []) as TenderDetail['linkedDeliveries'],
  }
}

export interface CompanyOption { id: string; legal_name: string; trade_name: string | null }

export async function listCompanyOptions(): Promise<CompanyOption[]> {
  const db = client()
  const { data, error } = await db.from('companies').select('id, legal_name, trade_name, is_active').eq('is_active', true).order('legal_name').limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []) as CompanyOption[]
}

export interface PersonOption { id: string; full_name: string }

export async function listResponsibleOptions(): Promise<PersonOption[]> {
  const db = client()
  const { data, error } = await db.from('profiles').select('id, full_name').eq('is_active', true).order('full_name').limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []) as PersonOption[]
}

export interface LinkableOrder { id: string; order_number: string; tender_id: string | null }
export interface LinkableProposal { id: string; proposal_number: string; tender_id: string | null }
export interface ProductOption { id: string; name: string; price_xof: string | number }

export async function listProductOptions(): Promise<ProductOption[]> {
  const db = client()
  const { data, error } = await db.from('offer_templates').select('id, name, price_xof').eq('status', 'active').order('name').limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []) as ProductOption[]
}

export async function listLinkableOrders(): Promise<LinkableOrder[]> {
  const db = client()
  const { data, error } = await db.from('orders').select('id, order_number, tender_id').order('created_at', { ascending: false }).limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []) as LinkableOrder[]
}

export async function listLinkableProposals(): Promise<LinkableProposal[]> {
  const db = client()
  const { data, error } = await db.from('commercial_proposals').select('id, proposal_number, tender_id').order('created_at', { ascending: false }).limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []) as LinkableProposal[]
}

export interface TenderPayload {
  p_title: string
  p_organism_company_id: string
  p_submission_deadline: string
  p_sector: string | null
  p_source: string | null
  p_opening_at: string | null
  p_observations: string | null
  p_description: string | null
  p_publication_date: string | null
  p_estimated_amount_xof: number | null
  p_our_amount_xof: number | null
  p_responsible_id: string | null
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

export async function addTenderItem(tenderId: string, item: { p_designation: string; p_quantity: number; p_unit: string | null; p_unit_price_xof: number; p_notes: string | null; p_offer_template_id: string | null }): Promise<void> {
  const { error } = await rpc('tender_item_add', { p_tender_id: tenderId, ...item })
  if (error) throw new Error(error.message)
}

export async function removeTenderItem(itemId: string): Promise<void> {
  const { error } = await rpc('tender_item_remove', { p_item_id: itemId })
  if (error) throw new Error(error.message)
}

export async function setTenderQuote(itemId: string, supplierCompanyId: string, quoteXof: number, source: string | null, notes: string | null): Promise<void> {
  const { error } = await rpc('tender_quote_set', { p_tender_item_id: itemId, p_supplier_company_id: supplierCompanyId, p_quote_xof: quoteXof, p_source: source, p_notes: notes })
  if (error) throw new Error(error.message)
}

export async function linkOrder(orderId: string, tenderId: string | null): Promise<void> {
  const { error } = await rpc('order_set_tender', { p_order_id: orderId, p_tender_id: tenderId })
  if (error) throw new Error(error.message)
}

export async function linkProposal(proposalId: string, tenderId: string | null): Promise<void> {
  const { error } = await rpc('proposal_set_tender', { p_proposal_id: proposalId, p_tender_id: tenderId })
  if (error) throw new Error(error.message)
}

/* --- Suivi : tâches, rappels, commentaires ----------------------------------- */

export async function addTenderTask(tenderId: string, title: string, dueDate: string | null, assigneeId: string | null): Promise<void> {
  const { error } = await client().from('tender_tasks').insert({ tender_id: tenderId, title: title.trim(), due_date: dueDate, assignee_id: assigneeId })
  if (error) throw new Error(error.message)
}

export async function setTenderTaskDone(taskId: string, isDone: boolean): Promise<void> {
  const { error } = await client().from('tender_tasks').update({ is_done: isDone }).eq('id', taskId)
  if (error) throw new Error(error.message)
}

export async function removeTenderTask(taskId: string): Promise<void> {
  const { error } = await client().from('tender_tasks').delete().eq('id', taskId)
  if (error) throw new Error(error.message)
}

export async function addTenderReminder(tenderId: string, remindAt: string, note: string | null): Promise<void> {
  const { error } = await client().from('tender_reminders').insert({ tender_id: tenderId, remind_at: remindAt, note: note?.trim() || null })
  if (error) throw new Error(error.message)
}

export async function setTenderReminderDone(reminderId: string, isDone: boolean): Promise<void> {
  const { error } = await client().from('tender_reminders').update({ is_done: isDone }).eq('id', reminderId)
  if (error) throw new Error(error.message)
}

export async function addTenderComment(tenderId: string, body: string): Promise<void> {
  const { error } = await client().from('tender_comments').insert({ tender_id: tenderId, body: body.trim() })
  if (error) throw new Error(error.message)
}

/* --- Documents du dossier ------------------------------------------------------ */

export async function attachTenderDocument(tenderId: string, file: File, category: TenderCategory, title: string): Promise<void> {
  const db = client()
  const uploaded = await uploadDocument(file, { title: title.trim(), companyId: null, supersedesId: null })
  const { data: link, error: linkError } = await db.from('document_links').insert({ document_id: uploaded.document_id, entity_table: 'tenders', entity_id: tenderId, link_role: 'attachment' }).select('id').single()
  if (linkError) throw new Error(linkError.message)
  void link
  const { error } = await db.from('tender_documents').insert({ tender_id: tenderId, document_id: uploaded.document_id, category, title: title.trim() })
  if (error) throw new Error(error.message)
}

export async function removeTenderDocument(rowId: string): Promise<void> {
  const { error } = await client().from('tender_documents').delete().eq('id', rowId)
  if (error) throw new Error(error.message)
}

/* --- Analyse (agrégats côté client, volumes d'années gérés par pagination) ------- */

export interface TenderAnalytics {
  total: number
  won: number
  lost: number
  deposited: number
  inCourse: number
  successRate: number | null
  wonAmount: number
  lostAmount: number
  topOrganisms: { label: string; count: number }[]
  topSuppliers: { label: string; count: number; amount: number }[]
  years: number[]
}

export async function getTenderAnalytics(year: number | null = null): Promise<TenderAnalytics> {
  const db = client()
  const tenders: { id: string; status: TenderStatus; created_at: string; our_amount_xof: string | number | null; awarded_amount_xof: string | number | null; estimated_amount_xof: string | number | null; companies: { legal_name: string; trade_name: string | null } | { legal_name: string; trade_name: string | null }[] | null }[] = []
  let from = 0
  while (true) {
    const { data, error } = await db.from('tenders')
      .select('id, status, created_at, our_amount_xof, awarded_amount_xof, estimated_amount_xof, companies!organism_company_id(legal_name, trade_name)')
      .order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    const page = data ?? []
    tenders.push(...(page as unknown as typeof tenders))
    if (page.length < 1000) break
    from += 1000
  }
  const allYears = [...new Set(tenders.map(row => new Date(row.created_at).getFullYear()))].sort((first, second) => second - first)
  const scoped = year === null ? tenders : tenders.filter(row => new Date(row.created_at).getFullYear() === year)
  const quotes: { tender_id: string; supplier_company_id: string; quote_xof: string | number; companies: { legal_name: string; trade_name: string | null } | { legal_name: string; trade_name: string | null }[] | null }[] = []
  if (scoped.length > 0) {
    const tenderIds = new Set(scoped.map(row => row.id))
    let qFrom = 0
    while (true) {
      const { data, error } = await db.from('tender_quotes')
        .select('tender_id, supplier_company_id, quote_xof, companies!supplier_company_id(legal_name, trade_name)')
        .order('id').range(qFrom, qFrom + 999)
      if (error) throw new Error(error.message)
      const page = (data ?? []) as unknown as typeof quotes
      quotes.push(...page.filter(row => tenderIds.has(row.tender_id)))
      if (page.length < 1000) break
      qFrom += 1000
    }
  }
  const won = scoped.filter(row => row.status === 'gagne')
  const lost = scoped.filter(row => row.status === 'perdu')
  const amount = (value: string | number | null): number => value === null ? 0 : Number(value)
  const organismCounts = new Map<string, { count: number; label: string }>()
  for (const row of scoped) {
    const label = (row.companies ? (Array.isArray(row.companies) ? row.companies[0] : row.companies)?.trade_name?.trim() || (Array.isArray(row.companies) ? row.companies[0] : row.companies)?.legal_name : '') || 'Organisme inconnu'
    const entry = organismCounts.get(label) ?? { count: 0, label }
    entry.count += 1
    organismCounts.set(label, entry)
  }
  const supplierCounts = new Map<string, { count: number; amount: number; label: string }>()
  for (const row of quotes) {
    const label = (row.companies ? (Array.isArray(row.companies) ? row.companies[0] : row.companies)?.trade_name?.trim() || (Array.isArray(row.companies) ? row.companies[0] : row.companies)?.legal_name : '') || 'Fournisseur inconnu'
    const entry = supplierCounts.get(label) ?? { count: 0, amount: 0, label }
    entry.count += 1
    entry.amount += Number(row.quote_xof)
    supplierCounts.set(label, entry)
  }
  return {
    total: scoped.length,
    won: won.length,
    lost: lost.length,
    deposited: scoped.filter(row => row.status === 'depose' || row.status === 'en_evaluation' || row.status === 'gagne' || row.status === 'perdu').length,
    inCourse: scoped.filter(row => !['gagne', 'perdu', 'annule'].includes(row.status)).length,
    successRate: won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    wonAmount: won.reduce((sum, row) => sum + amount(row.awarded_amount_xof ?? row.our_amount_xof), 0),
    lostAmount: lost.reduce((sum, row) => sum + amount(row.our_amount_xof ?? row.estimated_amount_xof), 0),
    topOrganisms: [...organismCounts.values()].sort((first, second) => second.count - first.count).slice(0, 5),
    topSuppliers: [...supplierCounts.values()].sort((first, second) => second.count - first.count).slice(0, 5),
    years: allYears,
  }
}

export { firstEmbed }
