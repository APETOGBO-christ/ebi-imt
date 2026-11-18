import { supabase } from '../lib/supabase'
import { crmChanged } from '../crm/api'
import type { DeliveryLineRow, DeliveryRow, PurchaseLineRow, PurchaseRow, SupplierInvoiceRow, SupplierPaymentRow } from './types'

function db() { if (!supabase) throw new Error('Connexion Supabase non configurée.'); return supabase }
function fail(error: { message: string } | null) { if (error) throw new Error(error.message) }

export interface PurchaseFilters { search?: string; status?: string; projectId?: string }

export async function listPurchases(filters: PurchaseFilters = {}): Promise<PurchaseRow[]> {
  let query = db().from('purchase_orders').select('*, companies(id,trade_name,legal_name)').order('created_at', { ascending: false }).limit(300)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.projectId) query = query.eq('project_id', filters.projectId)
  if (filters.search) query = query.or(`purchase_number.ilike.%${filters.search}%,negotiated_ref.ilike.%${filters.search}%`)
  const { data, error } = await query
  fail(error); return data as PurchaseRow[]
}

export async function getPurchase(id: string): Promise<PurchaseRow> {
  const { data, error } = await db().from('purchase_orders').select('*, companies(id,trade_name,legal_name)').eq('id', id).single()
  fail(error); if (!data) throw new Error('Commande fournisseur introuvable.'); return data as PurchaseRow
}

export async function getPurchaseLines(purchaseId: string): Promise<PurchaseLineRow[]> {
  const { data, error } = await db().from('purchase_order_lines').select('*').eq('purchase_order_id', purchaseId).order('position')
  fail(error); return data as PurchaseLineRow[]
}

export async function getInvoices(purchaseId: string): Promise<SupplierInvoiceRow[]> {
  const { data, error } = await db().from('supplier_invoices').select('*').eq('purchase_order_id', purchaseId).order('created_at', { ascending: false })
  fail(error); return data as SupplierInvoiceRow[]
}

export async function getInvoicePayments(invoiceIds: string[]): Promise<SupplierPaymentRow[]> {
  if (invoiceIds.length === 0) return []
  const { data, error } = await db().from('supplier_payments').select('*').in('supplier_invoice_id', invoiceIds).order('paid_at', { ascending: false })
  fail(error); return data as SupplierPaymentRow[]
}

export async function getPurchaseDeliveries(purchaseId: string): Promise<DeliveryRow[]> {
  const { data, error } = await db().from('deliveries').select('*').eq('purchase_order_id', purchaseId).order('created_at', { ascending: false })
  fail(error); return data as DeliveryRow[]
}

export async function getDeliveryLines(deliveryIds: string[]): Promise<DeliveryLineRow[]> {
  if (deliveryIds.length === 0) return []
  const { data, error } = await db().from('delivery_lines').select('*').in('delivery_id', deliveryIds).order('position')
  fail(error); return data as DeliveryLineRow[]
}

export interface PurchaseInput {
  supplier_company_id: string; order_id: string | null; project_id: string | null;
  delivery_expected_at: string | null; payment_terms: string | null; negotiated_ref: string | null; notes: string | null
}

export async function createPurchase(input: PurchaseInput): Promise<string> {
  const iso = (value: string | null) => (value ? new Date(value).toISOString() : null)
  const { data, error } = await db().rpc('purchase_create', {
    p_supplier_company_id: input.supplier_company_id, p_order_id: input.order_id, p_project_id: input.project_id,
    p_delivery_expected_at: iso(input.delivery_expected_at), p_payment_terms: input.payment_terms,
    p_negotiated_ref: input.negotiated_ref, p_notes: input.notes,
  })
  fail(error); crmChanged(); return data as string
}

export async function setPurchaseDetails(
  id: string, paymentTerms: string | null, deliveryExpectedAt: string | null,
  negotiatedRef: string | null, notes: string | null
): Promise<void> {
  const iso = deliveryExpectedAt ? new Date(deliveryExpectedAt).toISOString() : null
  const { error } = await db().rpc('purchase_set_details', {
    p_id: id, p_payment_terms: paymentTerms, p_delivery_expected_at: iso,
    p_negotiated_ref: negotiatedRef, p_notes: notes,
  })
  fail(error); crmChanged()
}

export async function addPurchaseLine(purchaseId: string, designation: string, quantity: number, unit: string | null, unitPrice: number): Promise<void> {
  const { error } = await db().rpc('purchase_item_add', {
    p_purchase_order_id: purchaseId, p_designation: designation, p_quantity: quantity,
    p_unit: unit, p_unit_price_xof: unitPrice,
  })
  fail(error); crmChanged()
}

export async function removePurchaseLine(lineId: string): Promise<void> {
  const { error } = await db().rpc('purchase_item_remove', { p_item_id: lineId })
  fail(error); crmChanged()
}

export async function setPurchaseStatus(id: string, status: string): Promise<void> {
  const { error } = await db().rpc('purchase_set_status', { p_id: id, p_status: status })
  fail(error); crmChanged()
}

export async function registerInvoice(input: {
  purchaseOrderId: string; supplierInvoiceNumber: string; invoiceDate: string;
  amountHt: number; amountTva: number; amountTtc: number; notes: string | null
}): Promise<string> {
  const { data, error } = await db().rpc('supplier_invoice_register', {
    p_purchase_order_id: input.purchaseOrderId, p_supplier_invoice_number: input.supplierInvoiceNumber,
    p_invoice_date: input.invoiceDate, p_amount_ht_xof: input.amountHt,
    p_amount_tva_xof: input.amountTva, p_amount_ttc_xof: input.amountTtc, p_notes: input.notes,
  })
  fail(error); crmChanged(); return data as string
}

export async function declarePayment(input: {
  invoiceId: string; amount: number; method: string; reference: string | null; paidAt: string | null
}): Promise<string> {
  const iso = input.paidAt ? new Date(input.paidAt).toISOString() : null
  const { data, error } = await db().rpc('supplier_payment_declare', {
    p_supplier_invoice_id: input.invoiceId, p_amount_xof: input.amount, p_method: input.method,
    p_reference: input.reference, p_paid_at: iso,
  })
  fail(error); crmChanged(); return data as string
}

export async function verifyPayment(paymentId: string, accept: boolean): Promise<void> {
  const { error } = await db().rpc('supplier_payment_verify', { p_payment_id: paymentId, p_accept: accept })
  fail(error); crmChanged()
}

export async function scheduleReception(purchaseId: string, plannedAt: string | null): Promise<string> {
  const iso = plannedAt ? new Date(plannedAt).toISOString() : null
  const { data, error } = await db().rpc('delivery_schedule', {
    p_kind: 'supplier_reception', p_purchase_order_id: purchaseId, p_planned_at: iso,
  })
  fail(error); crmChanged(); return data as string
}

export async function setDeliveryStatus(input: {
  deliveryId: string; status: string; deliveredAt: string | null; receivedByName: string | null
}): Promise<void> {
  const iso = input.deliveredAt ? new Date(input.deliveredAt).toISOString() : null
  const { error } = await db().rpc('delivery_set_status', {
    p_id: input.deliveryId, p_status: input.status, p_delivered_at: iso, p_received_by_name: input.receivedByName,
  })
  fail(error); crmChanged()
}

export async function addDeliveryLine(input: {
  deliveryId: string; designation: string; quantity: number; unit: string | null;
  purchaseLineId: string | null; receivedOk: boolean
}): Promise<void> {
  const { error } = await db().rpc('delivery_line_add', {
    p_delivery_id: input.deliveryId, p_designation: input.designation, p_quantity: input.quantity,
    p_unit: input.unit, p_purchase_line_id: input.purchaseLineId, p_received_ok: input.receivedOk,
  })
  fail(error); crmChanged()
}

export async function listSupplierCompanies(): Promise<{ id: string; label: string }[]> {
  const { data, error } = await db().from('companies').select('id,trade_name,legal_name').eq('is_active', true).order('trade_name').limit(300)
  fail(error); return (data ?? []).map(row => ({ id: row.id, label: row.trade_name?.trim() || row.legal_name }))
}

export async function listProjectOptions(): Promise<{ id: string; label: string }[]> {
  const { data, error } = await db().from('projects').select('id,project_number,title').order('created_at', { ascending: false }).limit(300)
  fail(error); return (data ?? []).map(row => ({ id: row.id, label: `${row.project_number} — ${row.title}` }))
}

export async function listClientOrderOptions(): Promise<{ id: string; label: string }[]> {
  const { data, error } = await db().from('orders').select('id,order_number').not('proposal_id', 'is', null).order('ordered_at', { ascending: false }).limit(300)
  fail(error); return (data ?? []).map(row => ({ id: row.id, label: row.order_number }))
}
