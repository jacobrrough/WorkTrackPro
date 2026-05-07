import React, { useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import type { Delivery, Job } from '@/core/types';
import PackingSlipTemplate from '../PackingSlipTemplate';

interface PackingSlipPreviewProps {
  delivery: Delivery;
  job: Job;
  onClose: () => void;
}

const PackingSlipPreview: React.FC<PackingSlipPreviewProps> = ({ delivery, job, onClose }) => {
  const slipRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const handlePrint = useReactToPrint({
    contentRef: slipRef,
    documentTitle: `packing-slip-job-${job.jobCode}-${delivery.deliveryNumber}`,
  });

  const handleDownloadPdf = async () => {
    if (!slipRef.current) return;
    setDownloading(true);
    try {
      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = (html2pdfModule as { default: unknown }).default ?? html2pdfModule;
      const opt = {
        margin: 0.5,
        filename: `packing-slip-job-${job.jobCode}-${delivery.deliveryNumber}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'in' as const, format: 'letter' as const, orientation: 'portrait' as const },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (html2pdf as any)().set(opt).from(slipRef.current).save();
    } catch (err) {
      console.error('PDF download failed:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <header className="flex items-center justify-between border-b border-white/10 bg-surface-dark px-4 py-3">
        <h2 className="text-base font-semibold text-white">
          Packing Slip — Job #{job.jobCode}, Delivery #{delivery.deliveryNumber}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handlePrint()}
            className="flex items-center gap-1.5 rounded bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
          >
            <span className="material-symbols-outlined text-base">print</span>
            Print
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={downloading}
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base">download</span>
            {downloading ? 'Generating...' : 'Download PDF'}
          </button>
          <button
            onClick={onClose}
            className="ml-2 text-slate-400 hover:text-white"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto shadow-2xl" style={{ width: '8.5in' }}>
          <PackingSlipTemplate ref={slipRef} delivery={delivery} job={job} />
        </div>
      </div>
    </div>
  );
};

export default PackingSlipPreview;
