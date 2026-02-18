import React, { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  padding = 'md',
  onClick,
}) => {
  const paddingClasses = {
    none: '',
    sm: 'p-1.5',
    md: 'p-3',
    lg: 'p-4',
  };

  const baseClasses = 'bg-card-dark rounded-sm border border-white/10 shadow';
  const interactiveClasses = onClick
    ? 'cursor-pointer hover:border-primary/30 transition-colors active:scale-[0.98]'
    : '';

  return (
    <div
      className={`${baseClasses} ${paddingClasses[padding]} ${interactiveClasses} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  );
};
