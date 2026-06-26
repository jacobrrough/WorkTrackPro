import { acct } from './accountingClient';

export type SnapshotDocType = 'invoice' | 'estimate';

/** The captured (or live) full state of a document: header columns + ordered line rows. */
export interface DocumentSnapshotPayload {
  header: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
}

/**
 * One version of a document for the Google-Docs-style change feed: a captured snapshot WITH its
 * full payload, or the synthetic live "current" entry (`isCurrent`, `id === null`). Ordered
 * oldest→newest so the client can diff each adjacent pair.
 */
export interface DocumentVersion {
  /** Snapshot id, or null for the live "current" entry (which can't be restored). */
  id: string | null;
  /** ISO timestamp this version was recorded (snapshot capture, or live updated_at). */
  at: string;
  /** Acting user's email, or null for system/unknown. */
  actor: string | null;
  /** 'autosave' | 'sent' | 'before_restore' | 'current'. */
  kind: string;
  note: string | null;
  isCurrent: boolean;
  snapshot: DocumentSnapshotPayload;
}

/**
 * Document version history (accounting.document_snapshots) + restore. Snapshots are captured
 * server-side by accounting.capture_document_snapshot (called before each draft save); restore
 * re-applies a snapshot atomically and is rejected by the RPC for any non-draft document, so it
 * can never touch the ledger.
 */
export const documentSnapshotsService = {
  /**
   * Full version history WITH payloads for the change feed (oldest→newest, plus a trailing live
   * "current" entry). Empty for any document type that doesn't capture snapshots.
   */
  async versions(documentType: SnapshotDocType, documentId: string): Promise<DocumentVersion[]> {
    const { data, error } = await acct().rpc('document_versions', {
      p_type: documentType,
      p_id: documentId,
    });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map((r): DocumentVersion => {
      const o = (r ?? {}) as Record<string, unknown>;
      const snap = (o.snapshot ?? {}) as Record<string, unknown>;
      return {
        id: o.id == null ? null : String(o.id),
        at: String(o.at ?? ''),
        actor: o.actor == null ? null : String(o.actor),
        kind: String(o.kind ?? 'version'),
        note: o.note == null ? null : String(o.note),
        isCurrent: o.isCurrent === true,
        snapshot: {
          header: (snap.header ?? {}) as Record<string, unknown>,
          lines: Array.isArray(snap.lines) ? (snap.lines as Array<Record<string, unknown>>) : [],
        },
      };
    });
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
