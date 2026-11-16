export interface DocumentRow {
  id: string; document_type: string; storage_path: string; content_hash: string | null
  metadata: Record<string, unknown> | null; family_key: string | null
  document_version: number | null; supersedes_id: string | null
  issued_at: string | null; created_at: string
  deleted_at: string | null; deleted_by: string | null; deleted_reason: string | null
  created_by: string | null
  document_links?: { entity_table: string; entity_id: string }[] | null
}
export interface CompanyOption { id: string; legal_name: string; trade_name: string | null }
export interface InitUploadResult { upload_id: string; storage_path: string; upload_url: string; expires_at: string }
export interface ConfirmUploadResult { document_id: string; family_key: string; document_version: number; verify_mode: string }
export interface ReconcileResult {
  objects_scanned: number; truncated: boolean
  missing: number; orphans: number; size_mismatches: number; stale_staged: number
}
export const imageMimeTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export type MimeCategory = 'pdf' | 'image' | 'word' | 'excel' | 'autre'
export const mimeCategoryLabels: Record<MimeCategory, string> = {
  pdf: 'PDF', image: 'Images', word: 'Documents texte', excel: 'Tableurs', autre: 'Autres formats',
}
export function mimeCategory(mime: unknown): MimeCategory {
  if (typeof mime !== 'string') return 'autre'
  if (mime === 'application/pdf') return 'pdf'
  if (imageMimeTypes.includes(mime)) return 'image'
  if (mime.startsWith('application/vnd.openxmlformats-officedocument.wordprocessingml') || mime === 'application/msword' || mime === 'text/plain') return 'word'
  if (mime.startsWith('application/vnd.openxmlformats-officedocument.spreadsheetml') || mime === 'application/vnd.ms-excel' || mime === 'text/csv') return 'excel'
  return 'autre'
}
export function inPeriod(createdAt: string, period: string): boolean {
  const age = Date.now() - new Date(createdAt).getTime()
  if (Number.isNaN(age)) return period === ''
  if (period === '7j') return age <= 7 * 86_400_000
  if (period === '30j') return age <= 30 * 86_400_000
  if (period === '12m') return age <= 365 * 86_400_000
  return true
}
export function displayTitle(document: Pick<DocumentRow, 'metadata' | 'storage_path'>): string {
  const title = document.metadata?.title
  if (typeof title === 'string' && title.trim() !== '') return title
  return document.storage_path.split('/').pop() ?? document.storage_path
}
export function formatBytes(size: number): string {
  if (size >= 1_048_576) return `${(size / 1_048_576).toFixed(1)} Mo`
  if (size >= 1024) return `${Math.round(size / 1024)} Ko`
  return `${size} o`
}
