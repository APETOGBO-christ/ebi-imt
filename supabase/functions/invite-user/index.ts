import { createClient } from 'npm:@supabase/supabase-js@2.117.3'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Content-Type': 'application/json' }
const response = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVITABLE_ROLES = ['admin', 'direction', 'commercial', 'achats', 'finance', 'lecture_seule']
const ACTIONS = ['invite', 'activate', 'deactivate', 'revoke_sessions', 'reactivate', 'recover', 'reset_mfa'] as const
type Action = typeof ACTIONS[number]

interface Payload {
  action?: string
  email?: string
  user_id?: string
  role?: string
  full_name?: string
  redirect_to?: string
}

// Décodage sans vérification cryptographique : l'identité est validée par
// auth.getUser (signature vérifiée côté GoTrue) ; ce décodage ne sert qu'à
// lire le claim `aal` pour le contrôle rapide MFA.
function decodeJwtPayload(token: string): { aal?: string; sub?: string } | null {
  try {
    const segment = token.split('.')[1]
    if (!segment) return null
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(normalized)) as { aal?: string; sub?: string }
  } catch {
    return null
  }
}

function auditAdmin(admin: ReturnType<typeof createClient>, action: string, userId: string | null, changes: Record<string, unknown>) {
  void admin.from('audit_logs').insert({
    actor_id: null, action, entity_table: 'profiles', entity_id: userId, changes,
  })
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return response(405, { error: 'Méthode non autorisée.' })
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return response(401, { error: 'Session requise.' })
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !secret) return response(503, { error: 'Configuration serveur incomplète.' })

  let admin: ReturnType<typeof createClient> | undefined
  let action: string | undefined
  try {
    const body = await request.json() as Payload
    action = body.action
    if (!action || !(ACTIONS as readonly string[]).includes(action)) return response(400, { error: 'Action inconnue.' })
    if (body.user_id && !UUID_RE.test(body.user_id)) return response(400, { error: 'Identifiant utilisateur invalide.' })
    if (body.email && !EMAIL_RE.test(body.email.trim())) return response(400, { error: 'Adresse e-mail invalide.' })
    if (body.redirect_to && !/^https:\/\/[^\s]+$/.test(body.redirect_to)) return response(400, { error: 'URL de redirection invalide.' })

    // Identité vérifiée par GoTrue, puis MFA aal2 et rôle admin vérifiés
    // côté serveur (double contrôle : claim JWT + porte SQL admin_caller_gate).
    const payload = decodeJwtPayload(token)
    if (!payload || payload.aal !== 'aal2') return response(403, { error: 'Second facteur (MFA) requis pour cette opération.' })
    const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } })
    const { data: identity, error: identityError } = await userClient.auth.getUser(token)
    if (identityError || !identity.user) return response(401, { error: 'Session non valide.' })
    const { data: gate, error: gateError } = await userClient.rpc('admin_caller_gate')
    if (gateError || gate !== true) return response(403, { error: 'Administrateur habilité avec second facteur requis.' })

    admin = createClient(url, secret, { auth: { persistSession: false } })

    if (action === 'invite') {
      const email = body.email?.trim().toLowerCase()
      if (!email) return response(400, { error: 'Adresse e-mail requise.' })
      if (!body.role || !(INVITABLE_ROLES as string[]).includes(body.role)) {
        return response(400, { error: 'Rôle invalide pour une invitation.' })
      }
      const fullName = body.full_name?.trim() ?? null
      if (fullName !== null && fullName.length < 2) return response(400, { error: 'Nom complet invalide.' })
      const redirectTo = body.redirect_to ?? Deno.env.get('INVITE_REDIRECT_URL') ?? undefined
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName }, ...(redirectTo ? { redirectTo } : {}),
      })
      if (inviteError || !invited.user) return response(409, { error: inviteError?.message ?? 'Invitation impossible.' })
      // Le trigger de la migration 15 a déjà créé un profil inactif
      // sales_rep ; le bootstrap lui attribue le rôle choisi.
      const { error: bootstrapError } = await admin.rpc('admin_bootstrap_profile', {
        p_user_id: invited.user.id, p_role: body.role, p_full_name: fullName,
      })
      if (bootstrapError) return response(409, { error: bootstrapError.message ?? 'Attribution du rôle impossible.' })
      auditAdmin(admin, 'admin_user_invited', invited.user.id, { email, role: body.role })
      return response(200, { user_id: invited.user.id, invited: true })
    }

    const userId = body.user_id
    if (!userId) return response(400, { error: 'Identifiant utilisateur requis.' })

    if (action === 'activate') {
      const { error: unbanError } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
      if (unbanError) return response(409, { error: unbanError.message ?? 'Lever de blocage impossible.' })
      const { error } = await admin.rpc('admin_set_profile_active', { p_user_id: userId, p_active: true })
      if (error) return response(409, { error: error.message ?? 'Activation impossible.' })
      auditAdmin(admin, 'admin_user_activated', userId, {})
      return response(200, { activated: true })
    }

    if (action === 'deactivate') {
      const { error } = await admin.rpc('admin_set_profile_active', { p_user_id: userId, p_active: false })
      if (error) return response(409, { error: error.message ?? 'Désactivation impossible.' })
      auditAdmin(admin, 'admin_user_deactivated', userId, {})
      return response(200, { deactivated: true })
    }

    if (action === 'revoke_sessions') {
      // Blocage Auth : les nouvelles connexions et rafraîchissements sont
      // refusés. Les jetons d'accès déjà émis restent techniquement valides
      // jusqu'à expiration (1 h), mais la porte restrictive active_profile_gate
      // (profil désactivé) leur retire tout accès aux données.
      const { error: deactivateError } = await admin.rpc('admin_set_profile_active', { p_user_id: userId, p_active: false })
      if (deactivateError) return response(409, { error: deactivateError.message ?? 'Désactivation impossible.' })
      const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
      if (banError) return response(409, { error: banError.message ?? 'Révocation des sessions impossible.' })
      auditAdmin(admin, 'admin_user_sessions_revoked', userId, {})
      return response(200, { revoked: true })
    }

    if (action === 'recover') {
      const email = body.email?.trim().toLowerCase()
      if (!email) return response(400, { error: 'Adresse e-mail requise.' })
      const redirectTo = body.redirect_to ?? Deno.env.get('INVITE_REDIRECT_URL') ?? undefined
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: 'recovery', email, ...(redirectTo ? { options: { redirectTo } } : {}),
      })
      if (linkError || !link.properties?.action_link) {
        return response(409, { error: linkError?.message ?? 'Lien de récupération impossible.' })
      }
      auditAdmin(admin, 'admin_user_recovery_link', userId ?? null, { email })
      return response(200, { action_link: link.properties.action_link })
    }

    if (action === 'reset_mfa') {
      const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors(userId)
      if (listError) return response(409, { error: listError.message ?? 'Consultation des facteurs impossible.' })
      let removed = 0
      for (const factor of factors.factors ?? []) {
        const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ factorId: factor.id, userId })
        if (deleteError) return response(409, { error: deleteError.message ?? 'Suppression du facteur impossible.' })
        removed += 1
      }
      auditAdmin(admin, 'admin_user_mfa_reset', userId, { removed })
      return response(200, { removed })
    }

    return response(400, { error: 'Action inconnue.' })
  } catch (error) {
    return response(409, { error: error instanceof Error ? error.message : 'Opération impossible.' })
  }
})
