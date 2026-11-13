export interface CompanyRoleRow { role_code: string }
export interface ContactRow {
  id: string; company_id: string; full_name: string; job_title: string | null
  email: string | null; phone: string | null; is_primary: boolean
  is_active: boolean; notes: string | null; created_at: string
}
export interface CompanyRow {
  id: string; legal_name: string; trade_name: string | null; industry: string | null
  address: string | null; city: string | null; phone: string | null; email: string | null
  website: string | null; registration_number: string | null; tax_number: string | null
  notes: string | null; is_active: boolean; created_by: string | null; created_at: string
  company_roles?: CompanyRoleRow[] | null
  contacts?: ContactRow[] | null
}
export interface ActivityRow {
  id: string; company_id: string; contact_id: string | null; author_id: string
  activity_type: string; occurred_at: string; subject: string | null; body: string | null
}
export interface CompanyInput {
  legal_name: string; trade_name: string; role_codes: string[]
  industry: string; address: string; city: string
  phone: string; email: string; website: string
  registration_number: string; tax_number: string; notes: string
}
export const emptyCompany: CompanyInput = {
  legal_name: '', trade_name: '', role_codes: [], industry: '', address: '', city: '',
  phone: '', email: '', website: '', registration_number: '', tax_number: '', notes: '',
}
export const roleCodeLabels: Record<string, string> = {
  client: 'Client', fournisseur: 'Fournisseur', partenaire: 'Partenaire', agence: 'Agence',
}
export const activityTypeLabels: Record<string, string> = {
  call: 'Appel', meeting: 'Réunion', email: 'E-mail', visit: 'Visite', note: 'Note', other: 'Autre',
}
export function displayCompany(company: Pick<CompanyRow, 'trade_name' | 'legal_name'>): string {
  return company.trade_name?.trim() || company.legal_name
}
