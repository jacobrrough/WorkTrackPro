export const DEFAULT_UNIT = 'units';

export const normalizeVariantSuffix = (suffix: string): string =>
  String(suffix ?? '')
    .trim()
    .replace(/^-/, '');

export const toDashSuffix = (suffix: string): string => {
  const normalized = normalizeVariantSuffix(suffix);
  return normalized ? `-${normalized}` : '';
};

export const getDashQuantity = (
  dashQuantities: Record<string, number> | undefined | null,
  suffix: string
): number => {
  if (!dashQuantities) return 0;
  const normalized = normalizeVariantSuffix(suffix);
  if (!normalized) return 0;
  return (
    dashQuantities[toDashSuffix(normalized)] ??
    dashQuantities[normalized] ??
    dashQuantities[suffix] ??
    0
  );
};

export const normalizeDashQuantities = (
  dashQuantities: Record<string, number> | undefined | null
): Record<string, number> => {
  if (!dashQuantities) return {};
  const normalized: Record<string, number> = {};
  for (const [suffix, rawQty] of Object.entries(dashQuantities)) {
    const qty = Number(rawQty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const key = toDashSuffix(suffix);
    if (!key) continue;
    normalized[key] = qty;
  }
  return normalized;
};

export const quantityPerUnit = (material: {
  quantityPerUnit?: number;
  quantity?: number;
}): number => {
  const fromPerUnit = Number(material.quantityPerUnit);
  if (Number.isFinite(fromPerUnit)) return fromPerUnit;
  const fromLegacy = Number(material.quantity);
  if (Number.isFinite(fromLegacy)) return fromLegacy;
  return 1;
};

export const buildDistributionWeights = (
  dashQuantities: Record<string, number>,
  setComposition?: Record<string, number> | null
): Record<string, number> => {
  const normalizedDash = normalizeDashQuantities(dashQuantities);
  const dashKeys = Object.keys(normalizedDash);

  const setWeights: Record<string, number> = {};
  if (setComposition) {
    for (const [suffix, qty] of Object.entries(setComposition)) {
      const normalizedSuffix = toDashSuffix(suffix);
      const nQty = Number(qty);
      if (!normalizedSuffix || !Number.isFinite(nQty) || nQty <= 0) continue;
      if (dashKeys.length > 0 && normalizedDash[normalizedSuffix] == null) continue;
      setWeights[normalizedSuffix] = nQty;
    }
  }

  const weightSource = Object.keys(setWeights).length > 0 ? setWeights : normalizedDash;
  const total = Object.values(weightSource).reduce((sum, n) => sum + n, 0);
  if (total <= 0) return {};

  const ratios: Record<string, number> = {};
  for (const [suffix, weight] of Object.entries(weightSource)) {
    ratios[suffix] = weight / total;
  }
  return ratios;
};
