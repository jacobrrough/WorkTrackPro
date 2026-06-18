import { acct } from './accountingClient';
import type { Row } from './mappers';

export type SnapshotDocType = 'invoice' | 'estimate';

export interface DocumentSnapshot {
  id: string;
  documentType: SnapshotDocType;
  documentId: string;
  note: string | null;
  createdAt: string;
}

function mapRow(r: Row): DocumentSnapshot {
  return {
    id: String(r.id),
    documentType: String(r.document_type) as SnapshotDocType,
    documentId: String(r.document_id),
    note: r.note == null ? null : String(r.note),
    createdAt: String(r.created_at),
  };
}

/**
 * Document version history (accounting.document_snapshots) + restore. Snapshots are captured
 * server-side by accounting.capture_document_snapshot (called before each draft save); restore
 * re-applies a snapshot atomically and is rejected by the RPC for any non-draft document, so it
 * can never touch the ledger.
 */
export const documentSnapshotsService = {
  async listForDocument(
    documentType: SnapshotDocType,
    documentId: string
  ): Promise<DocumentSnapshot[]> {
    const { data, error } = await acct()
      .from('document_snapshots')
      .select('id, document_type, document_id, note, created_at')
      .eq('document_type', documentType)
      .eq('document_id', documentId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapRow);
  },

  /** Capture a snapshot of the current state (a restore point). Returns the id, or null on error. */
  async capture(
    documentType: SnapshotDocType,
    documentId: string,
    note?: string
  ): Promise<string | null> {
    const { data, error } = await acct().rpc('capture_document_snapshot', {
      p_type: documentType,
      p_id: documentId,
      p_note: note ?? null,
    });
    if (error) return null;
    return typeof data === 'string' ? data : data == null ? null : String(data);
  },

  /** Restore a DRAFT document to a chosen snapshot (the RPC rejects non-drafts). */
  async restore(snapshotId: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().rpc('restore_document_snapshot', { p_snapshot_id: snapshotId });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};
