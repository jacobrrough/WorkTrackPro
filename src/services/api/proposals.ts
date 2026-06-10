import { supabase } from './supabaseClient';

/**
 * Read-only access to inbound customer leads (public.customer_proposals). The public
 * intake function creates a proposal AND its job (linked via linked_job_id); this
 * service lets the job page find the originating lead so an admin can bridge it to
 * an accounting customer or follow the paper trail. Reads throw (React Query).
 */

export interface CustomerProposalSummary {
  id: string;
  submissionId: string;
  contactName: string;
  email: string;
  phone: string;
  status: string;
  linkedJobId: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const nstr = (v: unknown): string | null => (v == null ? null : String(v));

function mapProposalRow(row: Row): CustomerProposalSummary {
  return {
    id: str(row.id),
    submissionId: str(row.submission_id),
    contactName: str(row.contact_name),
    email: str(row.email),
    phone: str(row.phone),
    status: str(row.status),
    linkedJobId: nstr(row.linked_job_id),
    createdAt: str(row.created_at),
  };
}

export const proposalsService = {
  /** The inbound lead that created a given job, if any. */
  async getByLinkedJob(jobId: string): Promise<CustomerProposalSummary | null> {
    const { data, error } = await supabase
      .from('customer_proposals')
      .select('id, submission_id, contact_name, email, phone, status, linked_job_id, created_at')
      .eq('linked_job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return mapProposalRow(data as Row);
  },
};
