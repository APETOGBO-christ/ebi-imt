import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/button'

type Phase = 'checking' | 'no-factor' | 'code-entry' | 'session-aal2'
type CodeEntry = {
  factorId: string
  challengeId: string
  friendlyName: string
  qr: string | null
  secret: string
  uri: string
  firstTime: boolean
}

const FRIENDLY_NAME = 'EBI-IMT Manager'

export function MfaCard() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [entry, setEntry] = useState<CodeEntry | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!supabase) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError) throw listError
      // Les inscriptions abandonnées (facteur jamais vérifié) sont nettoyées.
      for (const factor of factors.all) {
        if (factor.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: factor.id })
      }
      const verified = factors.totp.find(factor => factor.status === 'verified')
      if (!verified) { setPhase('no-factor'); setEntry(null); return }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal?.currentLevel === 'aal2') {
        setPhase('session-aal2'); setEntry(null)
      } else {
        setPhase('code-entry')
        setEntry({ factorId: verified.id, challengeId: '', friendlyName: verified.friendly_name ?? FRIENDLY_NAME, qr: null, secret: '', uri: '', firstTime: false })
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Vérification de la sécurité impossible.')
    } finally { setBusy(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function startEnroll() {
    if (!supabase) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: FRIENDLY_NAME })
      if (enrollError) throw enrollError
      setEntry({
        factorId: data.id, challengeId: '', friendlyName: data.friendly_name ?? FRIENDLY_NAME,
        qr: data.totp?.qr_code ?? null, secret: data.totp?.secret ?? '', uri: data.totp?.uri ?? '', firstTime: true,
      })
      setPhase('code-entry')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "L'activation a échoué. Réessayez.")
    } finally { setBusy(false) }
  }

  async function verify() {
    if (!supabase || !entry?.factorId) return
    const digits = code.replace(/\D/g, '')
    if (digits.length !== 6) { setError('Saisissez les 6 chiffres du code.'); return }
    setBusy(true); setError(null); setNotice(null)
    try {
      let challengeId = entry.challengeId
      if (!challengeId) {
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: entry.factorId })
        if (challengeError) throw challengeError
        challengeId = challenge.id
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: entry.factorId, challengeId, code: digits })
      if (verifyError) throw verifyError
      setCode('')
      setNotice(entry.firstTime ? 'Double validation activée. Cette session est maintenant sécurisée.' : 'Identité confirmée pour cette session.')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Code invalide. Réessayez.')
    } finally { setBusy(false) }
  }

  if (!supabase) return null
  return <section className="module-pending" aria-label="Double validation (MFA)">
    <div className="module-icon"><ShieldCheck size={31} strokeWidth={1.6} /></div>
    <span className="section-kicker">SÉCURITÉ DU COMPTE</span>
    <h2>Double validation (MFA)</h2>
    {phase === 'checking' && <p>Vérification de votre configuration de sécurité…</p>}
    {phase === 'no-factor' && <>
      <p>Ajoutez un facteur TOTP (application d'authentification type Google Authenticator, Ente, Authy). Il est exigé des administrateurs pour les opérations sensibles : invitations, gestion des rôles, encaissements, réconciliation du stock documentaire.</p>
      <Button onClick={() => void startEnroll()} disabled={busy}>Activer la double validation</Button>
    </>}
    {phase === 'code-entry' && entry && <>
      {entry.firstTime && <>
        <p>Ajoutez ce compte dans votre application d'authentification en scannant ce code, ou en saisissant la clé manuellement :</p>
        {entry.qr && <img src={entry.qr} alt="Code QR d'inscription TOTP" width={180} height={180} />}
        {entry.secret && <code style={{ display: 'block', wordBreak: 'break-all' }}>{entry.secret}</code>}
      </>}
      <p>{entry.firstTime ? 'Saisissez le code à 6 chiffres généré par l’application pour terminer l’activation.' : 'Saisissez le code à 6 chiffres de votre application pour confirmer votre identité sur cette session.'}</p>
      <input
        inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
        maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))}
        onKeyDown={event => { if (event.key === 'Enter') void verify() }}
        style={{ maxWidth: 180, textAlign: 'center', letterSpacing: '0.35em' }}
      />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Button onClick={() => void verify()} disabled={busy || code.replace(/\D/g, '').length !== 6}>Valider</Button>
        <Button variant="ghost" onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} /> Actualiser</Button>
      </div>
    </>}
    {phase === 'session-aal2' && <>
      <p className="form-success" role="status">Double validation active pour cette session. Les opérations sensibles sont accessibles.</p>
      <Button variant="ghost" onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} /> Vérifier à nouveau</Button>
    </>}
    {notice && <div className="form-success" role="status">{notice}</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
  </section>
}
