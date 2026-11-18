import { supabase } from '../lib/supabase'
import { crmChanged } from '../crm/api'
import type { ProjectEvent, ProjectRow, ProjectStepRow, StepStatus } from './types'

function db() { if (!supabase) throw new Error('Connexion Supabase non configurée.'); return supabase }
function fail(error: { message: string } | null) { if (error) throw new Error(error.message) }

export interface ProjectFilters { search?: string; status?: string; source?: string; managerId?: string }

export async function listProjects(filters: ProjectFilters = {}): Promise<ProjectRow[]> {
  let query = db().from('projects').select('*, companies(id,trade_name,legal_name)').order('created_at', { ascending: false }).limit(300)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.source) query = query.eq('source', filters.source)
  if (filters.managerId) query = query.eq('manager_id', filters.managerId)
  if (filters.search) query = query.or(`title.ilike.%${filters.search}%,project_number.ilike.%${filters.search}%`)
  const { data, error } = await query
  fail(error); return data as ProjectRow[]
}

export async function getProject(id: string): Promise<ProjectRow> {
  const { data, error } = await db().from('projects').select('*').eq('id', id).single()
  fail(error); if (!data) throw new Error('Projet introuvable.'); return data as ProjectRow
}

export async function getProjectSteps(projectId: string): Promise<ProjectStepRow[]> {
  const { data, error } = await db().from('project_steps').select('*').eq('project_id', projectId).order('position')
  fail(error); return data as ProjectStepRow[]
}

export async function getProjectEvents(projectId: string): Promise<ProjectEvent[]> {
  const { data, error } = await db().from('crm_audit_projects').select('id,actor_id,event_type,details,created_at').eq('entity_id', projectId).order('created_at', { ascending: false }).limit(50)
  fail(error); return data as ProjectEvent[]
}

export interface ProjectInput {
  title: string; client_company_id: string; manager_id: string | null;
  start_date: string | null; planned_end_date: string | null;
  budget_xof: number | null; contract_amount_xof: number | null; notes: string | null
}

export async function createProjectDirect(
  input: ProjectInput, source: 'commande_directe' | 'operation_commerciale'
): Promise<string> {
  const { data, error } = await db().rpc('project_create_direct', {
    p_title: input.title, p_client_company_id: input.client_company_id, p_source: source,
    p_contract_amount_xof: input.contract_amount_xof, p_budget_xof: input.budget_xof,
    p_manager_id: input.manager_id, p_start_date: input.start_date,
    p_planned_end_date: input.planned_end_date, p_notes: input.notes,
  })
  fail(error); crmChanged(); return data as string
}

export async function updateProject(id: string, input: ProjectInput): Promise<void> {
  const { error } = await db().rpc('project_update', {
    p_id: id, p_title: input.title, p_client_company_id: input.client_company_id,
    p_manager_id: input.manager_id, p_start_date: input.start_date,
    p_planned_end_date: input.planned_end_date, p_budget_xof: input.budget_xof,
    p_contract_amount_xof: input.contract_amount_xof, p_notes: input.notes,
  })
  fail(error); crmChanged()
}

export async function addStep(projectId: string, title: string, dueDate: string | null, notes: string | null): Promise<void> {
  const { error } = await db().rpc('project_step_add', { p_project_id: projectId, p_title: title, p_due_date: dueDate, p_notes: notes })
  fail(error); crmChanged()
}

export async function removeStep(stepId: string): Promise<void> {
  const { error } = await db().rpc('project_step_remove', { p_step_id: stepId })
  fail(error); crmChanged()
}

export async function setStepStatus(stepId: string, status: StepStatus, notes: string | null = null): Promise<void> {
  const { error } = await db().rpc('project_step_set_status', { p_step_id: stepId, p_status: status, p_notes: notes })
  fail(error); crmChanged()
}

export async function setProgress(projectId: string, pct: number): Promise<void> {
  const { error } = await db().rpc('project_set_progress', { p_id: projectId, p_pct: pct })
  fail(error); crmChanged()
}

export async function listPersonOptions(): Promise<{ id: string; full_name: string }[]> {
  const { data, error } = await db().from('profiles').select('id, full_name').eq('is_active', true).order('full_name').limit(200)
  fail(error); return data ?? []
}

export async function listClientCompanies(): Promise<{ id: string; label: string }[]> {
  const { data, error } = await db().from('companies').select('id,trade_name,legal_name').eq('is_active', true).order('trade_name').limit(300)
  fail(error); return (data ?? []).map(row => ({ id: row.id, label: row.trade_name?.trim() || row.legal_name }))
}
