/**
 * Validation utility functions
 */

/**
 * Validate job code (1-999999)
 */
export const validateJobCode = (code: number): string | null => {
  if (isNaN(code)) return 'Job code must be a number';
  if (code < 1) return 'Job code must be positive';
  if (code > 999999) return 'Job code too large (max 999999)';
  return null;
};

/**
 * Validate email address
 */
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate password strength
 */
export const validatePassword = (
  password: string
): {
  isValid: boolean;
  message: string;
} => {
  if (password.length < 8) {
    return { isValid: false, message: 'Password must be at least 8 characters' };
  }
  if (!/[A-Z]/.test(password)) {
    return { isValid: false, message: 'Password must contain uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { isValid: false, message: 'Password must contain lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { isValid: false, message: 'Password must contain a number' };
  }
  return { isValid: true, message: 'Password is strong' };
};

/**
 * Sanitize text input (remove dangerous characters)
 */
export const sanitizeInput = (input: string): string => {
  return (
    input
      .replace(/[<>]/g, '') // Remove HTML tags
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/g, '') // Remove control characters
      .trim()
  );
};

/**
 * Validate phone number (US format)
 */
export const validatePhoneNumber = (phone: string): boolean => {
  const phoneRegex = /^[\d\s\-()]+$/;
  const digits = phone.replace(/\D/g, '');
  return phoneRegex.test(phone) && digits.length === 10;
};

/**
 * Validate URL
 */
export const validateUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

/**
 * Validate number range
 */
export const validateNumberRange = (value: number, min: number, max: number): string | null => {
  if (isNaN(value)) return 'Must be a number';
  if (value < min) return `Must be at least ${min}`;
  if (value > max) return `Must be at most ${max}`;
  return null;
};

/**
 * Validate required field
 */
export const validateRequired = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') {
    return 'This field is required';
  }
  if (typeof value === 'string' && value.trim() === '') {
    return 'This field is required';
  }
  return null;
};

/**
 * Validate string length
 */
export const validateLength = (value: string, min?: number, max?: number): string | null => {
  if (min !== undefined && value.length < min) {
    return `Must be at least ${min} characters`;
  }
  if (max !== undefined && value.length > max) {
    return `Must be at most ${max} characters`;
  }
  return null;
};

/**
 * Validate inventory quantity (must be >= 0)
 */
export const validateQuantity = (quantity: number): string | null => {
  if (isNaN(quantity)) return 'Quantity must be a number';
  if (quantity < 0) return 'Quantity cannot be negative';
  if (!Number.isInteger(quantity)) return 'Quantity must be a whole number';
  return null;
};

/**
 * Validate price (must be >= 0, max 2 decimal places)
 */
export const validatePrice = (price: number): string | null => {
  if (isNaN(price)) return 'Price must be a number';
  if (price < 0) return 'Price cannot be negative';
  if (price > 999999) return 'Price too large';
  const decimals = (price.toString().split('.')[1] || '').length;
  if (decimals > 2) return 'Price can have at most 2 decimal places';
  return null;
};

/**
 * Validate date (must be valid date string)
 */
export const validateDate = (date: string): string | null => {
  if (!date) return null; // Allow empty dates
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'Invalid date';
    return null;
  } catch {
    return 'Invalid date';
  }
};

/**
 * Validate date is in the future
 */
export const validateFutureDate = (date: string): string | null => {
  const dateError = validateDate(date);
  if (dateError) return dateError;

  try {
    if (new Date(date).getTime() < Date.now()) {
      return 'Date must be in the future';
    }
    return null;
  } catch {
    return 'Invalid date';
  }
};

/**
 * Validate barcode format (alphanumeric, 8-13 characters)
 */
export const validateBarcode = (barcode: string): string | null => {
  if (!barcode) return null; // Barcode is optional
  if (!/^[A-Z0-9]+$/i.test(barcode)) {
    return 'Barcode must be alphanumeric';
  }
  if (barcode.length < 8 || barcode.length > 13) {
    return 'Barcode must be 8-13 characters';
  }
  return null;
};

/**
 * Validate bin location format (letter-number-letter, e.g., A4c)
 */
export const validateBinLocation = (location: string): string | null => {
  if (!location) return null; // Bin location is optional

  // Format: Letter (uppercase) + Number + Letter (lowercase)
  // Example: A4c = Rack A, Shelf 4, Section c
  const binLocationRegex = /^[A-Z]\d+[a-z]$/;

  if (!binLocationRegex.test(location)) {
    return 'Bin location must be in format: Letter-Number-letter (e.g., A4c)';
  }

  // Extract components for additional validation
  const rack = location.charAt(0);
  const shelfMatch = location.match(/\d+/);
  const section = location.charAt(location.length - 1);

  if (!shelfMatch) {
    return 'Invalid shelf number';
  }

  const shelf = parseInt(shelfMatch[0]);

  // Validate ranges (adjust these as needed for your warehouse)
  if (rack < 'A' || rack > 'Z') {
    return 'Rack must be A-Z';
  }

  if (shelf < 1 || shelf > 99) {
    return 'Shelf number must be 1-99';
  }

  if (section < 'a' || section > 'z') {
    return 'Section must be a-z';
  }

  return null;
};

/**
 * Parse bin location into components
 */
export const parseBinLocation = (
  location: string
): {
  rack: string;
  shelf: number;
  section: string;
} | null => {
  if (validateBinLocation(location) !== null) {
    return null;
  }

  const rack = location.charAt(0);
  const shelfMatch = location.match(/\d+/);
  const section = location.charAt(location.length - 1);

  if (!shelfMatch) return null;

  return {
    rack,
    shelf: parseInt(shelfMatch[0]),
    section,
  };
};

/**
 * Format bin location for display
 */
export const formatBinLocation = (location: string): string => {
  const parsed = parseBinLocation(location);
  if (!parsed) return location;

  return `Rack ${parsed.rack}, Shelf ${parsed.shelf}, Section ${parsed.section}`;
};

/**
 * Combine multiple validation results
 */
export const combineValidations = (...errors: (string | null)[]): string | null => {
  const filtered = errors.filter((e) => e !== null);
  return filtered.length > 0 ? filtered[0] : null;
};
