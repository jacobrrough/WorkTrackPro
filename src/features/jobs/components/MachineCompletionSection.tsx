import { MachineCompletionBadge } from './MachineCompletionBadge';

interface MachineCompletionSectionProps {
  type: 'cnc' | 'printer3d';
  completedAt?: string | null;
  onToggle: () => void;
  canToggle: boolean;
  label?: string;
}

export function MachineCompletionSection({
  type,
  completedAt,
  onToggle,
  canToggle,
}: MachineCompletionSectionProps) {
  return (
    <div className="mb-3 rounded-sm border border-primary/30 bg-primary/10 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <MachineCompletionBadge type={type} completedAt={completedAt} />

        {canToggle && (
          <button
            type="button"
            onClick={onToggle}
            className={`h-11 touch-manipulation rounded-sm border px-3 text-xs font-semibold ${
              completedAt
                ? 'border-green-500/40 bg-green-500/20 text-green-200'
                : 'border-amber-500/40 bg-amber-500/20 text-amber-200'
            }`}
          >
            {completedAt ? 'Mark Pending' : 'Mark Done'}
          </button>
        )}
      </div>
    </div>
  );
}
