import { DimensionPicker } from '../components/DimensionPicker';
import type { LineDimensions } from '../types';

interface LineDimensionFieldsProps {
  dims: LineDimensions;
  onChange: (patch: Partial<LineDimensions>) => void;
  /** Index for stable aria labels across a list of lines. */
  index: number;
  disabled?: boolean;
}

/**
 * The three reporting-dimension pickers (class / location / department) for one payload
 * line, laid out in a compact row. Every field is optional — a blank picker stores null,
 * which is always valid (the columns are nullable; the DB only enforces TYPE-match when
 * a value is present). Reused by the invoice, bill, and journal payload editors.
 */
export function LineDimensionFields({ dims, onChange, index, disabled }: LineDimensionFieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <DimensionPicker
        type="class"
        ariaLabel={`Line ${index + 1} class`}
        value={dims.classId ?? ''}
        onChange={(id) => onChange({ classId: id || null })}
        disabled={disabled}
      />
      <DimensionPicker
        type="location"
        ariaLabel={`Line ${index + 1} location`}
        value={dims.locationId ?? ''}
        onChange={(id) => onChange({ locationId: id || null })}
        disabled={disabled}
      />
      <DimensionPicker
        type="department"
        ariaLabel={`Line ${index + 1} department`}
        value={dims.departmentId ?? ''}
        onChange={(id) => onChange({ departmentId: id || null })}
        disabled={disabled}
      />
    </div>
  );
}
