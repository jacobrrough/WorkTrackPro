import type {
  Attachment,
  Board,
  BoardColumn,
  BoardCard,
  BoardMember,
  BoardVisibility,
  BoardMemberRole,
} from '../../core/types';
import { supabase } from './supabaseClient';
import {
  deleteAttachmentRecord,
  getAttachmentPublicUrl,
  uploadAttachment,
} from './storage';

function mapBoardRow(row: Record<string, unknown>, columns: BoardColumn[] = []): Board {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? undefined,
    createdBy: row.created_by as string,
    visibility: (row.visibility as BoardVisibility) ?? 'private',
    columns,
    memberCount: row.member_count != null ? Number(row.member_count) : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapColumnRow(row: Record<string, unknown>): BoardColumn {
  return {
    id: row.id as string,
    boardId: row.board_id as string,
    name: row.name as string,
    color: (row.color as string) ?? undefined,
    sortOrder: (row.sort_order as number) ?? 0,
  };
}

function mapCardRow(row: Record<string, unknown>): BoardCard {
  return {
    id: row.id as string,
    boardId: row.board_id as string,
    columnId: row.column_id as string,
    title: row.title as string,
    description: (row.description as string) ?? undefined,
    assigneeId: (row.assignee_id as string) ?? undefined,
    assigneeName: (row.assignee_name as string) ?? undefined,
    dueDate: (row.due_date as string) ?? undefined,
    color: (row.color as string) ?? undefined,
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: row.created_at as string,
  };
}

function mapAttachmentRow(row: Record<string, unknown>): Attachment {
  const storagePath = (row.storage_path as string) ?? '';
  return {
    id: row.id as string,
    boardCardId: (row.board_card_id as string) ?? undefined,
    filename: (row.filename as string) ?? '',
    storagePath,
    isAdminOnly: (row.is_admin_only as boolean) ?? false,
    url: storagePath ? getAttachmentPublicUrl(storagePath) : undefined,
    created: (row.created_at as string) ?? undefined,
  };
}

function mapMemberRow(row: Record<string, unknown>): BoardMember {
  return {
    id: row.id as string,
    boardId: row.board_id as string,
    userId: row.user_id as string,
    userName: (row.user_name as string) ?? undefined,
    userEmail: (row.user_email as string) ?? undefined,
    role: (row.role as BoardMemberRole) ?? 'editor',
  };
}

const DEFAULT_COLUMNS = [
  { name: 'To Do', color: 'bg-pink-500', sort_order: 0 },
  { name: 'In Progress', color: 'bg-blue-500', sort_order: 1 },
  { name: 'Done', color: 'bg-green-500', sort_order: 2 },
];

export const boardService = {
  // ── Boards ──────────────────────────────────────────────

  async getBoards(_userId: string): Promise<Board[]> {
    const { data, error } = await supabase
      .from('boards')
      .select('*, board_members(count)')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('boardService.getBoards failed:', error.message);
      return [];
    }
    return (data ?? []).map((row: Record<string, unknown>) => {
      const memberArr = row.board_members as { count: number }[] | undefined;
      const memberCount = memberArr?.[0]?.count ?? 0;
      return mapBoardRow({ ...row, member_count: memberCount });
    });
  },

  async getBoardById(
    boardId: string
  ): Promise<{ board: Board; cards: BoardCard[]; members: BoardMember[] } | null> {
    const { data: boardRow, error: boardErr } = await supabase
      .from('boards')
      .select('*')
      .eq('id', boardId)
      .single();
    if (boardErr || !boardRow) return null;

    const [colRes, cardRes, memRes] = await Promise.all([
      supabase.from('board_columns').select('*').eq('board_id', boardId).order('sort_order'),
      supabase
        .from('board_cards')
        .select('*, profiles!board_cards_assignee_id_fkey(name)')
        .eq('board_id', boardId)
        .order('sort_order'),
      supabase
        .from('board_members')
        .select('*, profiles!board_members_user_id_fkey(name, email)')
        .eq('board_id', boardId),
    ]);

    const columns = (colRes.data ?? []).map((r: Record<string, unknown>) => mapColumnRow(r));
    const cards = (cardRes.data ?? []).map((r: Record<string, unknown>) => {
      const profile = r.profiles as { name?: string } | null;
      return mapCardRow({ ...r, assignee_name: profile?.name });
    });
    const members = (memRes.data ?? []).map((r: Record<string, unknown>) => {
      const profile = r.profiles as { name?: string; email?: string } | null;
      return mapMemberRow({ ...r, user_name: profile?.name, user_email: profile?.email });
    });

    // Fetch attachments for these cards in a single query and group by card.
    const cardIds = cards.map((c) => c.id);
    if (cardIds.length > 0) {
      const { data: attRows } = await supabase
        .from('attachments')
        .select('*')
        .in('board_card_id', cardIds);
      const byCard = new Map<string, Attachment[]>();
      for (const row of attRows ?? []) {
        const att = mapAttachmentRow(row as Record<string, unknown>);
        if (!att.boardCardId) continue;
        const list = byCard.get(att.boardCardId) ?? [];
        list.push(att);
        byCard.set(att.boardCardId, list);
      }
      for (const card of cards) {
        const list = byCard.get(card.id) ?? [];
        card.attachments = list;
        card.attachmentCount = list.length;
      }
    }

    const board = mapBoardRow(boardRow as Record<string, unknown>, columns);
    board.memberCount = members.length;
    return { board, cards, members };
  },

  async addCardAttachment(cardId: string, file: File): Promise<Attachment | null> {
    const result = await uploadAttachment(undefined, undefined, undefined, file, false, undefined, cardId);
    if (result.id == null) return null;
    const { data: row } = await supabase
      .from('attachments')
      .select('*')
      .eq('id', result.id)
      .single();
    return row ? mapAttachmentRow(row as Record<string, unknown>) : null;
  },

  async deleteCardAttachment(attachmentId: string): Promise<boolean> {
    return deleteAttachmentRecord(attachmentId);
  },

  async createBoard(data: {
    name: string;
    description?: string;
    createdBy: string;
    visibility: BoardVisibility;
  }): Promise<Board | null> {
    const { data: row, error } = await supabase
      .from('boards')
      .insert({
        name: data.name,
        description: data.description ?? null,
        created_by: data.createdBy,
        visibility: data.visibility,
      })
      .select()
      .single();
    if (error || !row) {
      console.error('boardService.createBoard failed:', error?.message);
      return null;
    }

    const boardId = (row as Record<string, unknown>).id as string;
    const colRows = DEFAULT_COLUMNS.map((c) => ({ board_id: boardId, ...c }));
    const { data: cols } = await supabase.from('board_columns').insert(colRows).select();
    const columns = (cols ?? []).map((c: Record<string, unknown>) => mapColumnRow(c));

    return mapBoardRow(row as Record<string, unknown>, columns);
  },

  async updateBoard(
    boardId: string,
    data: { name?: string; description?: string; visibility?: BoardVisibility }
  ): Promise<Board | null> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.visibility !== undefined) updates.visibility = data.visibility;

    const { data: row, error } = await supabase
      .from('boards')
      .update(updates)
      .eq('id', boardId)
      .select()
      .single();
    if (error || !row) return null;
    return mapBoardRow(row as Record<string, unknown>);
  },

  async deleteBoard(boardId: string): Promise<boolean> {
    const { error } = await supabase.from('boards').delete().eq('id', boardId);
    return !error;
  },

  // ── Columns ─────────────────────────────────────────────

  async addColumn(
    boardId: string,
    data: { name: string; color?: string; sortOrder: number }
  ): Promise<BoardColumn | null> {
    const { data: row, error } = await supabase
      .from('board_columns')
      .insert({
        board_id: boardId,
        name: data.name,
        color: data.color ?? null,
        sort_order: data.sortOrder,
      })
      .select()
      .single();
    if (error || !row) return null;
    return mapColumnRow(row as Record<string, unknown>);
  },

  async updateColumn(
    columnId: string,
    data: { name?: string; color?: string }
  ): Promise<BoardColumn | null> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.color !== undefined) updates.color = data.color;

    const { data: row, error } = await supabase
      .from('board_columns')
      .update(updates)
      .eq('id', columnId)
      .select()
      .single();
    if (error || !row) return null;
    return mapColumnRow(row as Record<string, unknown>);
  },

  async deleteColumn(columnId: string): Promise<boolean> {
    const { error } = await supabase.from('board_columns').delete().eq('id', columnId);
    return !error;
  },

  async reorderColumns(boardId: string, columnIds: string[]): Promise<boolean> {
    const updates = columnIds.map((id, i) =>
      supabase.from('board_columns').update({ sort_order: i }).eq('id', id).eq('board_id', boardId)
    );
    const results = await Promise.all(updates);
    return results.every((r) => !r.error);
  },

  // ── Cards ───────────────────────────────────────────────

  async addCard(data: {
    boardId: string;
    columnId: string;
    title: string;
    description?: string;
    assigneeId?: string;
    dueDate?: string;
    color?: string;
    sortOrder: number;
  }): Promise<BoardCard | null> {
    const { data: row, error } = await supabase
      .from('board_cards')
      .insert({
        board_id: data.boardId,
        column_id: data.columnId,
        title: data.title,
        description: data.description ?? null,
        assignee_id: data.assigneeId ?? null,
        due_date: data.dueDate ?? null,
        color: data.color ?? null,
        sort_order: data.sortOrder,
      })
      .select()
      .single();
    if (error || !row) return null;
    return mapCardRow(row as Record<string, unknown>);
  },

  async updateCard(
    cardId: string,
    data: {
      title?: string;
      description?: string;
      assigneeId?: string | null;
      dueDate?: string | null;
      color?: string | null;
    }
  ): Promise<BoardCard | null> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.title !== undefined) updates.title = data.title;
    if (data.description !== undefined) updates.description = data.description;
    if (data.assigneeId !== undefined) updates.assignee_id = data.assigneeId;
    if (data.dueDate !== undefined) updates.due_date = data.dueDate;
    if (data.color !== undefined) updates.color = data.color;

    const { data: row, error } = await supabase
      .from('board_cards')
      .update(updates)
      .eq('id', cardId)
      .select()
      .single();
    if (error || !row) return null;
    return mapCardRow(row as Record<string, unknown>);
  },

  async moveCard(
    cardId: string,
    data: { columnId: string; sortOrder: number }
  ): Promise<BoardCard | null> {
    const { data: row, error } = await supabase
      .from('board_cards')
      .update({ column_id: data.columnId, sort_order: data.sortOrder })
      .eq('id', cardId)
      .select()
      .single();
    if (error || !row) return null;
    return mapCardRow(row as Record<string, unknown>);
  },

  async deleteCard(cardId: string): Promise<boolean> {
    const { error } = await supabase.from('board_cards').delete().eq('id', cardId);
    return !error;
  },

  // ── Members ─────────────────────────────────────────────

  async addMember(
    boardId: string,
    userId: string,
    role: BoardMemberRole = 'editor'
  ): Promise<BoardMember | null> {
    const { data: row, error } = await supabase
      .from('board_members')
      .insert({ board_id: boardId, user_id: userId, role })
      .select('*, profiles!board_members_user_id_fkey(name, email)')
      .single();
    if (error || !row) return null;
    const profile = (row as Record<string, unknown>).profiles as {
      name?: string;
      email?: string;
    } | null;
    return mapMemberRow({
      ...(row as Record<string, unknown>),
      user_name: profile?.name,
      user_email: profile?.email,
    });
  },

  async removeMember(boardId: string, userId: string): Promise<boolean> {
    const { error } = await supabase
      .from('board_members')
      .delete()
      .eq('board_id', boardId)
      .eq('user_id', userId);
    return !error;
  },

  async updateMemberRole(memberId: string, role: BoardMemberRole): Promise<boolean> {
    const { error } = await supabase.from('board_members').update({ role }).eq('id', memberId);
    return !error;
  },
};
