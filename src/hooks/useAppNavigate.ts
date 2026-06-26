import { useCallback } from 'react';
import { useNavigate, type NavigateOptions } from 'react-router-dom';
import type { ViewState } from '@/core/types';

export function useAppNavigate() {
  const navigate = useNavigate();

  return useCallback(
    function appNavigate(
      view: ViewState,
      id?: string | { jobId?: string; partId?: string },
      opts?: NavigateOptions
    ) {
      const resolvedId =
        id === undefined ? undefined : typeof id === 'string' ? id : (id.jobId ?? id.partId);

      const requireId = (label: string): string | undefined => {
        if (!resolvedId) {
          if (import.meta.env.DEV) throw new Error(`useAppNavigate: '${label}' requires an id`);
          return undefined;
        }
        return resolvedId;
      };

      switch (view) {
        case 'dashboard':
          return navigate('/app', opts);
        case 'job-detail': {
          const jid = requireId('job-detail');
          if (!jid) return undefined;
          // Stamp the page we're leaving into the job's history entry so its back
          // button can return there even if the browser history index is later
          // lost (PWA cold start, reload). The caller's opts win if they pass state.
          return navigate(`/app/jobs/${jid}`, {
            state: { from: window.location.pathname + window.location.search },
            ...opts,
          });
        }
        case 'clock-in':
          return navigate('/app/clock-in', opts);
        case 'scanner':
          return navigate('/app/scanner', opts);
        case 'inventory':
          return navigate('/app/inventory', opts);
        case 'inventory-detail': {
          const iid = requireId('inventory-detail');
          return iid ? navigate(`/app/inventory/${iid}`, opts) : undefined;
        }
        case 'board-shop':
          return navigate('/app/board/shop', opts);
        case 'board-admin':
          return navigate('/app/board/admin', opts);
        case 'boards':
          return navigate('/app/boards', opts);
        case 'board-detail': {
          const bid = requireId('board-detail');
          return bid ? navigate(`/app/boards/${bid}`, opts) : undefined;
        }
        case 'board-card-detail': {
          const parts = (resolvedId ?? '').split(':');
          const boardId = parts[0];
          const cardId = parts[1];
          if (!boardId || !cardId) {
            if (import.meta.env.DEV)
              throw new Error('useAppNavigate: board-card-detail requires "boardId:cardId"');
            return navigate('/app/boards', opts);
          }
          return navigate(`/app/boards/${boardId}/cards/${cardId}`, opts);
        }
        case 'parts':
          return navigate('/app/parts', opts);
        case 'part-detail': {
          const pid = requireId('part-detail');
          return pid ? navigate(`/app/parts/${pid}`, opts) : undefined;
        }
        case 'create-job':
          return navigate('/app/jobs/new', opts);
        case 'quotes':
          return navigate('/app/quotes', opts);
        case 'time-reports':
          return navigate(
            resolvedId ? `/app/time-reports?job=${resolvedId}` : '/app/time-reports',
            opts
          );
        case 'calendar':
          return navigate('/app/calendar', opts);
        case 'admin-settings':
          return navigate('/app/settings', opts);
        case 'trello-import':
          return navigate('/app/import', opts);
        case 'chat':
          return navigate('/app/chat', opts);
        case 'chat-conversation': {
          const cid = requireId('chat-conversation');
          return cid ? navigate(`/app/chat/${cid}`, opts) : undefined;
        }
        case 'notification-settings':
          return navigate('/app/notifications/settings', opts);
        case 'appearance':
          return navigate('/app/appearance', opts);
        case 'project-hours':
          return navigate('/app/project-hours', opts);
        case 'tools':
          return navigate(resolvedId ? `/app/tools/${resolvedId}` : '/app/tools', opts);
      }
    },
    [navigate]
  );
}
