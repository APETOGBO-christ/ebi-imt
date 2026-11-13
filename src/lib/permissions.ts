import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

// Lecture de la matrice de permissions du rôle de l'utilisateur connecté.
// La base (permits) reste l'autorité : ce hook sert uniquement à afficher ou
// masquer les actions côté interface. En cas d'échec, tout est refusé.
export type PermitAction = 'select' | 'insert' | 'update' | 'validate' | 'delete'
export interface PermitRow { module: string; p_select: boolean; p_insert: boolean; p_update: boolean; p_validate: boolean; p_delete: boolean }
export interface Permits { loading: boolean; can: (module: string, action: PermitAction) => boolean }

export function usePermits(): Permits {
  const { profile } = useAuth()
  const [rows, setRows] = useState<PermitRow[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    if (!supabase || !profile?.role) { if (active) { setRows([]); setLoading(false) } return }
    setLoading(true)
    void (async () => {
      try {
        const { data } = await supabase.from('role_permissions')
          .select('module,p_select,p_insert,p_update,p_validate,p_delete')
          .eq('role', profile.role)
        if (!active) return
        setRows((data ?? []) as PermitRow[])
      } catch {
        if (active) setRows([])
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [profile?.role])
  return {
    loading,
    can: (module, action) => {
      const row = rows.find(item => item.module === module)
      if (!row) return false
      if (action === 'select') return row.p_select
      if (action === 'insert') return row.p_insert
      if (action === 'update') return row.p_update
      if (action === 'validate') return row.p_validate
      return row.p_delete
    },
  }
}
