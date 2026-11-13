// Restauration depuis la corbeille logique : contrôle de permission dans
// document_request_restore (contexte utilisateur).
import { corsHeaders, jsonResponse, bearerToken, requireUser, userClient, isUuid } from '../_shared/edge.ts'

interface Payload { document_id?: string }

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Méthode non autorisée.' })
  const token = bearerToken(request)
  if (!token) return jsonResponse(401, { error: 'Session requise.' })
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!url || !anonKey) return jsonResponse(503, { error: 'Configuration serveur incomplète.' })
    const identity = await requireUser(url, anonKey, token)
    if (identity instanceof Response) return identity

    const body = await request.json() as Payload
    if (!isUuid(body.document_id)) return jsonResponse(400, { error: 'Identifiant de document requis.' })

    const { error } = await userClient(url, anonKey, token)
      .rpc('document_request_restore', { p_document_id: body.document_id! })
    if (error) return jsonResponse(403, { error: error.message })
    return jsonResponse(200, { restored: true })
  } catch (error) {
    return jsonResponse(409, { error: error instanceof Error ? error.message : 'Restauration impossible.' })
  }
})
