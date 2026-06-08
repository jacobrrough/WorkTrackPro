import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { InventoryItem, Part } from '@/core/types';
import { calculatePartQuote } from './calculatePartQuote';

const makeInventory = (id: string, price: number): InventoryItem =>
  ({
    id,
    name: `INV-${id}`,
    category: 'material',
    currentStock: 100,
    minStockLevel: 1,
    unit: 'ea',
    price,
    inStock: 100,
    available: 100,
    disposed: 0,
    onOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }) as InventoryItem;

// A material quantity that may be negative, NaN, or otherwise hostile.
const hostileQuantity = fc.oneof(
  fc.double({ noNaN: false }), // includes NaN, +/-Infinity, negatives
  fc.constant(Number.NaN),
  fc.constant(Number.NEGATIVE_INFINITY),
  fc.integer({ min: -1_000_000, max: -1 })
);

describe('calculatePartQuote (property-based)', () => {
  it('material cost is never negative for arbitrary (incl. negative/NaN) quantities', () => {
    fc.assert(
      fc.property(
        // up to 6 material lines, each with a possibly-hostile quantity + non-negative price
        fc.array(
          fc.record({
            qty: hostileQuantity,
            price: fc.double({ min: 0, max: 10_000, noNaN: true }),
          }),
          { minLength: 1, maxLength: 6 }
        ),
        fc.integer({ min: 1, max: 50 }), // quantity (number of sets)
        (lines, quantity) => {
          const inventory: InventoryItem[] = lines.map((l, i) =>
            makeInventory(`inv-${i}`, l.price)
          );
          const part = {
            id: 'part-1',
            partNumber: 'P-PROP',
            name: 'Prop Part',
            laborHours: 0,
            requiresCNC: false,
            requires3DPrint: false,
            materials: lines.map((l, i) => ({
              id: `m-${i}`,
              inventoryId: `inv-${i}`,
              quantityPerUnit: l.qty,
              unit: 'ea',
              usageType: 'per_set',
            })),
            variants: [],
            setComposition: {},
          } as unknown as Part;

          const result = calculatePartQuote(part, quantity, inventory, { laborRate: 175 });

          expect(result).not.toBeNull();
          if (!result) return;
          // The clamp must guarantee no negative material cost or per-line totals.
          expect(result.materialCostOur).toBeGreaterThanOrEqual(0);
          expect(result.materialCostCustomer).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(result.materialCostOur)).toBe(true);
          for (const li of result.materialLineItems) {
            expect(li.lineTotalOur).toBeGreaterThanOrEqual(0);
            expect(li.lineTotalCustomer).toBeGreaterThanOrEqual(0);
            expect(li.quantity).toBeGreaterThanOrEqual(0);
          }
        }
      )
    );
  });

  it('full quote totals stay non-negative for hostile quantities + arbitrary labor', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            qty: hostileQuantity,
            price: fc.double({ min: 0, max: 10_000, noNaN: true }),
          }),
          { minLength: 1, maxLength: 6 }
        ),
        fc.double({ min: 0, max: 1000, noNaN: true }), // laborHours per set
        fc.integer({ min: 1, max: 50 }),
        (lines, laborHours, quantity) => {
          const inventory: InventoryItem[] = lines.map((l, i) =>
            makeInventory(`inv-${i}`, l.price)
          );
          const part = {
            id: 'part-1',
            partNumber: 'P-PROP',
            name: 'Prop Part',
            laborHours,
            requiresCNC: false,
            requires3DPrint: false,
            materials: lines.map((l, i) => ({
              id: `m-${i}`,
              inventoryId: `inv-${i}`,
              quantityPerUnit: l.qty,
              unit: 'ea',
              usageType: 'per_set',
            })),
            variants: [],
            setComposition: {},
          } as unknown as Part;

          const result = calculatePartQuote(part, quantity, inventory, { laborRate: 175 });

          expect(result).not.toBeNull();
          if (!result) return;
          expect(result.subtotal).toBeGreaterThanOrEqual(0);
          expect(result.total).toBeGreaterThanOrEqual(0);
          expect(result.laborCost).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });
});
