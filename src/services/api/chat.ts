import type {
  Conversation,
  ConversationMember,
  ConversationMemberRole,
  Message,
  MessageAttachment,
  MessageReceipt,
  MessageType,
} from '../../core/types';
import { supabase } from './supabaseClient';

// ── Row mappers ──────────────────────────────────────

function mapConversationRow(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    type: row.type as Conversation['type'],
    name: (row.name as string) ?? undefined,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapMemberRow(row: Record<string, unknown>): ConversationMember {
  const profile = row.profiles as { name?: string; initials?: string } | null;
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    userId: row.user_id as string,
    userName: profile?.name ?? (row.user_name as string) ?? undefined,
    userInitials: profile?.initials ?? (row.user_initials as string) ?? undefined,
    encryptedConversationKey: (row.encrypted_conversation_key as string) ?? undefined,
    keyIv: (row.key_iv as string) ?? undefined,
    role: ((row.role as string) ?? 'member') as ConversationMemberRole,
    joinedAt: row.joined_at as string,
    leftAt: (row.left_at as string) ?? undefined,
  };
}

function mapMessageRow(row: Record<string, unknown>): Message {
  const profile = row.profiles as { name?: string; initials?: string } | null;
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    senderId: row.sender_id as string,
    senderName: profile?.name ?? undefined,
    senderInitials: profile?.initials ?? undefined,
    encryptedContent: row.encrypted_content as string,
    contentIv: row.content_iv as string,
    messageType: ((row.message_type as string) ?? 'text') as MessageType,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string) ?? undefined,
  };
}

function mapReceiptRow(row: Record<string, unknown>): MessageReceipt {
  const profile = row.profiles as { name?: string } | null;
  return {
    id: row.id as string,
    messageId: row.message_id as string,
    userId: row.user_id as string,
    userName: profile?.name ?? undefined,
    deliveredAt: (row.delivered_at as string) ?? undefined,
    readAt: (row.read_at as string) ?? undefined,
  };
}

function mapAttachmentRow(row: Record<string, unknown>): MessageAttachment {
  return {
    id: row.id as string,
    messageId: row.message_id as string,
    storagePath: row.storage_path as string,
    encryptedFileKey: row.encrypted_file_key as string,
    fileKeyIv: row.file_key_iv as string,
    fileIv: row.file_iv as string,
    fileName: row.file_name as string,
    fileSize: row.file_size as number,
    mimeType: (row.mime_type as string) ?? 'application/octet-stream',
  };
}

// ── Service ──────────────────────────────────────────

export const chatService = {
  // ── Conversations ─────────────────────────────────

  async getConversations(): Promise<Conversation[]> {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('chatService.getConversations:', error.message);
      return [];
    }
    return (data ?? []).map((r: Record<string, unknown>) => mapConversationRow(r));
  },

  async getConversationWithMembers(
    conversationId: string
  ): Promise<{ conversation: Conversation; members: ConversationMember[] } | null> {
    const [convRes, memRes] = await Promise.all([
      supabase.from('conversations').select('*').eq('id', conversationId).single(),
      supabase
        .from('conversation_members')
        .select('*, profiles(name, initials)')
        .eq('conversation_id', conversationId)
        .is('left_at', null),
    ]);
    if (convRes.error || !convRes.data) return null;
    const conversation = mapConversationRow(convRes.data as Record<string, unknown>);
    const members = (memRes.data ?? []).map((r: Record<string, unknown>) => mapMemberRow(r));
    return { conversation, members };
  },

  async findDirectConversation(otherUserId: string): Promise<string | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase.rpc('find_direct_conversation', {
      user_a: user.id,
      user_b: otherUserId,
    });
    if (error || !data) return null;
    return data as string;
  },

  async createDirectConversation(params: {
    otherUserId: string;
    myEncryptedKey: string;
    myKeyIv: string;
    otherEncryptedKey: string;
    otherKeyIv: string;
  }): Promise<Conversation> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const existing = await chatService.findDirectConversation(params.otherUserId);
    if (existing) {
      const conv = await chatService.getConversationWithMembers(existing);
      if (conv) return conv.conversation;
    }

    const { data: convRow, error: convErr } = await supabase
      .from('conversations')
      .insert({ type: 'direct', created_by: user.id })
      .select()
      .single();
    if (convErr || !convRow) throw convErr ?? new Error('Failed to create conversation');
    const convId = (convRow as Record<string, unknown>).id as string;

    const { error: memErr } = await supabase.from('conversation_members').insert([
      {
        conversation_id: convId,
        user_id: user.id,
        encrypted_conversation_key: params.myEncryptedKey,
        key_iv: params.myKeyIv,
        role: 'admin',
      },
      {
        conversation_id: convId,
        user_id: params.otherUserId,
        encrypted_conversation_key: params.otherEncryptedKey,
        key_iv: params.otherKeyIv,
        role: 'member',
      },
    ]);
    if (memErr) throw memErr;
    return mapConversationRow(convRow as Record<string, unknown>);
  },

  async createGroupConversation(params: {
    name: string;
    memberKeys: Array<{
      userId: string;
      encryptedKey: string;
      keyIv: string;
    }>;
  }): Promise<Conversation> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data: convRow, error } = await supabase
      .from('conversations')
      .insert({ type: 'group', name: params.name, created_by: user.id })
      .select()
      .single();
    if (error || !convRow) throw error ?? new Error('Failed to create group');
    const convId = (convRow as Record<string, unknown>).id as string;

    const rows = params.memberKeys.map((mk) => ({
      conversation_id: convId,
      user_id: mk.userId,
      encrypted_conversation_key: mk.encryptedKey,
      key_iv: mk.keyIv,
      role: mk.userId === user.id ? 'admin' : 'member',
    }));
    const { error: memErr } = await supabase.from('conversation_members').insert(rows);
    if (memErr) throw memErr;
    return mapConversationRow(convRow as Record<string, unknown>);
  },

  async updateConversation(
    conversationId: string,
    updates: { name?: string }
  ): Promise<Conversation | null> {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) patch.name = updates.name;
    const { data: row, error } = await supabase
      .from('conversations')
      .update(patch)
      .eq('id', conversationId)
      .select()
      .single();
    if (error || !row) return null;
    return mapConversationRow(row as Record<string, unknown>);
  },

  // ── Members ───────────────────────────────────────

  async addMember(
    conversationId: string,
    params: {
      userId: string;
      encryptedKey: string;
      keyIv: string;
      role?: ConversationMemberRole;
    }
  ): Promise<ConversationMember | null> {
    const { data: row, error } = await supabase
      .from('conversation_members')
      .insert({
        conversation_id: conversationId,
        user_id: params.userId,
        encrypted_conversation_key: params.encryptedKey,
        key_iv: params.keyIv,
        role: params.role ?? 'member',
      })
      .select('*, profiles(name, initials)')
      .single();
    if (error || !row) return null;
    return mapMemberRow(row as Record<string, unknown>);
  },

  async leaveConversation(conversationId: string): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { error } = await supabase
      .from('conversation_members')
      .update({ left_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id);
    return !error;
  },

  async removeMember(conversationId: string, userId: string): Promise<boolean> {
    const { error } = await supabase
      .from('conversation_members')
      .update({ left_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    return !error;
  },

  async updateMemberKey(
    conversationId: string,
    userId: string,
    encryptedKey: string,
    keyIv: string
  ): Promise<boolean> {
    const { error } = await supabase
      .from('conversation_members')
      .update({ encrypted_conversation_key: encryptedKey, key_iv: keyIv })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    return !error;
  },

  async getMyConversationKey(
    conversationId: string
  ): Promise<{ encryptedKey: string; keyIv: string } | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('conversation_members')
      .select('encrypted_conversation_key, key_iv')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .single();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      encryptedKey: row.encrypted_conversation_key as string,
      keyIv: row.key_iv as string,
    };
  },

  async getConversationMembers(conversationId: string): Promise<ConversationMember[]> {
    const { data, error } = await supabase
      .from('conversation_members')
      .select('*, profiles(name, initials)')
      .eq('conversation_id', conversationId)
      .is('left_at', null);
    if (error) return [];
    return (data ?? []).map((r: Record<string, unknown>) => mapMemberRow(r));
  },

  // ── Messages ──────────────────────────────────────

  async getMessages(
    conversationId: string,
    options?: { limit?: number; before?: string }
  ): Promise<Message[]> {
    let query = supabase
      .from('messages')
      .select('*, profiles:sender_id(name, initials), message_attachments(*)')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(options?.limit ?? 50);
    if (options?.before) query = query.lt('created_at', options.before);
    const { data, error } = await query;
    if (error) {
      console.error('chatService.getMessages:', error.message);
      return [];
    }
    return (data ?? []).map((r: Record<string, unknown>) => {
      const msg = mapMessageRow(r);
      const attRows = r.message_attachments as Record<string, unknown>[] | undefined;
      msg.attachments = (attRows ?? []).map(mapAttachmentRow);
      return msg;
    });
  },

  async sendMessage(params: {
    conversationId: string;
    encryptedContent: string;
    contentIv: string;
    messageType?: MessageType;
  }): Promise<Message> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data: row, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: params.conversationId,
        sender_id: user.id,
        encrypted_content: params.encryptedContent,
        content_iv: params.contentIv,
        message_type: params.messageType ?? 'text',
      })
      .select('*, profiles:sender_id(name, initials)')
      .single();
    if (error) throw error;
    return mapMessageRow(row as Record<string, unknown>);
  },

  async deleteMessage(messageId: string): Promise<boolean> {
    const { error } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId);
    return !error;
  },

  // ── Receipts ──────────────────────────────────────

  async markDelivered(messageIds: string[]): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || messageIds.length === 0) return;
    const now = new Date().toISOString();
    const rows = messageIds.map((id) => ({
      message_id: id,
      user_id: user.id,
      delivered_at: now,
    }));
    await supabase
      .from('message_receipts')
      .upsert(rows, { onConflict: 'message_id,user_id', ignoreDuplicates: false });
  },

  async markRead(messageIds: string[]): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || messageIds.length === 0) return;
    const now = new Date().toISOString();
    const rows = messageIds.map((id) => ({
      message_id: id,
      user_id: user.id,
      delivered_at: now,
      read_at: now,
    }));
    await supabase
      .from('message_receipts')
      .upsert(rows, { onConflict: 'message_id,user_id', ignoreDuplicates: false });
  },

  async getReceipts(messageIds: string[]): Promise<MessageReceipt[]> {
    if (messageIds.length === 0) return [];
    const { data, error } = await supabase
      .from('message_receipts')
      .select('*, profiles:user_id(name)')
      .in('message_id', messageIds);
    if (error) return [];
    return (data ?? []).map((r: Record<string, unknown>) => mapReceiptRow(r));
  },

  // ── Attachments ───────────────────────────────────

  async uploadAttachment(params: {
    messageId: string;
    conversationId: string;
    encryptedFile: Blob;
    encryptedFileKey: string;
    fileKeyIv: string;
    fileIv: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }): Promise<MessageAttachment | null> {
    const ext = params.fileName.split('.').pop() ?? 'enc';
    const path = `conversations/${params.conversationId}/${crypto.randomUUID()}.${ext}.enc`;
    const { error: uploadErr } = await supabase.storage
      .from('chat-attachments')
      .upload(path, params.encryptedFile, { upsert: false });
    if (uploadErr) {
      console.error('Chat attachment upload failed:', uploadErr);
      return null;
    }
    const { data: row, error: insertErr } = await supabase
      .from('message_attachments')
      .insert({
        message_id: params.messageId,
        storage_path: path,
        encrypted_file_key: params.encryptedFileKey,
        file_key_iv: params.fileKeyIv,
        file_iv: params.fileIv,
        file_name: params.fileName,
        file_size: params.fileSize,
        mime_type: params.mimeType,
      })
      .select()
      .single();
    if (insertErr || !row) return null;
    return mapAttachmentRow(row as Record<string, unknown>);
  },

  async downloadAttachment(storagePath: string): Promise<Blob | null> {
    const { data, error } = await supabase.storage.from('chat-attachments').download(storagePath);
    if (error) {
      console.error('Chat attachment download failed:', error);
      return null;
    }
    return data;
  },
};
