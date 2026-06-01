import { forwardRef } from 'react';
import type { Delivery, Job } from '@/core/types';
import { formatJobCode } from '@/lib/formatJob';

/**
 * EDITABLE PACKING SLIP TEMPLATE
 *
 * This is the source of truth for what gets printed and exported as PDF.
 * Edit anything below — Tailwind classes, layout, fields, branding — and the
 * change applies to both the on-screen preview and the printed/PDF output.
 *
 * Print-specific styles are at the bottom in <style>{...}</style> using
 * @media print rules. Tailwind print: variants also work (e.g. print:hidden).
 */

export interface PackingSlipTemplateProps {
  delivery: Delivery;
  job: Job;
  // Company branding — set these from Packing Slip Branding (admins) or pass directly.
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  logoUrl?: string;
}

const PackingSlipTemplate = forwardRef<HTMLDivElement, PackingSlipTemplateProps>(
  function PackingSlipTemplate(
    { delivery, job, companyName, companyAddress, companyPhone, companyEmail, logoUrl },
    ref
  ) {
    const totalQty = delivery.lineItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
    const trimmedName = companyName?.trim();

    return (
      <div
        ref={ref}
        className="packing-slip mx-auto bg-white p-8 text-black"
        style={{ width: '8.5in', minHeight: '11in', fontFamily: 'Arial, sans-serif' }}
      >
        {/* ─── Header ─── */}
        <div className="mb-6 flex items-start justify-between border-b-2 border-black pb-4">
          <div>
            {logoUrl && (
              <img src={logoUrl} alt={trimmedName || 'Company logo'} className="mb-2 h-16" />
            )}
            {trimmedName && <h1 className="text-2xl font-bold">{trimmedName}</h1>}
            {companyAddress && <p className="text-sm">{companyAddress}</p>}
            {(companyPhone || companyEmail) && (
              <p className="text-sm">
                {companyPhone}
                {companyPhone && companyEmail ? ' · ' : ''}
                {companyEmail}
              </p>
            )}
          </div>
          <div className="text-right">
            <h2 className="text-3xl font-bold uppercase tracking-wide">Packing Slip</h2>
            <p className="mt-2 text-sm">
              <span className="font-semibold">Delivery #:</span> {delivery.deliveryNumber}
            </p>
            <p className="text-sm">
              <span className="font-semibold">Date:</span>{' '}
              {new Date(delivery.deliveredAt + 'T00:00:00').toLocaleDateString()}
            </p>
          </div>
        </div>

        {/* ─── Job + Recipient ─── */}
        <div className="mb-6 grid grid-cols-2 gap-6">
          <div>
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-600">Job</h3>
            <p className="font-semibold">{formatJobCode(job.jobCode)}</p>
            <p className="text-sm">{job.name}</p>
            {job.po && (
              <p className="text-sm">
                <span className="font-semibold">PO:</span> {job.po}
              </p>
            )}
            {job.partNumber && (
              <p className="text-sm">
                <span className="font-semibold">Part #:</span> {job.partNumber}
                {job.revision ? ` Rev ${job.revision}` : ''}
              </p>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-600">
              Ship To / Received By
            </h3>
            {delivery.recipientName ? (
              <p className="text-sm">{delivery.recipientName}</p>
            ) : (
              <p className="text-sm italic text-gray-400">(blank)</p>
            )}
            {delivery.carrier && (
              <p className="mt-2 text-sm">
                <span className="font-semibold">Carrier:</span> {delivery.carrier}
              </p>
            )}
            {delivery.trackingNumber && (
              <p className="text-sm">
                <span className="font-semibold">Tracking:</span> {delivery.trackingNumber}
              </p>
            )}
          </div>
        </div>

        {/* ─── Line Items ─── */}
        <table className="mb-6 w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-black">
              <th className="px-2 py-2 text-left text-xs font-bold uppercase">Part #</th>
              <th className="px-2 py-2 text-left text-xs font-bold uppercase">Description</th>
              <th className="px-2 py-2 text-right text-xs font-bold uppercase">Qty</th>
              <th className="px-2 py-2 text-left text-xs font-bold uppercase">Unit</th>
            </tr>
          </thead>
          <tbody>
            {delivery.lineItems.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-sm italic text-gray-400">
                  No line items
                </td>
              </tr>
            ) : (
              delivery.lineItems.map((item, i) => (
                <tr key={i} className="border-b border-gray-300">
                  <td className="px-2 py-2 text-sm">
                    {item.partNumber ?? '—'}
                    {item.variantSuffix ? `-${item.variantSuffix}` : ''}
                  </td>
                  <td className="px-2 py-2 text-sm">{item.description}</td>
                  <td className="px-2 py-2 text-right text-sm font-semibold">{item.quantity}</td>
                  <td className="px-2 py-2 text-sm">{item.unit ?? 'units'}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black">
              <td colSpan={2} className="px-2 py-2 text-sm font-bold">
                Total
              </td>
              <td className="px-2 py-2 text-right text-base font-bold">{totalQty}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        {/* ─── Notes ─── */}
        {delivery.notes && (
          <div className="mb-8">
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-600">Notes</h3>
            <p className="whitespace-pre-wrap text-sm">{delivery.notes}</p>
          </div>
        )}

        {/* ─── Signature ─── */}
        <div className="mt-12 grid grid-cols-2 gap-8">
          <div>
            <div className="border-b border-black pb-1" style={{ height: '2.5rem' }} />
            <p className="mt-1 text-xs uppercase tracking-wide text-gray-600">
              Received by (signature)
            </p>
          </div>
          <div>
            <div className="border-b border-black pb-1" style={{ height: '2.5rem' }} />
            <p className="mt-1 text-xs uppercase tracking-wide text-gray-600">Date</p>
          </div>
        </div>

        {/* ─── Print-only styles ─── */}
        <style>{`
          @media print {
            @page { size: letter; margin: 0.5in; }
            body { background: white !important; }
            .packing-slip { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: 100% !important; }
          }
        `}</style>
      </div>
    );
  }
);

export default PackingSlipTemplate;
