import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Item } from '../types';

/**
 * The line editor's "Product/service" dropdown lists Products & Services items + a single
 * "Part" option (NOT every part); choosing "Part" reveals the Description-cell part picker,
 * and choosing an item seeds the line's income account. We mock the data layer so these
 * interactions run without Supabase: useItems → itemsService.getAll, usePartLineResolver →
 * inventory + org settings (fired on mount), and the part picker → partsService.getAllParts.
 */
const ITEMS: Item[] = [
  {
    id: 'i-del',
    name: 'Delivery',
    sku: null,
    itemType: 'service',
    incomeAccountId: 'a-4700',
    expenseAccountId: null,
    inventoryAssetAccountId: null,
    defaultTaxCodeId: null,
    salesPrice: 50,
    purchaseCost: null,
    isActive: true,
    sourceInventoryId: null,
    sourcePartId: null,
    externalQboId: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'i-mat',
    name: 'Material',
    sku: null,
    itemType: 'non_inventory',
    incomeAccountId: 'a-4660',
    expenseAccountId: null,
    inventoryAssetAccountId: null,
    defaultTaxCodeId: null,
    salesPrice: null,
    purchaseCost: null,
    isActive: true,
    sourceInventoryId: null,
    sourcePartId: null,
    externalQboId: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
];

vi.mock('@/services/api/accounting', () => ({
  itemsService: { getAll: () => Promise.resolve(ITEMS) },
}));
vi.mock('@/services/api/inventory', () => ({
  inventoryService: { getAllInventory: () => Promise.resolve([]) },
}));
vi.mock('@/services/api/adminSettings', () => ({
  adminSettingsService: { getOrganizationSettings: () => Promise.resolve({}) },
}));
vi.mock('@/services/api/parts', () => ({
  partsService: {
    getAllParts: () => Promise.resolve([{ id: 'p-1', partNumber: 'PN-1', name: 'Widget' }]),
    // resolve() calls this on part-pick; returning null short-circuits pricing (partId still set).
    getPartWithVariants: () => Promise.resolve(null),
  },
}));

// Import AFTER the mocks are registered.
import SalesLineItemsEditor, { type EditorLine } from './SalesLineItemsEditor';

let latest: EditorLine[] = [];

function Harness({ initial }: { initial: EditorLine[] }) {
  const [lines, setLines] = useState<EditorLine[]>(initial);
  latest = lines;
  return <SalesLineItemsEditor lines={lines} onChange={setLines} />;
}

function renderEditor(initial: EditorLine[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness initial={initial} />
    </QueryClientProvider>
  );
}

const blankLine = (): EditorLine => ({
  description: '',
  quantity: 1,
  unitPrice: 0,
  discount: 0,
  taxable: true,
});

describe('SalesLineItemsEditor product/service dropdown', () => {
  beforeEach(() => {
    latest = [];
  });

  it('lists item options + "Part" + "Custom", but not individual parts', async () => {
    renderEditor([blankLine()]);
    const select = (await screen.findByLabelText('Product or service')) as HTMLSelectElement;
    await waitFor(() => within(select).getByRole('option', { name: 'Delivery' }));

    expect(within(select).getByRole('option', { name: 'Custom / other' })).toBeTruthy();
    expect(within(select).getByRole('option', { name: 'Part' })).toBeTruthy();
    expect(within(select).getByRole('option', { name: 'Material' })).toBeTruthy();
    // The type dropdown must NOT enumerate parts — that's chosen in the Description cell.
    expect(within(select).queryByRole('option', { name: /PN-1/ })).toBeNull();
  });

  it('seeds the income account + price when an item is picked', async () => {
    renderEditor([blankLine()]);
    const select = await screen.findByLabelText('Product or service');
    await waitFor(() => within(select).getByRole('option', { name: 'Delivery' }));

    fireEvent.change(select, { target: { value: 'item:i-del' } });

    await waitFor(() => expect(latest[0].itemId).toBe('i-del'));
    expect(latest[0].incomeAccountId).toBe('a-4700');
    expect(latest[0].unitPrice).toBe(50);
    expect(latest[0].description).toBe('Delivery');
    expect(latest[0].partId ?? null).toBeNull();
  });

  it('reveals the part picker and links the part when "Part" is chosen', async () => {
    renderEditor([blankLine()]);
    const select = await screen.findByLabelText('Product or service');
    await waitFor(() => within(select).getByRole('option', { name: 'Part' }));

    // No part picker until the line is switched to part mode.
    expect(screen.queryByLabelText('Part')).toBeNull();

    fireEvent.change(select, { target: { value: 'part' } });

    const partSelect = await screen.findByLabelText('Part');
    await waitFor(() => within(partSelect).getByRole('option', { name: /PN-1/ }));
    fireEvent.change(partSelect, { target: { value: 'p-1' } });

    await waitFor(() => expect(latest[0].partId).toBe('p-1'));
    expect(latest[0].itemId ?? null).toBeNull();
  });
});
