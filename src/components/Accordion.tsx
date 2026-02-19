import React, { useState, useCallback } from 'react';

export interface AccordionProps {
  title: string;
  defaultExpanded?: boolean;
  /** When provided with onToggle, controls expanded state from parent (keeps state across parent re-renders). */
  expanded?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
  className?: string;
}

const Accordion: React.FC<AccordionProps> = ({
  title,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onToggle,
  children,
  className = '',
}) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isControlled = controlledExpanded !== undefined && onToggle != null;
  const expanded = isControlled ? controlledExpanded : internalExpanded;
  const toggle = useCallback(
    () => (isControlled ? onToggle() : setInternalExpanded((e) => !e)),
    [isControlled, onToggle]
  );

  return (
    <div
      className={`rounded-sm border border-white/10 bg-white/5 overflow-hidden ${className}`}
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 active:bg-white/10"
        aria-expanded={expanded}
      >
        <span className="text-sm font-semibold text-white">{title}</span>
        <span
          className={`material-symbols-outlined text-slate-400 transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
          aria-hidden
        >
          expand_more
        </span>
      </button>
      {expanded && (
        <div className="border-t border-white/10 px-4 py-4">
          {children}
        </div>
      )}
    </div>
  );
};

export default Accordion;
