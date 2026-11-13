// Signature AWS SigV4 pour Cloudflare R2 (compatible S3).
// Module pur : aucun accès réseau, aucun global Deno — horloge injectée pour
// la testabilité. Les tests unitaires (src/lib/r2.test.ts) valident la
// signature contre les vecteurs officiels de la suite aws-sig-v4-test-suite.

const sha256Empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function subtle(): SubtleCrypto {
  const c = globalThis.crypto
  if (!c?.subtle) throw new Error('Web Crypto indisponible (navigateur, Node ≥ 20 ou Deno requis).')
  return c.subtle
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buffer: BufferSource = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  return toHex(await subtle().digest('SHA-256', buffer))
}

async function hmac(key: Uint8Array | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await subtle().importKey('raw', (key instanceof Uint8Array ? key : new Uint8Array(key)) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return subtle().sign('HMAC', cryptoKey, new TextEncoder().encode(data) as BufferSource)
}

export interface Sigv4Credentials { accessKeyId: string; secretAccessKey: string }

/** Encodage RFC 3986 : tout sauf A-Za-z0-9-._~ */
export function encodeRfc3986(value: string): string {
  return Array.from(new TextEncoder().encode(value))
    .map(byte => {
      const char = String.fromCharCode(byte)
      return /[A-Za-z0-9\-._~]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    })
    .join('')
}

/** Chemin canonique : chaque segment est encodé, les « / » sont préservés. */
export function canonicalUri(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return normalized.split('/').map(encodeRfc3986).join('/')
}

/** Chaîne de requête canonique : triée par clé puis valeur, encodée. */
export function canonicalQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value ?? '')] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

function canonicalHeaders(headers: Record<string, string>): { lines: string; signed: string } {
  const entries = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return {
    lines: entries.map(([key, value]) => `${key}:${value}\n`).join(''),
    signed: entries.map(([key]) => key).join(';'),
  }
}

export interface Sigv4RequestSpec {
  method: string
  host: string
  /** Chemin absolu brut (les segments seront encodés canoniquement). */
  path: string
  query?: Record<string, string>
  /** En-têtes à inclure dans la signature (hors host, x-amz-date, sha256). */
  headers?: Record<string, string>
  /** 'UNSIGNED-PAYLOAD' par défaut. */
  payloadHash?: string
  /** Inclure x-amz-content-sha256 (défaut : oui, exigé par S3/R2 en mode en-têtes). */
  includeSha256Header?: boolean
}

export interface Sigv4Clock { region?: string; service?: string; now?: Date }

function amzDate(now: Date): { amz: string; day: string } {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return { amz: iso, day: iso.slice(0, 8) }
}

async function signingKey(secret: string, day: string, region: string, service: string): Promise<ArrayBuffer> {
  const first = await hmac(new TextEncoder().encode(`AWS4${secret}`), day)
  const second = await hmac(first, region)
  const third = await hmac(second, service)
  return hmac(third, 'aws4_request')
}

/** Signature par en-têtes (requêtes signées : HEAD, GET, POST internes). */
export async function signHeaderAuth(
  credentials: Sigv4Credentials, spec: Sigv4RequestSpec, options: Sigv4Clock = {},
): Promise<{ headers: Record<string, string> }> {
  const region = options.region ?? 'auto'
  const service = options.service ?? 's3'
  const { amz, day } = amzDate(options.now ?? new Date())
  const payloadHash = spec.payloadHash ?? 'UNSIGNED-PAYLOAD'
  const includeSha = spec.includeSha256Header ?? true
  const headers: Record<string, string> = {
    ...(spec.headers ?? {}),
    host: spec.host,
    ...(includeSha ? { 'x-amz-content-sha256': payloadHash } : {}),
    'x-amz-date': amz,
  }
  const canonical = canonicalHeaders(headers)
  const request = [
    spec.method.toUpperCase(),
    canonicalUri(spec.path),
    canonicalQuery(spec.query ?? {}),
    canonical.lines,
    canonical.signed,
    payloadHash,
  ].join('\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amz,
    `${day}/${region}/${service}/aws4_request`,
    await sha256Hex(request),
  ].join('\n')
  const key = await signingKey(credentials.secretAccessKey, day, region, service)
  const signature = toHex(await hmac(key, stringToSign))
  return {
    headers: {
      ...(includeSha ? { 'x-amz-content-sha256': payloadHash } : {}),
      'x-amz-date': amz,
      authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${day}/${region}/${service}/aws4_request, SignedHeaders=${canonical.signed}, Signature=${signature}`,
    },
  }
}

/** URL pré-signée (auth par requête : PUT d'upload, GET de téléchargement). */
export async function presignUrl(
  credentials: Sigv4Credentials, spec: Sigv4RequestSpec, options: Sigv4Clock & { expiresIn?: number } = {},
): Promise<{ url: string; expiresAt: string }> {
  const region = options.region ?? 'auto'
  const service = options.service ?? 's3'
  const now = options.now ?? new Date()
  const expiresIn = String(options.expiresIn ?? 900)
  const { amz, day } = amzDate(now)
  const payloadHash = spec.payloadHash ?? 'UNSIGNED-PAYLOAD'
  const signedHeadersSource: Record<string, string> = { host: spec.host, ...(spec.headers ?? {}) }
  const canonical = canonicalHeaders(signedHeadersSource)
  const query: Record<string, string> = {
    ...(spec.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${credentials.accessKeyId}/${day}/${region}/${service}/aws4_request`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': expiresIn,
    'X-Amz-SignedHeaders': canonical.signed,
  }
  const request = [
    spec.method.toUpperCase(),
    canonicalUri(spec.path),
    canonicalQuery(query),
    canonical.lines,
    canonical.signed,
    payloadHash,
  ].join('\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amz,
    `${day}/${region}/${service}/aws4_request`,
    await sha256Hex(request),
  ].join('\n')
  const key = await signingKey(credentials.secretAccessKey, day, region, service)
  const signature = toHex(await hmac(key, stringToSign))
  const url = `https://${spec.host}${canonicalUri(spec.path)}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`
  return { url, expiresAt: new Date(now.getTime() + Number(expiresIn) * 1000).toISOString() }
}

export { sha256Empty }
