export type ProjectStatus = 'active' | 'paused' | 'completed' | 'cancelled' | 'in_progress'
export type ProjectSource = 'dao' | 'commande_directe' | 'operation_commerciale'
export type StepStatus = 'a_faire' | 'en_cours' | 'termine' | 'bloque'

export interface ProjectRow {
  id: string; project_number: string; title: string; client_company_id: string;
  tender_id: string | null; order_id: string | null; manager_id: string | null;
  status: ProjectStatus; start_date: string | null; planned_end_date: string | null;
  actual_end_date: string | null; budget_xof: number | null; contract_amount_xof: number | null;
  progress_pct: number; source: ProjectSource | null; notes: string | null;
  created_by: string; created_at: string; updated_at: string
}

export interface ProjectStepRow {
  id: string; project_id: string; position: number; title: string; status: StepStatus;
  due_date: string | null; completed_at: string | null; notes: string | null; created_at: string
}

export interface ProjectEvent { id: string; actor_id: string; event_type: string; details: Record<string, unknown>; created_at: string }

export const projectStatusLabels: Record<ProjectStatus, string> = {
  active: 'Actif', paused: 'En pause', in_progress: 'En cours', completed: 'Terminé', cancelled: 'Annulé',
}
export const projectSourceLabels: Record<ProjectSource, string> = {
  dao: 'Issu d’un appel d’offres', commande_directe: 'Commande directe', operation_commerciale: 'Opération commerciale',
}
export const stepStatusLabels: Record<StepStatus, string> = { a_faire: 'À faire', en_cours: 'En cours', termine: 'Terminé', bloque: 'Bloqué' }

export const dateFr = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat('fr-TG', { timeZone: 'Africa/Lome', dateStyle: 'medium' }).format(new Date(value)) : '—'

export const whenFr = (value: string) =>
  new Intl.DateTimeFormat('fr-TG', { timeZone: 'Africa/Lome', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export const xof = (amount: number | null | undefined) =>
  amount === null || amount === undefined ? '—' : `${new Intl.NumberFormat('fr-TG').format(amount)} FCFA`
