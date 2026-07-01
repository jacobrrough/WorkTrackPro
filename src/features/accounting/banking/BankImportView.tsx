import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { LedgerTable } from '../components/LedgerTable';
import { useBankAccount } from '../hooks/useAccountingQueries';
import { useImportBankTransactions } from '../hooks/useAccountingMutations';
import {
  parseBankFile,
  BankImportError,
  type ImportResult,
  type ParseResult,
} from '@/services/api/accounting';
import { BANKING_BASE } from '../constants';
import { SignedAmount } from './bankingFormat';

const MAX_PREVIEW_ROWS = 50;

export default function BankImportView() {
  const { bankAccountId } = useParams<{ bankAccountId: string }>();
  const navigate = useNavigate();
  const { data: account } = useBankAccount(bankAccountId);
  const importTxns = useImportBankTransactions();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setFileName(null);
    setParsed(null);
    setParseError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onFile = async (file: File) => {
    setParsed(null);
    setParseError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const res = parseBankFile(text, file.name);
      setParsed(res);
    } catch (e) {
      if (e instanceof BankImportError) setParseError(e.message);
      else setParseError(e instanceof Error ? e.message : 'Could not read this file.');
    }
  };

  const onImport = async () => {
    if (!bankAccountId || !parsed) return;
    const res = await importTxns.mutateAsync({
      bankAccountId,
      transactions: parsed.transactions,
    });
    setResult(res);
  };

  const previewRows = parsed?.transactions.slice(0, MAX_PREVIEW_ROWS) ?? [];
  const extraRows = (parsed?.transactions.length ?? 0) - previewRows.length;

  return (
    <AccountingShell active="banking" title="Import Statement">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <button
          type="button"
          onClick={() => navigate(`${BANKING_BASE}/${bankAccountId}`)}
          className="flex items-center gap-1 self-start text-sm font-semibold text-muted hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          {account ? account.name : 'Back to account'}
        </button>

        <p className="text-sm text-muted">
          Choose a CSV, OFX, or QFX file exported from your bank. The file is parsed in your browser
          — nothing is uploaded until you import. Re-importing the same statement is safe:
          duplicates are skipped by transaction id.
        </p>

        {/* File picker */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.ofx,.qfx,text/csv,application/x-ofx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <Button
            variant="secondary"
            icon="folder_open"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose file
          </Button>
          {fileName && <span className="text-sm text-muted">{fileName}</span>}
          {(parsed || parseError) && (
            <button
              type="button"
              onClick={reset}
              className="text-sm font-semibold text-muted hover:text-white"
            >
              Clear
            </button>
          )}
        </div>

        {parseError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {parseError}
          </div>
        )}

        {/* Post-import result */}
        {result && (
          <div className="rounded-2xl border border-line bg-card-dark p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-green-400">task_alt</span>
              <h2 className="font-bold text-white">Import complete</h2>
            </div>
            <ul className="space-y-1 text-sm text-muted">
              <li>
                <span className="font-mono font-bold text-white">{result.inserted}</span>{' '}
                transaction
                {result.inserted === 1 ? '' : 's'} imported
              </li>
              <li>
                <span className="font-mono font-bold text-white">{result.duplicates}</span>{' '}
                duplicate
                {result.duplicates === 1 ? '' : 's'} skipped
              </li>
              <li>
                <span className="font-mono font-bold text-white">{result.autoCategorized}</span>{' '}
                auto-categorized by rules (review before accepting)
              </li>
            </ul>
            {result.error && <p className="mt-2 text-sm text-amber-400">{result.error}</p>}
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => navigate(`${BANKING_BASE}/${bankAccountId}`)}>
                Review transactions
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>
                Import another
              </Button>
            </div>
          </div>
        )}

        {/* Preview (before import) */}
        {parsed && !result && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">
                Parsed <span className="font-bold text-white">{parsed.transactions.length}</span>{' '}
                transaction
                {parsed.transactions.length === 1 ? '' : 's'} from a{' '}
                <span className="uppercase">{parsed.format}</span> file.
              </p>
              <Button
                icon="download"
                onClick={onImport}
                disabled={importTxns.isPending || parsed.transactions.length === 0}
              >
                {importTxns.isPending
                  ? 'Importing…'
                  : `Import ${parsed.transactions.length} transaction${
                      parsed.transactions.length === 1 ? '' : 's'
                    }`}
              </Button>
            </div>

            {parsed.warnings.length > 0 && (
              <details className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                <summary className="cursor-pointer font-semibold">
                  {parsed.warnings.length} row
                  {parsed.warnings.length === 1 ? '' : 's'} skipped while parsing
                </summary>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
                  {parsed.warnings.slice(0, 20).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {parsed.warnings.length > 20 && <li>…and {parsed.warnings.length - 20} more.</li>}
                </ul>
              </details>
            )}

            <LedgerTable
              columns={[
                { label: 'Date' },
                { label: 'Description' },
                { label: 'Amount', align: 'right' },
              ]}
            >
              {previewRows.map((t, i) => (
                <tr key={i} className="border-t border-line/60">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{t.txnDate}</td>
                  <td className="px-3 py-2 text-white">
                    {t.description || t.merchant || '—'}
                    {t.merchant && t.description && (
                      <span className="block text-xs text-subtle">{t.merchant}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <SignedAmount amount={t.amount} className="text-sm" />
                  </td>
                </tr>
              ))}
            </LedgerTable>
            {extraRows > 0 && (
              <p className="text-center text-xs text-subtle">
                Showing the first {MAX_PREVIEW_ROWS} of {parsed.transactions.length}. All{' '}
                {parsed.transactions.length} will be imported.
              </p>
            )}
          </>
        )}
      </div>
    </AccountingShell>
  );
}
