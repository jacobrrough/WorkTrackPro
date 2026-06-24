interface ComingSoonProps {
  icon: string;
  title: string;
  note: string;
}

/** Placeholder for module sections whose UI lands in a later phase (the DB schema
 *  and services already exist). */
export function ComingSoon({ icon, title, note }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
      <span className="material-symbols-outlined text-4xl text-subtle">{icon}</span>
      <p className="text-lg font-bold text-white">{title}</p>
      <p className="max-w-sm text-sm text-muted">{note}</p>
      <span className="rounded-sm bg-white/5 px-2 py-1 text-xs font-semibold text-subtle">
        Coming soon
      </span>
    </div>
  );
}
