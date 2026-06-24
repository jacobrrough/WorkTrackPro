interface MachineCompletionBadgeProps {
  type: 'cnc' | 'printer3d';
  completedAt?: string | null;
}

export function MachineCompletionBadge({ type, completedAt }: MachineCompletionBadgeProps) {
  const label = type === 'cnc' ? 'CNC' : '3D Print';
  const isDone = !!completedAt;

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label} Status</p>
      <p className={`text-sm font-semibold ${isDone ? 'text-green-300' : 'text-amber-300'}`}>
        {isDone ? `${label} Done` : `${label} Pending`}
      </p>
      {completedAt && (
        <p className="text-[10px] text-muted">
          Marked {new Date(completedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
