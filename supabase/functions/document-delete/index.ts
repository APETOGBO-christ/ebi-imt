// Suppression logique (corbeille) : la décision et le contrôle de permission
// vivent dans document_request_delete (contexte utilisateur) ; la fonction
// relaie simplement la requête authentifiée.
import { corsHeaders, jsonResponse, bearerToken, requireUser, userClient, isUuid } from '../_shared/edge.ts'

interface Payload { document_id?: string; reason?: string }

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Méthode non autorisée.' })
  const token = bearerToken(request)
  if (!token) return jsonResponse(401, { error: 'Session requise.' })
  try {
    const { url, anonKey } = makeClientsFor()
    const identity = await requireUser(url, anonKey, token)
    if (identity instanceof Response) return identity

    const body = await request.json() as Payload
    if (!isUuid(body.document_id)) return jsonResponse(400, { error: 'Identifiant de document requis.' })
    const reason = body.reason?.trim()
    if (!reason || reason.length > 500) return jsonResponse(400, { error: 'Motif de suppression requis (500 caractères maximum).' })

    const { error } = await userClient(url, anonKey, token)
      .rpc('document_request_delete', { p_document_id: body.document_id!, p_reason: reason })
    if (error) return jsonResponse(403, { error: error.message })
    return jsonResponse(200, { deleted: true })
  } catch (error) {
    return jsonResponse(409, { error: error instanceof Error ? error.message : 'Suppression impossible.' })
  }
})

function makeClientsFor(): { url: string; anonKey: string } {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) throw new Error('Configuration serveur incomplète.')
  return { url, anonKey }
}
