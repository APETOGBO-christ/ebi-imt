import { describe, expect, it } from 'vitest'
import {
  canonicalQuery, canonicalUri, encodeRfc3986, presignUrl, sha256Empty, sha256Hex, signHeaderAuth,
} from '../../supabase/functions/_shared/r2sigv4'
import { libraryPath, slugifyStorageKey } from '../../supabase/functions/_shared/r2client'

describe('r2sigv4 (primitives)', () => {
  it('calcule le SHA-256 de la chaîne vide (vecteur de référence)', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('encode en RFC 3986 : tout sauf A-Za-z0-9-._~', () => {
    expect(encodeRfc3986('a b+c/d~e-f_g.h')).toBe('a%20b%2Bc%2Fd~e-f_g.h')
    expect(encodeRfc3986('é')).toBe('%C3%A9')
  })

  it('préserve les séparateurs de chemin', () => {
    expect(canonicalUri('/test.txt')).toBe('/test.txt')
    expect(canonicalUri('a b/c+d')).toBe('/a%20b/c%2Bd')
  })

  it('trie la requête canonique par clé puis valeur', () => {
    expect(canonicalQuery({ b: '2', a: '1', c: '3' })).toBe('a=1&b=2&c=3')
    expect(canonicalQuery({ b: 'z', b2: 'a' })).toBe('b=z&b2=a')
  })
})

describe('r2sigv4 (vecteurs officiels)', () => {
  const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }

  it('aws-sig-v4-test-suite get-vanilla', async () => {
    const { headers } = await signHeaderAuth(credentials, {
      method: 'GET', host: 'example.amazonaws.com', path: '/',
      payloadHash: sha256Empty, includeSha256Header: false,
    }, { region: 'us-east-1', service: 'service', now: new Date('2015-08-30T12:36:00Z') })
    expect(headers.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31')
  })

  it('exemple S3 de pré-signature GET (documentation AWS)', async () => {
    const { url } = await presignUrl(
      { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
      { method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt' },
      { region: 'us-east-1', service: 's3', now: new Date('2013-05-24T00:00:00Z'), expiresIn: 86_400 },
    )
    expect(url).toBe('https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
  })
})

describe('r2client (clés de stockage)', () => {
  it('normalise les noms de fichiers', () => {
    expect(slugifyStorageKey('Contrat Cadre — Édition 2026.pdf')).toBe('contrat-cadre-edition-2026.pdf')
    expect(slugifyStorageKey('Notes Internes.docx')).toBe('notes-internes.docx')
    expect(slugifyStorageKey('###')).toBe('document')
  })

  it('place le dépôt dans library/AAAA/MM/<dépôt>/', () => {
    expect(libraryPath('11111111-1111-1111-1111-111111111111', 'Contrat.pdf', new Date('2026-11-13T10:00:00Z')))
      .toBe('library/2026/11/11111111-1111-1111-1111-111111111111/contrat.pdf')
  })
})
