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
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, name, initials, is_admin, is_approved')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapProfileToUser);
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
    if (error) throw error;
    return true;
  },
};
