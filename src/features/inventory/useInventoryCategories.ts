import { useMemo } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import {
  getCategoryDisplayName,
  mergeInventoryCategories,
  type InventoryCategoryOption,
} from '@/core/types';

export interface UseInventoryCategoriesResult {
  /** Built-in categories first, then admin-defined custom ones (deduped by key). */
  options: InventoryCategoryOption[];
  /** Display label for any key — custom label if known, else built-in/humanized fallback. */
  getLabel: (key: string) => string;
}

/**
 * Single source of truth for the inventory category pickers/filters: the 7 built-in categories
 * merged with the admin-defined custom ones from organization settings. Custom entries can never
 * shadow a built-in key. `getLabel` resolves any key — including one whose custom category was
 * since removed — to a readable label.
 */
export function useInventoryCategories(): UseInventoryCategoriesResult {
  const { settings } = useSettings();
  const custom = settings.customInventoryCategories;

  return useMemo(() => {
    const options = mergeInventoryCategories(custom);
    const labelByKey = new Map(options.map((c) => [c.key, c.label]));
    const getLabel = (key: string) => labelByKey.get(key) ?? getCategoryDisplayName(key);
    return { options, getLabel };
  }, [custom]);
}
