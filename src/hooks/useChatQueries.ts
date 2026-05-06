import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { chatService } from '@/services/api/chat';

export function useChatConversations(enabled: boolean) {
  return useQuery({
    queryKey: ['chat', 'conversations'],
    queryFn: () => chatService.getConversations(),
    enabled,
    staleTime: 30_000,
  });
}

export function useChatMessages(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: ['chat', 'messages', conversationId],
    queryFn: async ({ pageParam }) => {
      if (!conversationId) return [];
      return chatService.getMessages(conversationId, {
        limit: 50,
        before: pageParam as string | undefined,
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage || lastPage.length < 50) return undefined;
      return lastPage[lastPage.length - 1]?.createdAt;
    },
    enabled: !!conversationId,
    staleTime: 30_000,
  });
}

export function useConversationMembers(conversationId: string | null) {
  return useQuery({
    queryKey: ['chat', 'members', conversationId],
    queryFn: () => chatService.getConversationMembers(conversationId!),
    enabled: !!conversationId,
    staleTime: 60_000,
  });
}

export function useConversationWithMembers(conversationId: string | null) {
  return useQuery({
    queryKey: ['chat', 'conversation', conversationId],
    queryFn: () => chatService.getConversationWithMembers(conversationId!),
    enabled: !!conversationId,
    staleTime: 60_000,
  });
}
