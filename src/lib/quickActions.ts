/**
 * Compute the new full quick-action key order after a drag reorder.
 *
 * The dashboard only makes *visible* cards sortable, but the persisted order
 * (`quickActionOrder`) also contains hidden keys. Both `activeKey` and `overKey`
 * are visible cards, so moving `activeKey` to `overKey`'s position within the
 * full list keeps any interspersed hidden cards in their existing relative
 * slots. Mirrors @dnd-kit's `arrayMove` semantics (remove-then-insert).
 *
 * Returns the original array reference unchanged when the move is a no-op or
 * either key is missing, so callers can skip a redundant write.
 */
export function reorderQuickActionKeys(
  fullKeys: string[],
  activeKey: string,
  overKey: string
): string[] {
  if (activeKey === overKey) return fullKeys;
  const oldIndex = fullKeys.indexOf(activeKey);
  const newIndex = fullKeys.indexOf(overKey);
  if (oldIndex === -1 || newIndex === -1) return fullKeys;
  const next = fullKeys.slice();
  const [moved] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, moved);
  return next;
}
