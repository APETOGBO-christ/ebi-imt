import { supabase } from '../lib/supabase'
import type { ActivityRow, CompanyInput, CompanyRow, ContactRow } from './types'

export interface CompanyFilters { search?: string; roleCode?: string; status?: 'active' | 'inactive' | '' }

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

export async function listCompanies(filters: CompanyFilters): Promise<CompanyRow[]> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  let query = supabase.from('companies')
    .select('id,legal_name,trade_name,industry,city,phone,email,is_active,created_at,company_roles(role_code)')
    .order('legal_name', { ascending: true })
    .limit(200)
  if (filters.status === 'active') query = query.eq('is_active', true)
  if (filters.status === 'inactive') query = query.eq('is_active', false)
  if (filters.roleCode) query = query.eq('company_roles.role_code', filters.roleCode)
  const search = filters.search?.replace(/[,%()]/g, ' ').trim()
  if (search) query = query.or(`legal_name.ilike.%${search}%,trade_name.ilike.%${search}%`)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as CompanyRow[]
}

export async function getCompany(id: string): Promise<CompanyRow> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { data, error } = await supabase.from('companies')
    .select('*,company_roles(role_code),contacts(*)')
    .eq('id', id)
    .order('full_name', { referencedTable: 'contacts', ascending: true })
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Société introuvable ou non accessible.')
  return data as CompanyRow
}

export async function createCompany(input: CompanyInput): Promise<string> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { data, error } = await supabase.rpc('company_create', {
    p_legal_name: input.legal_name.trim(),
    p_trade_name: clean(input.trade_name),
    p_role_codes: input.role_codes.length > 0 ? input.role_codes : null,
    p_industry: clean(input.industry),
    p_address: clean(input.address),
    p_city: clean(input.city),
    p_phone: clean(input.phone),
    p_email: clean(input.email),
    p_website: clean(input.website),
    p_registration_number: clean(input.registration_number),
    p_tax_number: clean(input.tax_number),
    p_notes: clean(input.notes),
  })
  if (error) throw new Error(error.message)
  return data as string
}

export type CompanyPatch = Partial<Pick<CompanyRow,
  'legal_name' | 'trade_name' | 'industry' | 'address' | 'city' | 'phone' | 'email' |
  'website' | 'registration_number' | 'tax_number' | 'notes' | 'is_active'>>

export async function updateCompany(id: string, patch: CompanyPatch): Promise<void> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { error } = await supabase.from('companies').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function addContact(companyId: string, input: Omit<ContactRow, 'id' | 'company_id' | 'created_at' | 'is_active'>): Promise<void> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { error } = await supabase.from('contacts').insert({
    company_id: companyId, full_name: input.full_name.trim(),
    job_title: clean(input.job_title), email: clean(input.email),
    phone: clean(input.phone), is_primary: input.is_primary, notes: clean(input.notes),
  })
  if (error) throw new Error(error.message)
}

export async function updateContact(id: string, patch: Partial<Pick<ContactRow, 'full_name' | 'job_title' | 'email' | 'phone' | 'is_primary' | 'is_active' | 'notes'>>): Promise<void> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { error } = await supabase.from('contacts').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listActivities(companyId: string): Promise<ActivityRow[]> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { data, error } = await supabase.from('company_activities')
    .select('id,company_id,contact_id,author_id,activity_type,occurred_at,subject,body')
    .eq('company_id', companyId)
    .order('occurred_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []) as ActivityRow[]
}

export async function addActivity(companyId: string, input: {
  contactId: string | null; activityType: string; subject: string; body: string
}): Promise<string> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { data, error } = await supabase.rpc('company_activity_add', {
    p_company_id: companyId,
    p_contact_id: input.contactId,
    p_activity_type: input.activityType,
    p_subject: clean(input.subject),
    p_body: clean(input.body),
  })
  if (error) throw new Error(error.message)
  return data as string
}

export interface CompanyDocumentRow {
  document_id: string
  documents: {
    id: string; document_type: string; storage_path: string
    metadata: Record<string, unknown> | null; family_key: string | null
    document_version: number | null; deleted_at: string | null
  } | null
}

export async function listCompanyDocuments(companyId: string): Promise<CompanyDocumentRow[]> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { data, error } = await supabase.from('document_links')
    .select('document_id,documents(id,document_type,storage_path,metadata,family_key,document_version,deleted_at)')
    .eq('entity_table', 'companies')
    .eq('entity_id', companyId)
    .order('document_id', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as CompanyDocumentRow[]
}
