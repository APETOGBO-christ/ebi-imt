import { supabase } from '../lib/supabase'

export interface AppSettings {
  legal_name: string; trade_name: string | null; address: string | null; city: string | null
  country_code: string; phone: string | null; email: string | null; website: string | null
  logo_url: string | null; display_prefs: Record<string, unknown> | null
  currency: string; retention: Record<string, unknown> | null
  finance: Record<string, unknown> | null; enabled_modules: string[] | null
  updated_by: string | null; updated_at: string
}
export interface LibraryCategory { id: string; code: string; label: string; created_at: string }
export interface AuditRow {
  id: string; actor_id: string | null; action: string; entity_table: string | null
  entity_id: string | null; changes: Record<string, unknown> | null
  context: Record<string, unknown> | null; created_at: string
}

export function emptySettings(): AppSettings {
  return {
    legal_name: 'EBI-IMT', trade_name: null, address: null, city: null, country_code: 'TG',
    phone: null, email: null, website: null, logo_url: null, display_prefs: { scene3d: true },
    currency: 'XOF', retention: { library_years: 5, audit_years: 10 },
    finance: { default_vat_pct: 18, late_fee_pct: 1 }, enabled_modules: [],
    updated_by: null, updated_at: '',
  }
}

export async function fetchAppSettings(): Promise<AppSettings> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { data, error } = await supabase.from('app_settings').select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as AppSettings | null) ?? emptySettings()
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { error } = await supabase.from('app_settings').update(patch).eq('id', 1)
  if (error) throw new Error(error.message)
}

export async function listCategories(): Promise<LibraryCategory[]> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { data, error } = await supabase.from('library_categories').select('id, code, label, created_at').order('label')
  if (error) throw new Error(error.message)
  return (data ?? []) as LibraryCategory[]
}

export async function createCategory(code: string, label: string): Promise<void> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { error } = await supabase.from('library_categories').insert({ code: code.trim(), label: label.trim() })
  if (error) throw new Error(error.message)
}

export async function deleteCategory(id: string): Promise<void> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { error } = await supabase.from('library_categories').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listAudit(action: string, entity: string, search: string): Promise<AuditRow[]> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  let query = supabase.from('audit_logs')
    .select('id, actor_id, action, entity_table, entity_id, changes, context, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (action) query = query.eq('action', action)
  if (entity) query = query.eq('entity_table', entity)
  if (search) query = query.ilike('action', `%${search.replace(/[,%()]/g, ' ')}%`)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as AuditRow[]
}

export async function lastLoginByActor(): Promise<Record<string, string>> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { data, error } = await supabase.from('audit_logs')
    .select('actor_id, created_at')
    .eq('action', 'auth_login')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)
  const result: Record<string, string> = {}
  for (const row of (data ?? []) as { actor_id: string | null; created_at: string }[]) {
    if (row.actor_id && !result[row.actor_id]) result[row.actor_id] = row.created_at
  }
  return result
}

export interface UserStatus {
  mfa_factors: number; mfa_verified: number
  banned_until: string | null; last_sign_in_at: string | null; email_confirmed: boolean
}

export async function invokeAdminAction(payload: { action: string; user_id: string; email?: string }): Promise<UserStatus | null> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { data, error } = await supabase.functions.invoke('invite-user', { body: payload })
  if (error) {
    const cause = (error as { context?: Response }).context
    if (cause) {
      try {
        const body = await cause.json() as { error?: string }
        if (body?.error) throw new Error(body.error)
      } catch (jsonError) {
        if (jsonError instanceof Error && jsonError.message !== 'Unexpected end of JSON input') throw jsonError
      }
    }
    throw new Error(error.message || 'Action impossible.')
  }
  return (data as UserStatus | null) ?? null
}
