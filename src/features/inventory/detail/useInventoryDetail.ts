import { useState, useEffect, useCallback } from 'react';
import type { InventoryItem, InventoryHistoryEntry } from '@/core/types';
import { inventoryService } from '@/services/api/inventory';
import { inventoryHistoryService } from '@/services/api/inventoryHistory';

export function useInventoryDetail(item: InventoryItem) {
  const [currentItem, setCurrentItem] = useState<InventoryItem>(item);
  const [history, setHistory] = useState<InventoryHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    setCurrentItem(item);
  }, [item]);

  const loadItemWithAttachments = useCallback(async () => {
    try {
      const withAtt = await inventoryService.getInventoryWithAttachments(currentItem.id);
      if (withAtt) setCurrentItem(withAtt);
    } catch (error) {
      console.error('Failed to load item with attachments:', error);
    }
  }, [currentItem.id]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await inventoryHistoryService.getHistory(currentItem.id);
      setHistory(data);
    } catch (error) {
      console.error('Failed to load history:', error);
    }
    setLoadingHistory(false);
  }, [currentItem.id]);

  return {
    currentItem,
    setCurrentItem,
    history,
    loadingHistory,
    loadHistory,
    loadItemWithAttachments,
  };
}
