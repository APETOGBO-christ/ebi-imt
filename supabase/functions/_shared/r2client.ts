// Opérations Cloudflare R2 (compatible S3) au-dessus de r2sigv4.
// Module sans global Deno : la configuration est passée en paramètre,
// les variables d'environnement restent lues dans les fonctions Edge.
import { presignUrl, sha256Hex, sha256Empty, signHeaderAuth, type Sigv4Credentials } from './r2sigv4.ts'

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  region?: string
}

export interface R2ObjectInfo { exists: boolean; size: number | null; etag: string | null }

function credentials(config: R2Config): Sigv4Credentials {
  return { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
}

export function r2Host(config: R2Config): string {
  return `${config.accountId}.r2.cloudflarestorage.com`
}

export function objectPath(bucket: string, key: string): string {
  return `/${bucket}/${key}`
}

/**
 * Clé de stockage lisible : minuscules sans accents, tirets, extension
 * conservée. Le répertoire parent porte déjà l'identifiant de dépôt.
 */
export function slugifyStorageKey(fileName: string): string {
  const base = fileName.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^.]*$/, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'document'
  const extension = fileName.match(/\.([A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase()
  return extension ? `${base}.${extension}` : base
}

/** Chemin versionné du dépôt : library/AAAA/MM/<dépôt>/<fichier>. */
export function libraryPath(uploadId: string, fileName: string, now = new Date()): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `library/${year}/${month}/${uploadId}/${slugifyStorageKey(fileName)}`
}

/** URL pré-signée PUT : Content-Type signé, le client doit envoyer le même en-tête. */
export async function presignPut(
  config: R2Config, key: string, contentType: string, expiresIn = 900,
): Promise<{ url: string; expiresAt: string }> {
  return presignUrl(credentials(config), {
    method: 'PUT', host: r2Host(config), path: objectPath(config.bucket, key),
    headers: { 'content-type': contentType },
  }, { region: config.region, expiresIn })
}

/** URL pré-signée GET (téléchargement / prévisualisation). */
export async function presignGet(
  config: R2Config, key: string, expiresIn = 600, responseContentType?: string,
): Promise<{ url: string; expiresAt: string }> {
  return presignUrl(credentials(config), {
    method: 'GET', host: r2Host(config), path: objectPath(config.bucket, key),
    query: responseContentType ? { 'response-content-type': responseContentType } : undefined,
  }, { region: config.region, expiresIn })
}

/** Interrogation de l'objet (taille, etag) par requête signée en en-têtes. */
export async function headObject(config: R2Config, key: string): Promise<R2ObjectInfo> {
  const { headers } = await signHeaderAuth(credentials(config), {
    method: 'HEAD', host: r2Host(config), path: objectPath(config.bucket, key),
  }, { region: config.region })
  const response = await fetch(`https://${r2Host(config)}${objectPath(config.bucket, key)}`, { method: 'HEAD', headers })
  if (response.status === 404) return { exists: false, size: null, etag: null }
  if (!response.ok) throw new Error(`R2 indisponible (${response.status}).`)
  return {
    exists: true,
    size: Number(response.headers.get('content-length') ?? '0'),
    etag: response.headers.get('etag'),
  }
}

/** Suppression physique (purge R2 après conservation, outils admin). */
export async function deleteObject(config: R2Config, key: string): Promise<boolean> {
  const { headers } = await signHeaderAuth(credentials(config), {
    method: 'DELETE', host: r2Host(config), path: objectPath(config.bucket, key),
  }, { region: config.region })
  const response = await fetch(`https://${r2Host(config)}${objectPath(config.bucket, key)}`, { method: 'DELETE', headers })
  return response.status === 204 || response.status === 404
}

export interface R2ListResult { keys: string[]; truncated: boolean }

function xmlText(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return match ? match[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&') : null
}

/** Inventaire paginé des objets (réconciliation). */
export async function listObjects(config: R2Config, prefix = '', maxPages = 20): Promise<R2ListResult> {
  const keys: string[] = []
  let truncated = false
  let token: string | undefined
  for (let page = 0; page < maxPages; page += 1) {
    const query: Record<string, string> = { 'list-type': '2' }
    if (prefix) query.prefix = prefix
    if (token) query['continuation-token'] = token
    const { headers } = await signHeaderAuth(credentials(config), {
      method: 'GET', host: r2Host(config), path: objectPath(config.bucket, ''), query,
    }, { region: config.region })
    const response = await fetch(`https://${r2Host(config)}${objectPath(config.bucket, '')}?${new URLSearchParams(query)}`, { headers })
    if (!response.ok) throw new Error(`Inventaire R2 indisponible (${response.status}).`)
    const text = await response.text()
    keys.push(...Array.from(text.matchAll(/<Key>([^<]+)<\/Key>/g), match => xmlText(match[0], 'Key') ?? ''))
    truncated = xmlText(text, 'IsTruncated') === 'true'
    token = xmlText(text, 'NextContinuationToken') ?? undefined
    if (!truncated || !token) break
  }
  return { keys, truncated }
}

/**
 * Télécharge l'objet et calcule son SHA-256 (vérification à la confirmation).
 * Au-delà de maxBytes, renvoie null (vérification par taille uniquement).
 */
export async function getObjectSha256(config: R2Config, key: string, maxBytes: number): Promise<string | null> {
  const { headers } = await signHeaderAuth(credentials(config), {
    method: 'GET', host: r2Host(config), path: objectPath(config.bucket, key),
  }, { region: config.region })
  const response = await fetch(`https://${r2Host(config)}${objectPath(config.bucket, key)}`, { headers })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`R2 indisponible (${response.status}).`)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > maxBytes) return null
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.byteLength !== declared) throw new Error('Taille lue différente de la taille annoncée.')
  if (buffer.byteLength === 0) return sha256Empty
  return sha256Hex(buffer)
}
