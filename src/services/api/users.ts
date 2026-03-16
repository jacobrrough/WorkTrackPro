import type { User } from '../../core/types';
import { supabase } from './supabaseClient';

function mapProfileToUser(row: {
  id: string;
  email: string | null;
  name: string | null;
  initials: string | null;
  is_admin: boolean;
  is_approved?: boolean;
}): User {
  return {
    id: row.id,
    email: row.email ?? '',
    name: row.name ?? undefined,
    initials: row.initials ?? undefined,
    isAdmin: row.is_admin,
    isApproved: row.is_approved ?? true,
  };
}

export const userService = {
  async getAllUsers(): Promise<User[]> {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/420c3f8e-a11f-4fdd-8f0d-e05619cdd04d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f7ffcc' },
      body: JSON.stringify({
        sessionId: 'f7ffcc',
        location: 'users.ts:getAllUsers',
        message: 'getAllUsers called',
        data: {},
        timestamp: Date.now(),
        hypothesisId: 'admin-list-users',
      }),
    }).catch(() => {});
    // #endregion
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, name, initials, is_admin, is_approved')
      .order('created_at', { ascending: false });
    if (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/420c3f8e-a11f-4fdd-8f0d-e05619cdd04d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f7ffcc' },
        body: JSON.stringify({
          sessionId: 'f7ffcc',
          location: 'users.ts:getAllUsers',
          message: 'getAllUsers error',
          data: { msg: error.message, code: error.code },
          timestamp: Date.now(),
          hypothesisId: 'admin-list-fails',
        }),
      }).catch(() => {});
      // #endregion
      throw error;
    }
    const list = (data ?? []).map(mapProfileToUser);
    const pendingCount = list.filter((u) => u.isApproved === false).length;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/420c3f8e-a11f-4fdd-8f0d-e05619cdd04d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f7ffcc' },
      body: JSON.stringify({
        sessionId: 'f7ffcc',
        location: 'users.ts:getAllUsers',
        message: 'getAllUsers success',
        data: { total: list.length, pendingCount },
        timestamp: Date.now(),
        hypothesisId: 'admin-list-users',
      }),
    }).catch(() => {});
    // #endregion
    return list;
  },

  async updateUser(
    userId: string,
    patch: {
      isAdmin?: boolean;
      isApproved?: boolean;
      approvedAt?: string | null;
      approvedBy?: string | null;
    }
  ): Promise<boolean> {
    const update: Record<string, unknown> = {};
    if (patch.isAdmin !== undefined) update.is_admin = patch.isAdmin;
    if (patch.isApproved !== undefined) update.is_approved = patch.isApproved;
    if (patch.approvedAt !== undefined) update.approved_at = patch.approvedAt;
    if (patch.approvedBy !== undefined) update.approved_by = patch.approvedBy;
    if (Object.keys(update).length === 0) return true;

    const { error } = await supabase.from('profiles').update(update).eq('id', userId);
    if (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/420c3f8e-a11f-4fdd-8f0d-e05619cdd04d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f7ffcc' },
        body: JSON.stringify({
          sessionId: 'f7ffcc',
          location: 'users.ts:updateUser',
          message: 'updateUser error',
          data: { userId, msg: error.message, code: error.code, patch: patch.isApproved },
          timestamp: Date.now(),
          hypothesisId: 'approve-fails',
        }),
      }).catch(() => {});
      // #endregion
      throw error;
    }
    if (patch.isApproved === true) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/420c3f8e-a11f-4fdd-8f0d-e05619cdd04d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f7ffcc' },
        body: JSON.stringify({
          sessionId: 'f7ffcc',
          location: 'users.ts:updateUser',
          message: 'approve success',
          data: { userId },
          timestamp: Date.now(),
          hypothesisId: 'approve-flow',
        }),
      }).catch(() => {});
      // #endregion
    }
    return true;
  },
};
