import type { User } from '../../core/types';
import { supabase } from './supabaseClient';

function mapProfileToUser(row: { id: string; email: string | null; name: string | null; initials: string | null; is_admin: boolean }): User {
  return {
    id: row.id,
    email: row.email ?? '',
    name: row.name ?? undefined,
    initials: row.initials ?? undefined,
    isAdmin: row.is_admin,
  };
}

export const userService = {
  async getAllUsers(): Promise<User[]> {
    const { data, error } = await supabase.from('profiles').select('id, email, name, initials, is_admin').order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapProfileToUser);
  },
};
