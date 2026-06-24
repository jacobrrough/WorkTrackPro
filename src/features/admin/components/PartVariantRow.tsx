interface PartVariantRowProps {
  variant: any;
  onEdit?: (variant: any) => void;
  onDelete?: (variant: any) => void;
}

export function PartVariantRow({ variant, onEdit, onDelete }: PartVariantRowProps) {
  return (
    <div className="flex items-center justify-between rounded border border-white/10 bg-white/5 p-2 text-sm">
      <div>
        <span className="font-mono font-bold">{variant.variantSuffix}</span>
        {variant.name && <span className="ml-2 text-muted">{variant.name}</span>}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        {variant.laborHours != null && <span>L {variant.laborHours}h</span>}
        {variant.pricePerVariant != null && <span>${variant.pricePerVariant}</span>}
        {(onEdit || onDelete) && (
          <div className="flex gap-1">
            {onEdit && (
              <button onClick={() => onEdit(variant)} className="text-primary hover:underline">
                Edit
              </button>
            )}
            {onDelete && (
              <button onClick={() => onDelete(variant)} className="text-red-400 hover:underline">
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
