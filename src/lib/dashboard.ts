import { supabase } from './supabase'
import type { ZoneId } from './modules'

export interface DashboardStats {
  activeLeads: number
  scheduledMeetings: number
  confirmedOrders: number
  confirmedPaymentsXof: bigint
  tendersInCourse: number
  tendersWon: number
  tendersLost: number
  activeProjects: number
  clientsCount: number
  suppliersCount: number
  ordersInProgress: number
}
export interface InspectionData { metric: string; value: string; details: { label: string; value: string }[] }
export interface RecentDelivery { id: string; delivery_number: string; status: string; planned_at: string | null; delivered_at: string | null; orders: { order_number: string }[] | null }
export interface UpcomingDeadline { id: string; kind: 'tender' | 'follow_up'; label: string; when: string }
export interface RecentActivity { id: string; activity_type: string; occurred_at: string; subject: string | null; leads: { companies: { legal_name: string; trade_name: string | null }[] | null }[] | null }

function client() {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  return supabase
}
function countResult(result: { count: number | null; error: { message: string } | null }): number {
  if (result.error) throw new Error(result.error.message)
  return result.count ?? 0
}

export function totalConfirmedXof(payments: { amount_xof: string | number; status: string }[]): bigint {
  return payments.reduce((sum, payment) => payment.status === 'confirmed' ? sum + BigInt(String(payment.amount_xof)) : sum, 0n)
}

async function sumConfirmedPayments(): Promise<bigint> {
  const db = client()
  let total = 0n
  let from = 0
  const pageSize = 500
  while (true) {
    const { data, error } = await db.from('financial_ledger').select('amount_xof').order('id').range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    for (const entry of page) total += BigInt(String(entry.amount_xof))
    if (page.length < pageSize) break
    from += pageSize
  }
  return total
}

async function sumConfirmedOrderAmounts(): Promise<bigint> {
  const db = client()
  let total = 0n
  let from = 0
  const pageSize = 500
  while (true) {
    const { data, error } = await db.from('orders').select('amount_xof').in('order_status', ['confirmed', 'in_progress', 'completed']).order('id').range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    for (const item of page) total += BigInt(String(item.amount_xof))
    if (page.length < pageSize) break
    from += pageSize
  }
  return total
}

async function sumActiveInstallments(): Promise<bigint> {
  const db = client()
  let total = 0n
  let from = 0
  const pageSize = 500
  while (true) {
    const { data, error } = await db.from('order_installments')
      .select('amount_xof,orders!inner(order_status)')
      .in('orders.order_status', ['draft', 'confirmed', 'in_progress', 'completed'])
      .order('id').range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    for (const item of page) total += BigInt(String(item.amount_xof))
    if (page.length < pageSize) break
    from += pageSize
  }
  return total
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const db = client()
  const now = new Date().toISOString()
  const [leads, meetings, orders, confirmedPaymentsXof, tendersPreparing, tendersSubmitted, tendersWon, tendersLost, projects, clients, suppliers, ordersInProgress] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).not('status', 'in', '(won,lost,archived)'),
    db.from('appointments').select('id', { count: 'exact', head: true }).eq('kind', 'meeting').in('status', ['scheduled', 'confirmed']).gte('scheduled_at', now),
    db.from('orders').select('id', { count: 'exact', head: true }).in('order_status', ['confirmed', 'in_progress', 'completed']),
    sumConfirmedPayments(),
    db.from('tenders').select('id', { count: 'exact', head: true }).eq('status', 'preparing'),
    db.from('tenders').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    db.from('tenders').select('id', { count: 'exact', head: true }).eq('status', 'won'),
    db.from('tenders').select('id', { count: 'exact', head: true }).eq('status', 'lost'),
    db.from('projects').select('id', { count: 'exact', head: true }).in('status', ['planned', 'in_progress']),
    db.from('companies').select('id, company_roles!inner(role_code)', { count: 'exact', head: true }).eq('is_active', true).eq('company_roles.role_code', 'client'),
    db.from('companies').select('id, company_roles!inner(role_code)', { count: 'exact', head: true }).eq('is_active', true).eq('company_roles.role_code', 'fournisseur'),
    db.from('orders').select('id', { count: 'exact', head: true }).in('order_status', ['confirmed', 'in_progress']),
  ])
  return {
    activeLeads: countResult(leads), scheduledMeetings: countResult(meetings), confirmedOrders: countResult(orders), confirmedPaymentsXof,
    tendersInCourse: countResult(tendersPreparing) + countResult(tendersSubmitted), tendersWon: countResult(tendersWon), tendersLost: countResult(tendersLost),
    activeProjects: countResult(projects), clientsCount: countResult(clients), suppliersCount: countResult(suppliers), ordersInProgress: countResult(ordersInProgress),
  }
}

export async function getRecentDeliveries(): Promise<RecentDelivery[]> {
  const db = client()
  const { data, error } = await db.from('deliveries')
    .select('id, delivery_number, status, planned_at, delivered_at, orders!order_id(order_number)')
    .order('created_at', { ascending: false }).limit(5)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as RecentDelivery[]
}

export async function getUpcomingDeadlines(): Promise<UpcomingDeadline[]> {
  const db = client()
  const now = new Date().toISOString()
  const [tenders, followUps, meetings] = await Promise.all([
    db.from('tenders').select('id, tender_number, title, submission_deadline').in('status', ['preparing', 'submitted']).gte('submission_deadline', now).order('submission_deadline').limit(6),
    db.from('leads').select('id, next_follow_up_at, companies!company_id(legal_name, trade_name)').not('next_follow_up_at', 'is', null).gte('next_follow_up_at', now).order('next_follow_up_at').limit(6),
    db.from('appointments').select('id, scheduled_at, leads!lead_id(companies!company_id(legal_name, trade_name))').eq('kind', 'meeting').in('status', ['scheduled', 'confirmed']).gte('scheduled_at', now).order('scheduled_at').limit(6),
  ])
  if (tenders.error) throw new Error(tenders.error.message)
  if (followUps.error) throw new Error(followUps.error.message)
  if (meetings.error) throw new Error(meetings.error.message)
  const companyName = (row: { companies: { legal_name: string; trade_name: string | null } | { legal_name: string; trade_name: string | null }[] | null }): string => {
    const company = Array.isArray(row.companies) ? row.companies[0] : row.companies
    return company?.trade_name?.trim() || company?.legal_name || 'Prospect'
  }
  const items: UpcomingDeadline[] = [
    ...(tenders.data ?? []).map(row => ({ id: row.id, kind: 'tender' as const, label: `${row.tender_number} · ${row.title}`, when: row.submission_deadline })),
    ...(followUps.data ?? []).map(row => ({ id: row.id, kind: 'follow_up' as const, label: `Relance : ${companyName(row)}`, when: row.next_follow_up_at as string })),
    ...(meetings.data ?? []).map(row => ({ id: row.id, kind: 'follow_up' as const, label: `Rendez-vous : ${companyName({ companies: row.leads?.[0]?.companies ?? null })}`, when: row.scheduled_at })),
  ]
  return items.sort((first, second) => first.when.localeCompare(second.when)).slice(0, 6)
}

export async function getRecentActivities(): Promise<RecentActivity[]> {
  const db = client()
  const { data, error } = await db.from('activities')
    .select('id, activity_type, occurred_at, subject, leads!lead_id(companies!company_id(legal_name, trade_name))')
    .order('occurred_at', { ascending: false }).limit(6)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as RecentActivity[]
}

export async function getInspectionData(zone: ZoneId): Promise<InspectionData> {
  const db = client()
  const now = new Date().toISOString()
  switch (zone) {
    case 'prospects': {
      const [total, followUps, recent] = await Promise.all([
        db.from('leads').select('id', { count: 'exact', head: true }),
        db.from('leads').select('id', { count: 'exact', head: true }).gte('next_follow_up_at', now),
        db.from('activities').select('id, activity_type, occurred_at').order('occurred_at', { ascending: false }).limit(1),
      ])
      if (recent.error) throw new Error(recent.error.message)
      return { metric: 'Prospects accessibles', value: String(countResult(total)), details: [
        { label: 'Relances à venir', value: String(countResult(followUps)) },
        { label: 'Dernière activité', value: recent.data?.[0] ? new Date(recent.data[0].occurred_at).toLocaleDateString('fr-TG') : 'Aucune' },
      ] }
    }
    case 'activities': {
      const [future, past, demos] = await Promise.all([
        db.from('appointments').select('id', { count: 'exact', head: true }).eq('kind', 'meeting').in('status', ['scheduled', 'confirmed']).gte('scheduled_at', now),
        db.from('activities').select('id', { count: 'exact', head: true }).lt('occurred_at', now),
        db.from('appointments').select('id', { count: 'exact', head: true }).eq('kind', 'demo').eq('status', 'completed'),
      ])
      return { metric: 'Rendez-vous programmés', value: String(countResult(future)), details: [{ label: 'Démonstrations réalisées', value: String(countResult(demos)) }, { label: 'Activités passées', value: String(countResult(past)) }] }
    }
    case 'offers': {
      const [offers, proposals, accepted, orders, recent, contractTotal, daoPreparing, daoSubmitted, daoWon, daoLost] = await Promise.all([
        db.from('offer_templates').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        db.from('commercial_proposals').select('id', { count: 'exact', head: true }).in('status', ['approved', 'sent']),
        db.from('commercial_proposals').select('id', { count: 'exact', head: true }).eq('status', 'accepted'),
        db.from('orders').select('id', { count: 'exact', head: true }).in('order_status', ['confirmed', 'in_progress', 'completed']),
        db.from('orders').select('order_number,amount_xof').order('ordered_at', { ascending: false }).limit(1),
        sumConfirmedOrderAmounts(),
        db.from('tenders').select('id', { count: 'exact', head: true }).eq('status', 'preparing'),
        db.from('tenders').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
        db.from('tenders').select('id', { count: 'exact', head: true }).eq('status', 'won'),
        db.from('tenders').select('id', { count: 'exact', head: true }).eq('status', 'lost'),
      ])
      if (recent.error) throw new Error(recent.error.message)
      return { metric: 'Commandes confirmées', value: String(countResult(orders)), details: [
        { label: 'Offres actives', value: String(countResult(offers)) },
        { label: 'Propositions en cours', value: String(countResult(proposals)) },
        { label: 'Propositions acceptées', value: String(countResult(accepted)) },
        { label: 'DAO en préparation', value: String(countResult(daoPreparing)) },
        { label: 'DAO soumis', value: String(countResult(daoSubmitted)) },
        { label: 'DAO gagnés / perdus', value: `${countResult(daoWon)} / ${countResult(daoLost)}` },
        { label: 'Montant contractuel confirmé', value: `${new Intl.NumberFormat('fr-TG').format(contractTotal)} FCFA` },
        { label: 'Dernière commande', value: recent.data?.[0] ? `${recent.data[0].order_number} · ${new Intl.NumberFormat('fr-TG').format(recent.data[0].amount_xof)} FCFA` : 'Aucune' },
      ] }
    }
    case 'payments': {
      const [total, pending, installments, expected] = await Promise.all([
        sumConfirmedPayments(),
        db.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        db.from('order_installments').select('id', { count: 'exact', head: true }),
        sumActiveInstallments(),
      ])
      return { metric: 'Encaissement net vérifié', value: `${new Intl.NumberFormat('fr-TG').format(total)} FCFA`, details: [{ label: 'Échéances contractuelles', value: String(countResult(installments)) }, { label: 'Solde contractuel estimé', value: `${new Intl.NumberFormat('fr-TG').format(expected > total ? expected - total : 0n)} FCFA` }, { label: 'Paiements à vérifier', value: String(countResult(pending)) }] }
    }
    case 'production': {
      const [active, blocked, planned, transit] = await Promise.all([
        db.from('production_projects').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
        db.from('production_projects').select('id', { count: 'exact', head: true }).eq('status', 'blocked'),
        db.from('deliveries').select('id', { count: 'exact', head: true }).eq('status', 'planned'),
        db.from('deliveries').select('id', { count: 'exact', head: true }).eq('status', 'in_transit'),
      ])
      return { metric: 'Projets en production', value: String(countResult(active)), details: [{ label: 'Projets bloqués', value: String(countResult(blocked)) }, { label: 'Livraisons planifiées', value: String(countResult(planned)) }, { label: 'Livraisons en transit', value: String(countResult(transit)) }] }
    }
    case 'delivery': {
      const [delivered, ready, shipped] = await Promise.all([
        db.from('production_projects').select('id', { count: 'exact', head: true }).eq('status', 'delivered'),
        db.from('production_projects').select('id', { count: 'exact', head: true }).eq('status', 'ready_for_delivery'),
        db.from('deliveries').select('id', { count: 'exact', head: true }).eq('status', 'delivered'),
      ])
      return { metric: 'Projets livrés', value: String(countResult(delivered)), details: [{ label: 'Prêts à livrer', value: String(countResult(ready)) }, { label: 'Livraisons effectuées', value: String(countResult(shipped)) }] }
    }
  }
}
