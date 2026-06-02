import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { exportReportCsv, exportReportPdf, type ReportDocument } from './reportExport';

interface ExportButtonsProps {
  /**
   * Lazily builds the report document at click time, so it always reflects the
   * current data/filter. Returns null when there is nothing to export (disables
   * the buttons).
   */
  buildDocument: () => ReportDocument | null;
  disabled?: boolean;
}

/**
 * PDF + CSV export buttons for a report screen. The generated output embeds the G9
 * disclaimer (see reportExport). PDF generation is async (lazy html2pdf); failures
 * surface inline rather than throwing.
 */
export function ExportButtons({ buildDocument, disabled = false }: ExportButtonsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCsv = () => {
    setError(null);
    const doc = buildDocument();
    if (!doc) return;
    try {
      exportReportCsv(doc);
    } catch {
      setError('CSV export failed.');
    }
  };

  const onPdf = async () => {
    setError(null);
    const doc = buildDocument();
    if (!doc) return;
    setBusy(true);
    try {
      await exportReportPdf(doc);
    } catch {
      setError('PDF export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon="table_view"
          onClick={onCsv}
          disabled={disabled || busy}
        >
          CSV
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon="picture_as_pdf"
          onClick={onPdf}
          disabled={disabled || busy}
        >
          {busy ? 'Generating…' : 'PDF'}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
