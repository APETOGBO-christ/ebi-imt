// Aides communes aux fonctions Edge EBI-IMT (identité, réponses, clients).
// Ce module n'est importé que par les fonctions Edge (Deno) : il n'est pas
// couvert par tsconfig/src et ne doit jamais contenir de logique testable
// côté vitest (voir r2sigv4 / r2client).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Content-Type': 'application/json',
}

export function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

export function bearerToken(request: Request): string | null {
  return request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null
}

/** Décodage sans vérification : l'identité est validée par auth.getUser. */
export function decodeJwtPayload(token: string): { aal?: string; sub?: string } | null {
  try {
    const segment = token.split('.')[1]
    if (!segment) return null
    return JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/'))) as { aal?: string; sub?: string }
  } catch {
    return null
  }
}

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Configuration serveur incomplète (${name}).`)
  return value
}

export function makeClients(): { admin: SupabaseClient; url: string; anonKey: string } {
  const url = requiredEnv('SUPABASE_URL')
  const anonKey = requiredEnv('SUPABASE_ANON_KEY')
  const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  return { url, anonKey, admin: createClient(url, serviceKey, { auth: { persistSession: false } }) }
}

export function userClient(url: string, anonKey: string, token: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })
}

/** Identité vérifiée par GoTrue ; renvoie l'utilisateur ou une erreur prête. */
export async function requireUser(
  url: string, anonKey: string, token: string,
): Promise<{ id: string; email: string | null } | Response> {
  const client = userClient(url, anonKey, token)
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return jsonResponse(401, { error: 'Session non valide.' })
  return { id: data.user.id, email: data.user.email ?? null }
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response
}

/** Validation UUID. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

/** Configuration R2 depuis les secrets Edge. */
export function r2Config(): { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; region: string; verifyMaxBytes: number } {
  return {
    accountId: requiredEnv('R2_ACCOUNT_ID'),
    accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    bucket: requiredEnv('R2_BUCKET'),
    region: Deno.env.get('R2_REGION') ?? 'auto',
    verifyMaxBytes: Number(Deno.env.get('R2_VERIFY_MAX_BYTES') ?? '52428800'),
  }
}
