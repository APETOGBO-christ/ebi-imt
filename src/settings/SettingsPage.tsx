import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { usePermits } from '../lib/permissions'
import type { Profile } from '../types/domain'
import { invokeAdminAction, lastLoginByActor, type UserStatus } from './api'
import { SettingsJournal } from './SettingsJournal'
import { SettingsGeneral } from './SettingsGeneral'

interface RoleOption { code: string; label: string }
interface ProfileRow extends Profile { phone: string | null; joined_at: string | null }
interface PermitRow { role: string; module: string; p_select: boolean; p_insert: boolean; p_update: boolean; p_validate: boolean; p_delete: boolean }
interface SequenceRow { kind: string; prefix: string; current_year: number; next_number: number }

const moduleLabels: Record<string, string> = {
  prospects: 'Prospects', activites: 'Activités', commerciaux: 'Commerciaux', imports: 'Imports Excel',
  offres: 'Offres', propositions: 'Propositions', commandes: 'Commandes', paiements: 'Paiements',
  depenses_terrain: 'Dépenses terrain', commissions: 'Commissions', rapports: 'Rapports',
  appels_offres: 'Appels d’offres', projets: 'Projets', clients: 'Clients', partenaires: 'Partenaires',
  fournisseurs: 'Fournisseurs', achats: 'Achats', livraisons: 'Livraisons', facturation: 'Facturation',
  bibliotheque: 'Bibliothèque', utilisateurs: 'Utilisateurs', journal: 'Journal', parametres: 'Paramètres',
}
const moduleOrder = Object.keys(moduleLabels)
const actions: { key: keyof Omit<PermitRow, 'role' | 'module'>; label: string }[] = [
  { key: 'p_select', label: 'Voir' },
  { key: 'p_insert', label: 'Créer' },
  { key: 'p_update', label: 'Modifier' },
  { key: 'p_validate', label: 'Valider' },
  { key: 'p_delete', label: 'Supprimer' },
]
const sequenceLabels: Record<string, string> = { dao: 'Appels d’offres', pro: 'Projets', cmd: 'Commandes', ach: 'Achats', liv: 'Livraisons', fac: 'Factures' }

function SettingsUsers({ roles, canEdit }: { roles: RoleOption[]; canEdit: boolean }) {
  const [rows, setRows] = useState<ProfileRow[]>([])
  const [lastLogins, setLastLogins] = useState<Record<string, string>>({})
  const [statuses, setStatuses] = useState<Record<string, UserStatus | null>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [invite, setInvite] = useState({ email: '', full_name: '', role: 'commercial' })

  const refresh = useCallback(async () => {
    if (!supabase) { setError('Connexion Supabase non configurée.'); setLoading(false); return }
    setLoading(true)
    try {
      const result = await supabase.from('profiles').select('id, full_name, role, is_active, phone, joined_at').order('full_name')
      if (result.error) throw new Error(result.error.message)
      setRows((result.data ?? []) as ProfileRow[])
      const [logins, fetched] = await Promise.all([
        lastLoginByActor().catch(() => ({} as Record<string, string>)),
        Promise.all(((result.data ?? []) as ProfileRow[]).map(async row => {
          try {
            const status = await invokeAdminAction({ action: 'status', user_id: row.id })
            return [row.id, status] as const
          } catch { return [row.id, null] as const }
        })),
      ])
      setLastLogins(logins)
      setStatuses(Object.fromEntries(fetched))
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chargement impossible.') } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  async function setActive(row: ProfileRow, value: boolean) {
    setPending(row.id); setError(null); setNotice(null)
    try {
      const { error: rpcError } = await supabase!.rpc('admin_set_profile_active', { p_profile_id: row.id, p_active: value })
      if (rpcError) throw new Error(rpcError.message)
      setNotice(`${row.full_name} : accès ${value ? 'réactivé' : 'désactivé'}.`)
      refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Action impossible.') } finally { setPending(null) }
  }

  async function setRole(row: ProfileRow, role: string) {
    setPending(row.id); setError(null); setNotice(null)
    try {
      const { error: rpcError } = await supabase!.rpc('set_profile_role', { p_profile_id: row.id, p_role: role })
      if (rpcError) throw new Error(rpcError.message)
      setNotice(`${row.full_name} : rôle « ${roles.find(candidate => candidate.code === role)?.label ?? role} » attribué.`)
      refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Action impossible.') } finally { setPending(null) }
  }

  async function revoke(row: ProfileRow) {
    setPending(row.id); setError(null); setNotice(null)
    try {
      await invokeAdminAction({ action: 'revoke_sessions', user_id: row.id })
      setNotice(`${row.full_name} : sessions révoquées et compte bloqué côté Auth.`)
      refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Action impossible.') } finally { setPending(null) }
  }

  async function resetMfa(row: ProfileRow) {
    setPending(row.id); setError(null); setNotice(null)
    try {
      const result = await invokeAdminAction({ action: 'reset_mfa', user_id: row.id })
      setNotice(`${row.full_name} : ${result ? 'facteurs MFA supprimés' : 'aucun facteur'}, l’utilisateur réinscrira son second facteur.`)
      refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Action impossible.') } finally { setPending(null) }
  }

  async function sendInvite() {
    if (!invite.email.trim() || !invite.full_name.trim()) { setError('E-mail et nom complet obligatoires.'); return }
    setPending('invite'); setError(null); setNotice(null)
    try {
      const { error: invokeError } = await supabase!.functions.invoke('invite-user', { body: { action: 'invite', email: invite.email.trim(), full_name: invite.full_name.trim(), role: invite.role } })
      if (invokeError) throw new Error(invokeError.message)
      setNotice(`Invitation envoyée à ${invite.email.trim()}. L’invité devra activer la double validation (MFA).`)
      setInvite({ email: '', full_name: '', role: 'commercial' })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Invitation impossible.') } finally { setPending(null) }
  }

  function formatLast(row: ProfileRow): string {
    const iso = lastLogins[row.id] ?? statuses[row.id]?.last_sign_in_at ?? null
    return iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
  }
  function mfaBadge(row: ProfileRow): string {
    const status = statuses[row.id]
    if (!status) return '…'
    if (status.mfa_verified > 0) return 'MFA actif'
    return status.mfa_factors > 0 ? 'MFA à confirmer' : 'Sans MFA'
  }

  return <div className="set-users">
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {notice && <div className="form-success" role="status">{notice}</div>}
    {canEdit && <form className="crm-inline-form" onSubmit={event => { event.preventDefault(); void sendInvite() }}>
      <input type="email" required placeholder="Adresse e-mail de l’invité" value={invite.email} onChange={event => setInvite(old => ({ ...old, email: event.target.value }))} />
      <input required placeholder="Nom complet" value={invite.full_name} onChange={event => setInvite(old => ({ ...old, full_name: event.target.value }))} />
      <select value={invite.role} onChange={event => setInvite(old => ({ ...old, role: event.target.value }))} aria-label="Rôle de l’invité">
        {roles.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
      </select>
      <button type="submit" className="button button-secondary" disabled={pending === 'invite'}>{pending === 'invite' ? 'Envoi…' : 'Inviter par e-mail'}</button>
    </form>}
    {loading ? <div className="crm-empty">Chargement des utilisateurs.</div> : <div className="crm-table-wrap">
      <table className="crm-table">
        <thead><tr><th>Utilisateur</th><th>Téléphone</th><th>Rôle</th><th>Accès</th><th>MFA</th><th>Dernière activité</th>{canEdit && <th />}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td><strong>{row.full_name}</strong></td>
          <td>{row.phone ?? '—'}</td>
          <td>{canEdit ? <select aria-label={`Rôle de ${row.full_name}`} value={row.role} disabled={pending === row.id} onChange={event => void setRole(row, event.target.value)}>
            {roles.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
          </select> : moduleLabels[row.role] ?? row.role}</td>
          <td><span className={`crm-status ${row.is_active ? 'crm-status-won' : 'crm-status-cancelled'}`}>{row.is_active ? 'Actif' : 'Désactivé'}</span></td>
          <td><span className={`crm-status ${statuses[row.id]?.mfa_verified ? 'crm-status-won' : 'crm-status-cancelled'}`}>{mfaBadge(row)}</span></td>
          <td>{formatLast(row)}</td>
          {canEdit && <td className="crm-row-actions">
            <button type="button" disabled={pending === row.id} onClick={() => void setActive(row, !row.is_active)}>{row.is_active ? 'Désactiver' : 'Réactiver'}</button>
            {row.is_active && <button type="button" disabled={pending === row.id} onClick={() => void revoke(row)}>Révoquer</button>}
            <button type="button" disabled={pending === row.id} onClick={() => void resetMfa(row)}>Réinitialiser MFA</button>
          </td>}
        </tr>)}
        </tbody>
      </table>
      <p className="crm-hint">Réinitialisation d’un accès : l’utilisateur utilise « Mot de passe oublié ? » sur la page de connexion (e-mail de récupération). Les secrets d’authentification ne sont jamais affichés ici.</p>
      {rows.length === 0 && <div className="crm-empty">Aucun utilisateur référencé.</div>}
    </div>}
  </div>
}

function SettingsPermissions({ roles, editable }: { roles: RoleOption[]; editable: boolean }) {
  const [role, setRole] = useState('')
  const [rows, setRows] = useState<PermitRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (!role && roles.length > 0) setRole(roles[0].code) }, [roles, role])

  useEffect(() => {
    if (!role || !supabase) return
    let active = true
    setLoading(true)
    ;(async () => {
      try {
        const result = await supabase.from('role_permissions').select('role, module, p_select, p_insert, p_update, p_validate, p_delete').eq('role', role)
        if (result.error) throw new Error(result.error.message)
        if (!active) return
        setRows((result.data ?? []) as PermitRow[])
        setError(null)
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : 'Chargement impossible.') } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [role])

  async function toggle(module: string, action: keyof Omit<PermitRow, 'role' | 'module'>, value: boolean) {
    if (!supabase) return
    setError(null)
    const { error: upsertError } = await supabase.from('role_permissions').upsert({ role, module, [action]: value, p_select: false, p_insert: false, p_update: false, p_validate: false, p_delete: false })
    if (upsertError) { setError(upsertError.message); return }
    setRows(old => {
      const existing = old.find(row => row.module === module)
      if (existing) return old.map(row => row.module === module ? { ...row, [action]: value } : row)
      return [...old, { role, module, p_select: false, p_insert: false, p_update: false, p_validate: false, p_delete: false, [action]: value }]
    })
  }

  return <div className="set-permissions">
    <div className="crm-toolbar">
      <select aria-label="Choisir un rôle" value={role} onChange={event => setRole(event.target.value)}>
        {roles.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
      </select>
      <span className="crm-count">Matrice des droits du rôle sélectionné</span>
    </div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {loading ? <div className="crm-empty">Chargement de la matrice.</div> : <div className="crm-table-wrap set-matrix">
      <table className="crm-table">
        <thead><tr><th>Module</th>{actions.map(action => <th key={action.key}>{action.label}</th>)}</tr></thead>
        <tbody>{moduleOrder.map(module => {
          const row = rows.find(candidate => candidate.module === module)
          return <tr key={module}><td><strong>{moduleLabels[module]}</strong></td>{actions.map(action => <td key={action.key}>
            <input type="checkbox" disabled={!editable} aria-label={`${moduleLabels[module]} : ${action.label}`} checked={Boolean(row?.[action.key])} onChange={event => void toggle(module, action.key, event.target.checked)} />
          </td>)}</tr>
        })}
        </tbody>
      </table>
    </div>}
  </div>
}

function SettingsSequences() {
  const [rows, setRows] = useState<SequenceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!supabase) { setError('Connexion Supabase non configurée.'); setLoading(false); return }
    let active = true
    ;(async () => {
      try {
        const result = await supabase.from('official_sequences').select('kind, prefix, current_year, next_number').order('kind')
        if (result.error) throw new Error(result.error.message)
        if (!active) return
        setRows((result.data ?? []) as SequenceRow[])
        setError(null)
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : 'Chargement impossible.') } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [])
  return <div className="set-sequences">
    {error && <div className="crm-alert" role="alert">{error}</div>}
    <p className="crm-page-head" style={{ margin: 0 }}>Les numéros officiels sont émis automatiquement par le système à chaque création de document ; ces compteurs ne sont modifiables qu’en base.</p>
    {loading ? <div className="crm-empty">Chargement de la numérotation.</div> : <div className="crm-table-wrap">
      <table className="crm-table">
        <thead><tr><th>Type de document</th><th>Préfixe</th><th>Année</th><th>Prochain numéro</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.kind}>
          <td><strong>{sequenceLabels[row.kind] ?? row.kind}</strong></td><td>{row.prefix}</td><td>{row.current_year}</td><td>{row.next_number}</td>
        </tr>)}
        </tbody>
      </table>
      {rows.length === 0 && <div className="crm-empty">Aucune séquence de numérotation.</div>}
    </div>}
  </div>
}

export function SettingsPage() {
  const { can, loading: permitsLoading } = usePermits()
  const [tab, setTab] = useState<'users' | 'permissions' | 'journal' | 'general' | 'sequences'>('users')
  const [roles, setRoles] = useState<RoleOption[]>([])
  const [rolesError, setRolesError] = useState<string | null>(null)
  useEffect(() => {
    if (!supabase) return
    ;(async () => {
      try {
        const result = await supabase.from('roles').select('code, label, is_deprecated').eq('is_deprecated', false).order('label')
        if (result.error) throw new Error(result.error.message)
        setRoles((result.data ?? []) as RoleOption[])
      } catch (reason) { setRolesError(reason instanceof Error ? reason.message : 'Chargement des rôles impossible.') }
    })()
  }, [])

  if (!permitsLoading && !can('parametres', 'select')) return <div className="crm-page"><div className="crm-alert" role="alert">Votre rôle ne permet pas d’accéder aux paramètres.</div></div>
  if (rolesError) return <div className="crm-page"><div className="crm-alert" role="alert">{rolesError}</div></div>
  const canEditUsers = !permitsLoading && (can('parametres', 'update') || can('utilisateurs', 'update'))
  const canEditMatrix = !permitsLoading && can('parametres', 'update')
  return <div className="crm-page">
    <div className="crm-page-head"><div><span className="section-kicker">PARAMÈTRES</span><h1>Paramètres</h1><p>Utilisateurs et accès, matrice des permissions, numérotation officielle.</p></div></div>
    <div className="set-tabs" role="tablist">
      <button type="button" className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Utilisateurs</button>
      <button type="button" className={tab === 'permissions' ? 'active' : ''} onClick={() => setTab('permissions')}>Permissions</button>
      <button type="button" className={tab === 'journal' ? 'active' : ''} onClick={() => setTab('journal')}>Journal</button>
      <button type="button" className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>Général</button>
      <button type="button" className={tab === 'sequences' ? 'active' : ''} onClick={() => setTab('sequences')}>Numérotation</button>
    </div>
    {tab === 'users' && <SettingsUsers roles={roles} canEdit={canEditUsers} />}
    {tab === 'permissions' && <SettingsPermissions roles={roles} editable={canEditMatrix} />}
    {tab === 'journal' && <SettingsJournal />}
    {tab === 'general' && <SettingsGeneral editable={canEditMatrix} />}
    {tab === 'sequences' && <SettingsSequences />}
  </div>
}
