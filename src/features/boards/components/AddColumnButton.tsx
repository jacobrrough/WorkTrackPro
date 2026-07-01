import React, { useState } from 'react';

interface AddColumnButtonProps {
  onAdd: (name: string) => void;
}

const AddColumnButton: React.FC<AddColumnButtonProps> = ({ onAdd }) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed) {
      onAdd(trimmed);
      setName('');
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex w-60 flex-shrink-0 flex-col gap-2 rounded-lg border border-line bg-surface-dark p-3">
        <input
          autoFocus
          className="w-full rounded border border-line bg-white/5 px-2 py-1.5 text-sm text-white placeholder-subtle focus:border-primary focus:outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          placeholder="Column name"
          maxLength={40}
        />
        <div className="flex gap-2">
          <button
            onClick={commit}
            disabled={!name.trim()}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-on-accent disabled:opacity-50"
          >
            Add
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded px-3 py-1 text-xs text-muted hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="flex h-10 w-60 flex-shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-sm text-muted transition-colors hover:border-line-strong hover:text-white"
    >
      <span className="material-symbols-outlined text-base">add</span>
      Add column
    </button>
  );
};

export default AddColumnButton;
