import { useApp } from '../AppContext';

/**
 * Small "pending sync" chip shown on a row/card whose change is sitting in the offline
 * action queue (saved on-device, not yet applied server-side). Renders nothing when the
 * entity has no queued action. Drives off AppContext.pendingEntityIds so it updates as
 * soon as an action is enqueued or drained.
 */
export function PendingSyncBadge({
  entityId,
  className = '',
}: {
  entityId: string;
  className?: string;
}) {
  const { pendingEntityIds } = useApp();
  if (!pendingEntityIds.has(entityId)) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 ${className}`}
      title="Saved on this device — will sync when reconnected"
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[12px] leading-none">
        sync
      </span>
      Pending
    </span>
  );
}
