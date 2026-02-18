import React, { useState, useCallback } from 'react';

export interface AccordionProps {
  title: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  className?: string;
}

const Accordion: React.FC<AccordionProps> = ({
  title,
  defaultExpanded = false,
  children,
  className = '',
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggle = useCallback(() => setExpanded((e) => !e), []);

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
