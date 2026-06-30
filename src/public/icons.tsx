import React from 'react';

/**
 * Shared inline SVG icons for the public surface (and the Direction-E login).
 * Stroke-based, theme via `currentColor`. Replaces Material Symbols on every
 * public-facing surface and de-duplicates the per-file inline SVGs.
 */
type IconProps = { size?: number; className?: string };

const svg = (size: number, className: string | undefined, children: React.ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    {children}
  </svg>
);

export const CloseIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <path d="M18 6 6 18M6 6l12 12" />);

export const MinusIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <path d="M5 12h14" />);

export const PlusIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <path d="M12 5v14M5 12h14" />);

export const MailIcon = ({ size = 20, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </>
  );

export const LockIcon = ({ size = 20, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  );

export const UserIcon = ({ size = 20, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  );

export const ArrowRightIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <path d="M5 12h14M13 5l7 7-7 7" />);

export const ArrowLeftIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <path d="M19 12H5M12 19l-7-7 7-7" />);

export const SupportIcon = ({ size = 20, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  );
