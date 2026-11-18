export type PurchaseStatus = 'draft' | 'submitted' | 'confirmed' | 'sent' | 'partially_received' | 'received' | 'closed' | 'cancelled'
export type InvoiceStatus = 'received' | 'partially_paid' | 'paid' | 'rejected' | 'disputed'
export type PaymentStatus = 'pending' | 'confirmed' | 'rejected'
export type PaymentMethod = 'cash' | 'bank_transfer' | 'mobile_money' | 'cheque'
export type DeliveryStatus = 'planned' | 'in_transit' | 'delivered' | 'cancelled' | 'partial'

export interface PurchaseRow {
  id: string; purchase_number: string; supplier_company_id: string; order_id: string | null;
  project_id: string | null; tender_id: string | null; status: PurchaseStatus;
  total_xof: number; delivery_expected_at: string | null; payment_terms: string | null;
  negotiated_ref: string | null; notes: string | null;
  submitted_at: string | null; confirmed_at: string | null; sent_at: string | null; closed_at: string | null;
  created_by: string; created_at: string
}

export interface PurchaseLineRow {
  id: string; purchase_order_id: string; position: number; designation: string;
  quantity: number; unit: string | null; unit_price_xof: number; amount_xof: number
}

export interface SupplierInvoiceRow {
  id: string; purchase_order_id: string; supplier_invoice_number: string; invoice_date: string;
  amount_ht_xof: number; amount_tva_xof: number; amount_ttc_xof: number; status: InvoiceStatus;
  notes: string | null; received_by: string; created_at: string
}

export interface SupplierPaymentRow {
  id: string; supplier_invoice_id: string; amount_xof: number; method: PaymentMethod;
  reference: string | null; paid_at: string; status: PaymentStatus;
  verified_by: string | null; verified_at: string | null; notes: string | null
}

export interface DeliveryRow {
  id: string; delivery_number: string; kind: 'client_delivery' | 'supplier_reception';
  order_id: string | null; purchase_order_id: string | null; status: DeliveryStatus;
  planned_at: string | null; delivered_at: string | null; received_by_name: string | null; notes: string | null
}

export interface DeliveryLineRow {
  id: string; delivery_id: string; position: number; designation: string; quantity: number;
  unit: string | null; purchase_line_id: string | null; received_ok: boolean; notes: string | null
}

export const purchaseStatusLabels: Record<PurchaseStatus, string> = {
  draft: 'Brouillon', submitted: 'Soumis à validation', confirmed: 'Validé', sent: 'Envoyé',
  partially_received: 'Partiellement reçu', received: 'Reçu', closed: 'Clôturé', cancelled: 'Annulé',
}
export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  received: 'Reçue', partially_paid: 'Partiellement payée', paid: 'Payée', rejected: 'Rejetée', disputed: 'Contestée',
}
export const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: 'À vérifier', confirmed: 'Confirmé', rejected: 'Rejeté',
}
export const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Espèces', bank_transfer: 'Virement bancaire', mobile_money: 'Mobile money', cheque: 'Chèque',
}
export const deliveryStatusLabels: Record<DeliveryStatus, string> = {
  planned: 'Planifiée', in_transit: 'En transit', delivered: 'Livrée', cancelled: 'Annulée', partial: 'Partielle',
}

export interface PurchaseTransition { to: PurchaseStatus; label: string; validate?: boolean }
export const purchaseTransitions: Record<PurchaseStatus, PurchaseTransition[]> = {
  draft: [{ to: 'submitted', label: 'Soumettre à validation' }, { to: 'cancelled', label: 'Annuler' }],
  submitted: [{ to: 'confirmed', label: 'Valider la commande', validate: true }, { to: 'cancelled', label: 'Annuler' }],
  confirmed: [{ to: 'sent', label: 'Marquer envoyée' }, { to: 'cancelled', label: 'Annuler' }],
  sent: [{ to: 'received', label: 'Marquer reçue' }, { to: 'partially_received', label: 'Partiellement reçue' }, { to: 'cancelled', label: 'Annuler' }],
  partially_received: [{ to: 'received', label: 'Marquer reçue' }, { to: 'cancelled', label: 'Annuler' }],
  received: [{ to: 'closed', label: 'Clôturer', validate: true }],
  closed: [],
  cancelled: [],
}

export const whenFr = (value: string) =>
  new Intl.DateTimeFormat('fr-TG', { timeZone: 'Africa/Lome', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export const dateFr = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat('fr-TG', { timeZone: 'Africa/Lome', dateStyle: 'medium' }).format(new Date(value)) : '—'

export const xof = (amount: number | null | undefined) =>
  amount === null || amount === undefined ? '—' : `${new Intl.NumberFormat('fr-TG').format(amount)} FCFA`
