/**
 * Date utility functions for consistent formatting across the app
 */

/**
 * Format date to readable string: "Jan 27, 2026"
 */
export const formatDate = (date: string | Date | null | undefined): string => {
  if (!date) return 'N/A';
  try {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return 'Invalid Date';
  }
};

/**
 * Format time to 12-hour format: "2:30 PM"
 */
export const formatTime = (date: string | Date | null | undefined): string => {
  if (!date) return 'N/A';
  try {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Invalid Time';
  }
};

/**
 * Format full date and time: "Jan 27, 2026 at 2:30 PM"
 */
export const formatDateTime = (date: string | Date | null | undefined): string => {
  if (!date) return 'N/A';
  try {
    const d = new Date(date);
    return `${formatDate(d)} at ${formatTime(d)}`;
  } catch {
    return 'Invalid Date/Time';
  }
};

/**
 * Calculate duration between two dates: "3h 45m"
 */
export const calculateDuration = (start: string | Date, end?: string | Date | null): string => {
  try {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const diff = endTime - startTime;

    if (diff < 0) return '0h 0m';

    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);

    return `${hours}h ${mins}m`;
  } catch {
    return '0h 0m';
  }
};

/**
 * Calculate decimal hours between two dates: 3.75
 */
export const calculateHoursDecimal = (start: string | Date, end?: string | Date | null): number => {
  try {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const diff = endTime - startTime;

    if (diff < 0) return 0;

    return parseFloat((diff / 3600000).toFixed(2));
  } catch {
    return 0;
  }
};

/**
 * Check if date is today
 */
export const isToday = (date: string | Date): boolean => {
  try {
    const d = new Date(date);
    const today = new Date();
    return (
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear()
    );
  } catch {
    return false;
  }
};

/**
 * Check if date is in the past
 */
export const isPast = (date: string | Date): boolean => {
  try {
    return new Date(date).getTime() < Date.now();
  } catch {
    return false;
  }
};

/**
 * Get relative time: "2 hours ago", "in 3 days"
 */
export const getRelativeTime = (date: string | Date): string => {
  try {
    const d = new Date(date);
    const now = Date.now();
    const diff = d.getTime() - now;
    const absDiff = Math.abs(diff);

    const seconds = Math.floor(absDiff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return diff > 0
        ? `in ${days} day${days !== 1 ? 's' : ''}`
        : `${days} day${days !== 1 ? 's' : ''} ago`;
    }
    if (hours > 0) {
      return diff > 0
        ? `in ${hours} hour${hours !== 1 ? 's' : ''}`
        : `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    }
    if (minutes > 0) {
      return diff > 0
        ? `in ${minutes} minute${minutes !== 1 ? 's' : ''}`
        : `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    }
    return 'just now';
  } catch {
    return 'unknown';
  }
};

/**
 * Format date for input field (YYYY-MM-DD)
 */
export const formatDateForInput = (date: string | Date | null | undefined): string => {
  if (!date) return '';
  try {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  } catch {
    return '';
  }
};

/**
 * Format a date-only value (ignoring time and timezone)
 */
export const formatDateOnly = (dateStr: string | null | undefined): string => {
  if (!dateStr) return 'N/A';

  try {
    const datePart =
      dateStr.includes('T') || dateStr.includes(' ')
        ? dateStr.split(/[T ]/)[0]
        : dateStr;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      console.warn('Invalid date format:', dateStr);
      return 'Invalid Date';
    }

    const [year, month, day] = datePart.split('-').map(Number);

    if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) {
      console.warn('Invalid date values:', { year, month, day });
      return 'Invalid Date';
    }

    const date = new Date(year, month - 1, day, 12, 0, 0);

    if (isNaN(date.getTime())) {
      console.warn('Date construction failed:', dateStr);
      return 'Invalid Date';
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch (error) {
    console.error('formatDateOnly error:', error, 'for date:', dateStr);
    return 'Invalid Date';
  }
};

/**
 * Convert a date from YYYY-MM-DD input to ISO string for PocketBase
 */
export const dateInputToISO = (dateStr: string | undefined): string | undefined => {
  if (!dateStr) return undefined;
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toISOString();
  } catch {
    return undefined;
  }
};

/**
 * Convert UTC ISO string from PocketBase to YYYY-MM-DD for input field
 */
export const isoToDateInput = (isoStr: string | undefined): string => {
  if (!isoStr) return '';
  try {
    const date = new Date(isoStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
};

/**
 * Get date range string: "Jan 1 - Jan 7, 2026"
 */
export const formatDateRange = (start: string | Date, end: string | Date): string => {
  try {
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (
      startDate.getFullYear() === endDate.getFullYear() &&
      startDate.getMonth() === endDate.getMonth()
    ) {
      return `${startDate.toLocaleDateString('en-US', { month: 'short' })} ${startDate.getDate()} - ${endDate.getDate()}, ${startDate.getFullYear()}`;
    }

    return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  } catch {
    return 'Invalid Range';
  }
};
