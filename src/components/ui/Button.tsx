import React, { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  icon?: string;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  children,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  className = '',
  disabled,
  ...props
}) => {
  const variantClasses = {
    primary:
      'bg-primary text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed',
    secondary:
      'bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed',
    ghost:
      'bg-transparent text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed',
    danger:
      'bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed',
  };

  const sizeClasses = {
    sm: 'px-2.5 py-1 text-sm min-h-[36px]',
    md: 'px-3 py-1.5 text-base min-h-[40px]',
    lg: 'px-4 py-2 text-lg min-h-[44px]',
  };

  const iconSizeClasses = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl',
  };

  const baseClasses =
    'font-bold rounded-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background-dark';

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon && iconPosition === 'left' && (
        <span className={`material-symbols-outlined ${iconSizeClasses[size]}`}>{icon}</span>
      )}
      {children}
      {icon && iconPosition === 'right' && (
        <span className={`material-symbols-outlined ${iconSizeClasses[size]}`}>{icon}</span>
      )}
    </button>
  );
};
