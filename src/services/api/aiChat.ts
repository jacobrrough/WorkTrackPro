import { supabase } from './supabaseClient';

export interface AIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIChatResponse {
  ok: boolean;
  reply?: string;
  error?: string;
}

export const aiChatService = {
  async sendMessage(messages: AIChatMessage[]): Promise<AIChatResponse> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { ok: false, error: 'Not authenticated' };
    }

    const response = await fetch('/api/ai-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ messages }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Request failed' }));
      const detail = body.detail ? ` (${body.detail})` : '';
      return { ok: false, error: (body.error || `HTTP ${response.status}`) + detail };
    }

    const data = await response.json();
    return { ok: true, reply: data.reply };
  },
};
