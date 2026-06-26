import type { Delivery, DeliveryLineItem, Job } from '@/core/types';
import { deliveryLineKey } from '../deliveryValidation';

export interface EditableLine extends DeliveryLineItem {
  ordered?: number;
  remaining?: number;
}

/** Clamp to a non-negative finite count; garbage ("abc") and negatives become 0. */
function toOrderedQty(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function makeLine(
  alreadyDelivered: Record<string, number>,
  ordered: number,
  line: { description: string; partNumber?: string; variantSuffix?: string }
): EditableLine {
  const delivered = alreadyDelivered[deliveryLineKey(line.partNumber, line.variantSuffix)] ?? 0;
  const remaining = Math.max(0, ordered - delivered);
  return {
    partNumber: line.partNumber,
    variantSuffix: line.variantSuffix,
    description: line.description,
    quantity: remaining,
    unit: 'units',
    ordered,
    remaining,
  };
}

export function buildInitialLines(
  job: Job,
  alreadyDelivered: Record<string, number>,
  existing?: Delivery,
  /** Part name keyed by part number, used as the default line description so the
   *  packing slip matches the part name shown in the job detail. */
  partNamesByNumber?: Record<string, string>
): EditableLine[] {
  if (existing) {
    return existing.lineItems.map((li) => ({ ...li }));
  }

  // Prefer the part's name (e.g. "SEAL CART TARP") for the description; fall back
  // to the supplied default (the part number) when no name is known.
  const describe = (partNumber: string, fallback: string): string =>
    partNamesByNumber?.[partNumber]?.trim() || fallback;

  const lines: EditableLine[] = [];

  if (job.parts && job.parts.length > 0) {
    // A single-part job may carry its set count on job.qty rather than dashQuantities;
    // only fall back to it when there's exactly one part so multi-part jobs don't all
    // inherit the same total.
    const singlePartFallbackQty = job.parts.length === 1 ? toOrderedQty(job.qty) : 0;
    for (const part of job.parts) {
      const dq = part.dashQuantities ?? {};
      const variants = Object.keys(dq).sort();
      if (variants.length === 0) {
        lines.push(
          makeLine(alreadyDelivered, singlePartFallbackQty, {
            description: describe(part.partNumber, part.partNumber),
            partNumber: part.partNumber,
          })
        );
      } else {
        for (const v of variants) {
          lines.push(
            makeLine(alreadyDelivered, toOrderedQty(dq[v]), {
              description: describe(part.partNumber, `${part.partNumber}-${v}`),
              partNumber: part.partNumber,
              variantSuffix: v,
            })
          );
        }
      }
    }
  } else if (job.partNumber) {
    const dq = job.dashQuantities ?? {};
    const variants = Object.keys(dq).sort();
    if (variants.length > 0) {
      for (const v of variants) {
        lines.push(
          makeLine(alreadyDelivered, toOrderedQty(dq[v]), {
            description: describe(job.partNumber, `${job.partNumber}-${v}`),
            partNumber: job.partNumber,
            variantSuffix: v,
          })
        );
      }
    } else {
      lines.push(
        makeLine(alreadyDelivered, toOrderedQty(job.qty), {
          description: describe(job.partNumber, job.partNumber),
          partNumber: job.partNumber,
        })
      );
    }
  } else {
    lines.push(
      makeLine(alreadyDelivered, toOrderedQty(job.qty), { description: job.name || 'Item' })
    );
  }

  return lines;
}
