import { useQuery } from '@tanstack/react-query';
import { boardService } from '@/services/api/boards';

export function useBoardList(userId: string | undefined) {
  return useQuery({
    queryKey: ['boards'],
    queryFn: () => boardService.getBoards(userId!),
    enabled: !!userId,
  });
}

export function useBoardDetail(boardId: string | null) {
  return useQuery({
    queryKey: ['board', boardId],
    queryFn: () => boardService.getBoardById(boardId!),
    enabled: !!boardId,
  });
}
