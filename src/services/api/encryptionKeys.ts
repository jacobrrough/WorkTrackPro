import type { UserEncryptionKeys } from '../../core/types';
import { supabase } from './supabaseClient';

function mapKeyRow(row: Record<string, unknown>): UserEncryptionKeys {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    publicKey: row.public_key as string,
    encryptedPrivateKey: row.encrypted_private_key as string,
    keySalt: row.key_salt as string,
    keyIv: row.key_iv as string,
    algorithm: (row.algorithm as string) ?? 'ECDH-P256-AES-GCM',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const encryptionKeyService = {
  async getMyKeys(): Promise<UserEncryptionKeys | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('user_encryption_keys')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapKeyRow(data as Record<string, unknown>) : null;
  },

  async getPublicKey(userId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('user_encryption_keys')
      .select('public_key')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ? ((data as Record<string, unknown>).public_key as string) : null;
  },

  async getPublicKeys(userIds: string[]): Promise<Array<{ userId: string; publicKey: string }>> {
    if (userIds.length === 0) return [];
    const { data, error } = await supabase
      .from('user_encryption_keys')
      .select('user_id, public_key')
      .in('user_id', userIds);
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({
      userId: row.user_id as string,
      publicKey: row.public_key as string,
    }));
  },

  async upsertKeyPair(keyData: {
    publicKey: string;
    encryptedPrivateKey: string;
    keySalt: string;
    keyIv: string;
    algorithm?: string;
  }): Promise<UserEncryptionKeys> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data: row, error } = await supabase
      .from('user_encryption_keys')
      .upsert(
        {
          user_id: user.id,
          public_key: keyData.publicKey,
          encrypted_private_key: keyData.encryptedPrivateKey,
          key_salt: keyData.keySalt,
          key_iv: keyData.keyIv,
          algorithm: keyData.algorithm ?? 'ECDH-P256-AES-GCM',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();
    if (error) throw error;
    return mapKeyRow(row as Record<string, unknown>);
  },

  /** Returns the set of user IDs (from the given list) that have encryption keys. */
  async getUserIdsWithKeys(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const { data, error } = await supabase
      .from('user_encryption_keys')
      .select('user_id')
      .in('user_id', userIds);
    if (error) {
      console.error('encryptionKeyService.getUserIdsWithKeys:', error.message);
      return new Set();
    }
    return new Set((data ?? []).map((r: Record<string, unknown>) => r.user_id as string));
  },

  async hasKeys(): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from('user_encryption_keys')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    return data !== null;
  },
};
