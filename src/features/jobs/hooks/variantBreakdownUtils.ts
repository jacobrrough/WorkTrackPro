export interface VariantBreakdownEntryLike {
  suffix: string;
  qty: number;
  laborHoursPerUnit: number;
  laborHoursTotal: number;
  cncHoursPerUnit: number;
  cncHoursTotal: number;
  printer3DHoursPerUnit: number;
  printer3DHoursTotal: number;
}

export function buildPersistedVariantBreakdowns(entries: VariantBreakdownEntryLike[]) {
  const persistedLaborBreakdown = entries.reduce<
    Record<string, { qty: number; hoursPerUnit: number; totalHours: number }>
  >((acc, entry) => {
    acc[entry.suffix] = {
      qty: entry.qty,
      hoursPerUnit: entry.laborHoursPerUnit,
      totalHours: entry.laborHoursTotal,
    };
    return acc;
  }, {});

  const persistedMachineBreakdown = entries.reduce<
    Record<
      string,
      {
        qty: number;
        cncHoursPerUnit: number;
        cncHoursTotal: number;
        printer3DHoursPerUnit: number;
        printer3DHoursTotal: number;
      }
    >
  >((acc, entry) => {
    acc[entry.suffix] = {
      qty: entry.qty,
      cncHoursPerUnit: entry.cncHoursPerUnit,
      cncHoursTotal: entry.cncHoursTotal,
      printer3DHoursPerUnit: entry.printer3DHoursPerUnit,
      printer3DHoursTotal: entry.printer3DHoursTotal,
    };
    return acc;
  }, {});

  return { persistedLaborBreakdown, persistedMachineBreakdown };
}
