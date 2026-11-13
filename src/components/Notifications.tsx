import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface NotificationItem { id: string; severity: 'info' | 'warn' | 'crit'; title: string; detail: string; link: string }

function companyOf(row: { companies: { legal_name: string; trade_name: string | null }[] | null }): string {
  const company = row.companies?.[0]
  return company?.trade_name?.trim() || company?.legal_name || 'Prospect'
}

export function Notifications() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (event: MouseEvent) => { if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    let active = true
    async function load() {
      if (!supabase) { if (active) setLoading(false); return }
      const now = new Date().toISOString()
      const soon = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
      try {
        const [tenders, payments, production, followUps] = await Promise.all([
          supabase.from('tenders').select('id, tender_number, title, submission_deadline, status').not('status', 'in', '(gagne,perdu,annule)').lte('submission_deadline', soon).order('submission_deadline').limit(5),
          supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('production_projects').select('id', { count: 'exact', head: true }).eq('status', 'blocked'),
          supabase.from('leads').select('id, next_follow_up_at, companies!company_id(legal_name, trade_name)').not('next_follow_up_at', 'is', null).lte('next_follow_up_at', now).order('next_follow_up_at').limit(5),
        ])
        if (!active) return
        const collected: NotificationItem[] = []
        for (const row of tenders.data ?? []) {
          const hours = (new Date(row.submission_deadline).getTime() - Date.now()) / 3600000
          collected.push({
            id: `tender-${row.id}`,
            severity: hours <= 48 ? 'crit' : 'warn',
            title: `Dépôt DAO : ${row.tender_number}`,
            detail: `${row.title} — échéance dans ${hours <= 48 ? `${Math.max(1, Math.round(hours))} h` : `${Math.round(hours / 24)} j`} (${row.status === 'depose' || row.status === 'en_evaluation' ? 'déposé' : 'en cours'}).`,
            link: '/appels-offres',
          })
        }
        if ((payments.count ?? 0) > 0) collected.push({ id: 'payments-pending', severity: 'warn', title: 'Paiements à vérifier', detail: `${payments.count} encaissement(s) en attente de vérification.`, link: '/paiements/a-verifier' })
        if ((production.count ?? 0) > 0) collected.push({ id: 'production-blocked', severity: 'crit', title: 'Production bloquée', detail: `${production.count} projet(s) de production bloqué(s).`, link: '/production' })
        for (const row of followUps.data ?? []) {
          collected.push({ id: `followup-${row.id}`, severity: 'info', title: `Relance due : ${companyOf(row)}`, detail: `Relance prévue le ${new Date(row.next_follow_up_at as string).toLocaleDateString('fr-TG')} et non encore réalisée.`, link: '/prospects' })
        }
        setItems(collected)
      } catch { if (active) setItems([]) } finally { if (active) setLoading(false) }
    }
    load()
    const handle = setInterval(load, 5 * 60 * 1000)
    return () => { active = false; clearInterval(handle) }
  }, [])

  const criticalCount = items.filter(item => item.severity !== 'info').length
  return <div className="notif-wrap" ref={wrapper}>
    <button className="notif-trigger" type="button" aria-label="Notifications" onClick={() => setOpen(!open)}><Bell size={18} />{criticalCount > 0 && <span className="notif-badge">{criticalCount}</span>}</button>
    {open && <div className="notif-panel" role="dialog" aria-label="Notifications de l’espace de travail">
      <div className="notif-head"><span>NOTIFICATIONS</span><span>{items.length}</span></div>
      {loading ? <div className="notif-empty">Chargement des notifications…</div> : items.length === 0 ? <div className="notif-empty">Rien à signaler. Toutes les échéances sont sous contrôle.</div> : <ul className="notif-list">{items.map(item => <li key={item.id}><span className={`notif-dot ${item.severity}`} /><div><strong>{item.title}</strong><small>{item.detail}</small><Link to={item.link} onClick={() => setOpen(false)}>Ouvrir</Link></div></li>)}</ul>}
    </div>}
  </div>
}
