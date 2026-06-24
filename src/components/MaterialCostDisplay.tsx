import React from 'react';

export interface MaterialCostDisplayProps {
  ourCost: number;
  multiplier?: number;
  className?: string;
}

const DEFAULT_MULTIPLIER = 2.25;

const MaterialCostDisplay: React.FC<MaterialCostDisplayProps> = ({
  ourCost,
  multiplier = DEFAULT_MULTIPLIER,
  className = '',
}) => {
  const customerPrice = ourCost * multiplier;

  return (
    <div className={className}>
      <div className="text-base font-medium text-white">${customerPrice.toFixed(2)}</div>
      <div className="text-xs text-subtle">
        Our cost: ${ourCost.toFixed(2)} (×{multiplier})
      </div>
    </div>
  );
};

export default MaterialCostDisplay;
