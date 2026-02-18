import React from 'react';
import {
  JobStatus,
  InventoryCategory,
  getStatusDisplayName,
  getCategoryDisplayName,
} from '../../types';

interface StatusBadgeProps {
  status?: JobStatus;
  category?: InventoryCategory;
  className?: string;
  size?: 'sm' | 'md';
}

const STATUS_COLORS: Record<JobStatus, string> = {
  pending: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  rush: 'bg-red-600/20 text-red-400 border-red-600/30',
  inProgress: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  qualityControl: 'bg-green-500/20 text-green-400 border-green-500/30',
  finished: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  delivered: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  onHold: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  toBeQuoted: 'bg-red-500/20 text-red-400 border-red-500/30',
  quoted: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  rfqReceived: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  rfqSent: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  pod: 'bg-green-500/20 text-green-400 border-green-500/30',
  waitingForPayment: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  projectCompleted: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

const CATEGORY_COLORS: Record<InventoryCategory, string> = {
  material: 'bg-red-500/20 text-red-400 border-red-500/30',
  foam: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  trimCord: 'bg-green-500/20 text-green-400 border-green-500/30',
  printing3d: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  chemicals: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  hardware: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  miscSupplies: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  category,
  className = '',
  size = 'md',
}) => {
  if (!status && !category) return null;

  const displayText = status
    ? getStatusDisplayName(status)
    : category
      ? getCategoryDisplayName(category)
      : '';
  const colorClasses = status ? STATUS_COLORS[status] : category ? CATEGORY_COLORS[category] : '';

  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-xs',
    md: 'px-2 py-0.5 text-sm',
  };

  return (
    <span
      className={`inline-flex items-center rounded-sm border font-bold ${colorClasses} ${sizeClasses[size]} ${className}`}
    >
      {displayText}
    </span>
  );
};
