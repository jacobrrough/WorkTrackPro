import type { Customer, NewCustomerInput } from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapCustomerRow, type Row } from './mappers';

/**
 * AR customer master (accounting.customers). Reads throw so React Query surfaces
 * errors; writes return null on failure, matching the existing service convention
 * (cf. accountsService / inventoryService).
 */
export const customersService = {
  async getAll(includeInactive = false): Promise<Customer[]> {
    let q = acct().from('customers').select('*').order('display_name', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapCustomerRow);
  },

  async getById(id: string): Promise<Customer | null> {
    const { data, error } = await acct().from('customers').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return mapCustomerRow(data as Row);
  },

  async create(input: NewCustomerInput): Promise<Customer | null> {
    const row = {
      display_name: input.displayName,
      company_name: input.companyName ?? null,
      contact_name: input.contactName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      tax_exempt: input.taxExempt ?? false,
      resale_certificate: input.resaleCertificate ?? null,
      default_tax_code_id: input.defaultTaxCodeId ?? null,
      terms: input.terms ?? null,
      notes: input.notes ?? null,
      source_proposal_id: input.sourceProposalId ?? null,
      billing_address: input.billingAddress ?? null,
      shipping_address: input.shippingAddress ?? null,
      external_qbo_id: input.externalQboId ?? null,
    };
    const { data, error } = await acct().from('customers').insert(row).select('*').single();
    if (error || !data) return null;
    return mapCustomerRow(data as Row);
  },

  async update(
    id: string,
    input: Partial<NewCustomerInput> & { isActive?: boolean }
  ): Promise<Customer | null> {
    const row: Record<string, unknown> = {};
    if (input.displayName != null) row.display_name = input.displayName;
    if (input.companyName !== undefined) row.company_name = input.companyName;
    if (input.contactName !== undefined) row.contact_name = input.contactName;
    if (input.email !== undefined) row.email = input.email;
    if (input.phone !== undefined) row.phone = input.phone;
    if (input.taxExempt !== undefined) row.tax_exempt = input.taxExempt;
    if (input.resaleCertificate !== undefined) row.resale_certificate = input.resaleCertificate;
    if (input.defaultTaxCodeId !== undefined) row.default_tax_code_id = input.defaultTaxCodeId;
    if (input.terms !== undefined) row.terms = input.terms;
    if (input.notes !== undefined) row.notes = input.notes;
    if (input.billingAddress !== undefined) row.billing_address = input.billingAddress;
    if (input.shippingAddress !== undefined) row.shipping_address = input.shippingAddress;
    if (input.externalQboId !== undefined) row.external_qbo_id = input.externalQboId;
    if (input.isActive !== undefined) row.is_active = input.isActive;
    const { data, error } = await acct()
      .from('customers')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) return null;
    return mapCustomerRow(data as Row);
  },

  /**
   * Bridge one inbound lead (public.customer_proposals) to a customer: reuses a
   * customer already carrying the proposal backlink, adopts an existing one by
   * email/display-name (stamping the backlink only when free), or creates a fresh
   * customer from the lead's contact fields — and links the lead's job when that
   * job has no customer yet. Idempotent + safe to re-run (SECURITY DEFINER RPC
   * `ensure_customer_from_proposal`, accounting-writer-gated).
   */
  async ensureFromProposal(
    proposalId: string
  ): Promise<{ customerId: string | null; error?: string }> {
    const { data, error } = await acct().rpc('ensure_customer_from_proposal', {
      p_proposal_id: proposalId,
    });
    if (error || !data) {
      return { customerId: null, error: error?.message ?? 'Could not create the customer.' };
    }
    return { customerId: data as string };
  },
};
