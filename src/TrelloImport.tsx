import React, { useState, useRef } from 'react';
import { JobStatus, InventoryCategory } from '@/core/types';
import { jobService, inventoryService, supabase } from './pocketbase';
import { partsService } from './services/api/parts';

interface TrelloImportProps {
  onClose: () => void;
  onImportComplete: () => void;
}

type BoardType = 'admin' | 'inventory';

interface CustomField {
  id: string;
  name: string;
  type: string;
}

interface CustomFieldItem {
  id: string;
  idCustomField: string;
  value: { number?: string; text?: string };
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  due: string | null;
  closed: boolean;
  idList: string;
  labels?: Array<{ name: string }>;
  attachments?: Array<{ url: string; name: string; isUpload?: boolean }>;
  customFieldItems?: CustomFieldItem[];
}

interface TrelloList {
  id: string;
  name: string;
}

interface TrelloExport {
  name: string;
  cards: TrelloCard[];
  lists: TrelloList[];
  customFields?: CustomField[];
}

interface ImportResult {
  success: number;
  failed: number;
  linked: number;
}

interface ErrorLog {
  cardName: string;
  error: string;
}

const TrelloImport: React.FC<TrelloImportProps> = ({ onClose, onImportComplete }) => {
  const [boardType, setBoardType] = useState<BoardType>('admin');
  const [trelloData, setTrelloData] = useState<TrelloExport | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorLog, setErrorLog] = useState<ErrorLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showErrorLog, setShowErrorLog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const sanitizeText = (text: string): string => {
    if (!text) return '';
    return (
      text
        // eslint-disable-next-line no-control-regex -- strip control chars from Trello export
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .replace(/•/g, '•')
        .replace(/ÃƒÂ¢Ã¢â€šÂ¬"/g, 'Ã¢â‚¬â€')
        .replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢/g, "'")
        .replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ/g, '"')
        .replace(/ÃƒÂ¢Ã¢â€šÂ¬/g, '"')
        .trim()
    );
  };

  const parseMaterials = (description: string): Array<{ material: string; qty: number }> => {
    const materials: Array<{ material: string; qty: number }> = [];
    if (!description) return materials;

    // Normalize line breaks and clean up
    const normalized = description
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u00A0/g, ' ')
      .replace(/[\u2000-\u200B]/g, ' ');

    const lines = normalized.split('\n');
    let inMaterials = false;
    const materialKeywords = [
      /^materials?[:：]/i,
      /^material\s+list[:：]/i,
      /^supplies?[:：]/i,
      /^components?[:：]/i,
      /^parts?[:：]/i,
      /^items?[:：]/i,
      /^inventory[:：]/i,
      /^bom\s*[:：]/i,
      /^bill\s+of\s+materials?[:：]/i,
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const isMaterialHeader = materialKeywords.some((pattern) => pattern.test(line));
      if (isMaterialHeader) {
        inMaterials = true;
        continue;
      }

      if (inMaterials && /^[A-Z][a-z]+[:：]\s*$/.test(line) && !materialKeywords.some((p) => p.test(line))) {
        const nextLines = lines.slice(i + 1, i + 3).join(' ').trim();
        if (!nextLines || !/[\d•\-*]/.test(nextLines)) {
          break;
        }
      }

      if (inMaterials || /^[•\-*\d.\s]/.test(line)) {
        const cleaned = line
          .replace(/^[•\-*\d.)]\s*/, '')
          .replace(/^\((\d+)\)\s*/, '$1 ')
          .trim();

        if (cleaned.length < 2 || /^[A-Z][a-z]+[:：]\s*$/.test(cleaned)) continue;

        let qty = 1;
        let materialName = cleaned;

        const qtyPrefix = cleaned.match(/^(\d+)\s*x?\s+(.+)$/i);
        if (qtyPrefix) {
          qty = parseInt(qtyPrefix[1]);
          materialName = qtyPrefix[2];
        } else {
          const qtySuffix = cleaned.match(/^(.+?)\s+(?:x|Ãƒâ€”|\()(\d+)\)?$/i);
          if (qtySuffix) {
            materialName = qtySuffix[1];
            qty = parseInt(qtySuffix[2]);
          }
        }

        // Clean up material name
        materialName = materialName
          .replace(/\s+/g, ' ')
          .replace(/^[-•*\s]+/, '')
          .replace(/[-•*\s]+$/, '')
          .trim()
          .replace(/^(need|needs|required|requires?|use|uses?|with)\s+/i, '')
          .replace(/\s+(needed|required|used)$/i, '');

        // Validate and add material
        if (materialName.length >= 2 && qty > 0 && qty <= 100000) {
          const isLikelyMaterial =
            !/^(note|note:|important|warning|tip|instructions?|steps?|process|procedure)/i.test(materialName) &&
            !/^[A-Z][a-z]+\s*[:：]\s*$/.test(materialName) &&
            materialName.length <= 200;

          if (isLikelyMaterial) {
            materials.push({ material: materialName, qty });
          }
        }
      }
    }

    // Also try to extract materials from inline text if no materials found in lists
    if (materials.length === 0) {
      const inlinePatterns = [
        /(?:need|needs|requires?|use|uses?|with)\s+(\d+\.?\d*)\s*[x×]?\s*([A-Za-z][^.!?;,\n]{2,50})/gi,
        /(\d+\.?\d*)\s*[x×]\s*([A-Za-z][^.!?;,\n]{2,50})/gi,
      ];

      for (const pattern of inlinePatterns) {
        let match;
        while ((match = pattern.exec(description)) !== null) {
          const qty = parseFloat(match[1]);
          const material = match[2].trim();
          if (qty > 0 && qty <= 100000 && material.length >= 2 && material.length <= 200) {
            const exists = materials.some((m) => m.material.toLowerCase() === material.toLowerCase());
            if (!exists) {
              materials.push({ material, qty });
            }
          }
        }
      }
    }

    return materials;
  };

  const extractTrelloLinks = (
    description: string,
    attachments?: Array<{ url: string; name: string }>
  ): string[] => {
    const links: string[] = [];

    const urlPattern = /https?:\/\/trello\.com\/c\/[\w-]+\/\d+-[\w-]+/gi;
    const matches = description.match(urlPattern);
    if (matches) links.push(...matches);

    if (attachments) {
      for (const att of attachments) {
        if (att.url?.includes('trello.com/c/')) {
          links.push(att.url);
        }
      }
    }

    return [...new Set(links)];
  };

  const fuzzyMatch = (searchText: string, invName: string): number => {
    const search = searchText.toLowerCase();
    const name = invName.toLowerCase();

    if (name === search) return 100;
    if (name.includes(search)) return 80;
    if (search.includes(name)) return 70;

    const searchWords = search.split(/\s+/).filter((w) => w.length > 2);
    const nameWords = name.split(/\s+/).filter((w) => w.length > 2);

    let matches = 0;
    for (const sw of searchWords) {
      for (const nw of nameWords) {
        if (sw === nw) {
          matches++;
          break;
        }
      }
    }

    return matches > 0 ? (matches / Math.max(searchWords.length, nameWords.length)) * 60 : 0;
  };

  const findBestMatch = (
    searchText: string,
    inventoryMap: Map<string, { id: string; name: string }>
  ): { id: string; name: string } | null => {
    let bestMatch: { id: string; name: string; score: number } | null = null;

    for (const [, inv] of inventoryMap) {
      const score = fuzzyMatch(searchText, inv.name);
      if (score > 50 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { ...inv, score };
      }
    }

    return bestMatch || null;
  };

  const handleFileSelect = async (file: File) => {
    setError(null);
    setResult(null);
    setErrorLog([]);

    if (!file.name.endsWith('.json')) {
      setError('Please upload a JSON file.');
      return;
    }

    try {
      const text = await file.text();
      const data: TrelloExport = JSON.parse(text);

      if (!data.cards || !Array.isArray(data.cards)) {
        setError('Invalid Trello export.');
        return;
      }

      setTrelloData(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON';
      setError(`Error: ${msg}`);
    }
  };

  const getStatus = (listName: string): JobStatus => {
    const n = listName.toLowerCase();
    if (n.includes('to be quoted')) return 'toBeQuoted';
    if (n.includes('quoted')) return 'quoted';
    if (n.includes('rfq') && n.includes('rec')) return 'rfqReceived';
    if (n.includes('rfq') && n.includes('sent')) return 'rfqSent';
    if (n.includes('pod') || n.includes("po'd")) return 'pod';
    if (n.includes('progress')) return 'inProgress';
    if (n.includes('quality')) return 'qualityControl';
    if (n.includes('hold')) return 'onHold';
    if (n.includes('finish')) return 'finished';
    if (n.includes('deliver')) return 'delivered';
    if (n.includes('payment')) return 'waitingForPayment';
    if (n.includes('complete')) return 'projectCompleted';
    return 'pending';
  };

  const getCategory = (listName: string): InventoryCategory => {
    const n = listName.toLowerCase();
    if (n.includes('foam')) return 'foam';
    if (n.includes('trim') || n.includes('cord')) return 'trimCord';
    if (n.includes('3d') || n.includes('print')) return 'printing3d';
    if (n.includes('chem')) return 'chemicals';
    if (n.includes('hardware')) return 'hardware';
    if (n.includes('misc')) return 'miscSupplies';
    return 'material';
  };

  const getCustomFieldValue = (
    card: TrelloCard,
    cfMap: Map<string, string>,
    fieldName: string
  ): number | null => {
    if (!card.customFieldItems) return null;

    try {
      for (const item of card.customFieldItems) {
        const name = cfMap.get(item.idCustomField);
        if (name && name.toLowerCase().includes(fieldName.toLowerCase())) {
          if (item.value?.number) return parseFloat(item.value.number);
          if (item.value?.text) {
            const num = parseFloat(item.value.text);
            if (!isNaN(num)) return num;
          }
        }
      }
    } catch {
      // Ignore errors when parsing custom fields
    }
    return null;
  };

  const importJobs = async (
    cards: TrelloCard[],
    listMap: Map<string, string>,
    _cfMap: Map<string, string>
  ): Promise<ImportResult> => {
    const results: ImportResult = { success: 0, failed: 0, linked: 0 };
    const errors: ErrorLog[] = [];

    setStatus('Loading inventory...');
    const inventoryMap = new Map<string, { id: string; name: string }>();
    try {
      const inv = await pb
        .collection('inventory')
        .getFullList<{ id: string; name: string }>({ fields: 'id,name' });
      inv.forEach((i) => inventoryMap.set(i.id, { id: i.id, name: i.name }));
    } catch (err) {
      console.error('Ã¢ÂÅ’ Failed to load inventory:', err);
    }

    setStatus('Getting next job code...');
    let nextCode = 1;
    try {
      const existing = await pb
        .collection('jobs')
        .getList<{ jobCode: number }>(1, 1, { sort: '-jobCode', fields: 'jobCode' });
      if (existing.items.length > 0) nextCode = existing.items[0].jobCode + 1;
    } catch {
      // Failed to get next code - start from 1
    }

    for (let i = 0; i < cards.length; i++) {
      if (isCancelled) break;

      const card = cards[i];
      setStatus(`Importing ${i + 1}/${cards.length}...`);
      setProgress(Math.round((i / cards.length) * 100));

      try {
        const cardName = sanitizeText(card.name);
        if (!cardName) throw new Error('Empty name');

        let description = sanitizeText(card.desc || '');
        const uploads = card.attachments?.filter((a) => a.isUpload) || [];
        if (uploads.length > 0) {
          description +=
            '\n\n--- Attachments ---\n' + uploads.map((a) => `• ${a.name}: ${a.url}`).join('\n');
        }

        // Enhanced parsing from card name and description
        const poMatch = cardName.match(/PO#?\s*:?\s*(\S+)/i) || description.match(/PO#?\s*:?\s*(\S+)/i);
        const po = poMatch ? poMatch[1] : '';

        // Extract part number (common patterns: DASH-123, PART-456-01, etc.)
        const partNumberMatch =
          cardName.match(/([A-Z]+-\d+(?:-\d+)?)/i) || description.match(/([A-Z]+-\d+(?:-\d+)?)/i);
        const partNumber = partNumberMatch ? partNumberMatch[1] : '';

        // Extract quantity (Qty: 100, Quantity: 50, etc.)
        const qtyMatch =
          cardName.match(/(?:Qty|Quantity|QTY)[:：]?\s*(\S+)/i) ||
          description.match(/(?:Qty|Quantity|QTY)[:：]?\s*(\S+)/i);
        const qty = qtyMatch ? qtyMatch[1] : '';

        // Extract due date from description if not in card.due
        let dueDate = card.due || undefined;
        if (!dueDate) {
          const dateMatch = description.match(/(?:Due|Due Date|Deadline)[:：]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i);
          if (dateMatch) {
            const dateStr = dateMatch[1];
            // Try to parse and format
            try {
              const parsed = new Date(dateStr);
              if (!isNaN(parsed.getTime())) {
                dueDate = parsed.toISOString().split('T')[0];
              }
            } catch {
              // Ignore parse errors
            }
          }
        }

        // Extract labor hours from description
        let laborHours: number | undefined = undefined;
        const laborMatch = description.match(/(?:Labor|Hours|Time)[:：]?\s*(\d+(?:\.\d+)?)\s*(?:h|hours?)?/i);
        if (laborMatch) {
          laborHours = parseFloat(laborMatch[1]);
        }

        // Extract bin location
        const binMatch = cardName.match(/\[([A-Z]\d+[a-z]?)\]/i) || description.match(/Bin[:：]?\s*([A-Z]\d+[a-z]?)/i);
        const binLocation = binMatch ? binMatch[1] : undefined;

        const { data: { user } } = await supabase.auth.getUser();
        const createdJob = await jobService.createJob({
          jobCode: nextCode + i,
          name: cardName,
          po: po,
          description: description,
          qty: qty || undefined,
          status: getStatus(listMap.get(card.idList) || ''),
          boardType: 'admin',
          dueDate: dueDate,
          ecd: dueDate,
          laborHours: laborHours,
          active: true,
          isRush: card.labels?.some((l) => l.name?.toLowerCase().includes('rush')) || false,
          createdBy: user?.id ?? undefined,
          binLocation: binLocation,
        });
        if (!createdJob) throw new Error('Failed to create job');
        const job = createdJob;

        results.success++;

        // If part number was found, create or update part in Parts repository
        if (partNumber) {
          try {
            const basePartNumber = partNumber.replace(/-\d+$/, ''); // Remove variant suffix
            const existingPart = await partsService.getPartByNumber(basePartNumber);
            if (!existingPart) {
              // Create master part
              await partsService.createPart({
                partNumber: basePartNumber,
                name: cardName,
                description: description || undefined,
                laborHours: laborHours,
                pricePerSet: undefined, // Will be set later
              });
            } else {
              // Update existing part if needed
              await partsService.updatePart(existingPart.id, {
                description: description || existingPart.description,
                laborHours: laborHours || existingPart.laborHours,
              });
            }
          } catch (partError) {
            console.warn('Failed to create/update part:', partError);
            // Don't fail job import if part creation fails
          }
        }

        const materials = parseMaterials(card.desc || '');
        const trelloLinks = extractTrelloLinks(card.desc || '', card.attachments);

        for (const { material, qty } of materials) {
          const match = findBestMatch(material, inventoryMap);
          if (match) {
            try {
              await jobService.addJobInventory(job.id, match.id, qty, 'units');
              results.linked++;
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'Unknown error';
              console.warn('Failed to link material:', material, msg);
            }
          }
        }

        for (const link of trelloLinks) {
          const urlMatch = link.match(/\/\d+-(.+?)(?:\?|$)/);
          if (urlMatch) {
            const linkCardName = urlMatch[1].replace(/-/g, ' ');
            const match = findBestMatch(linkCardName, inventoryMap);
            if (match) {
              try {
                await jobService.addJobInventory(job.id, match.id, 1, 'units');
                results.linked++;
              } catch {
                // Ignore duplicate or other errors
              }
            }
          }
        }
      } catch (err: unknown) {
        results.failed++;
        errors.push({
          cardName: sanitizeText(card.name) || 'Unknown',
          error: err instanceof Error ? err.message : 'Error',
        });
        console.error(
          `Ã¢ÂÅ’ Failed to import "${card.name}":`,
          err instanceof Error ? err.message : 'Error'
        );
      }

      if (i % 3 === 0 && i > 0) await delay(300);
    }

    setErrorLog(errors);
    return results;
  };

  const importInventory = async (
    cards: TrelloCard[],
    listMap: Map<string, string>,
    cfMap: Map<string, string>
  ): Promise<ImportResult> => {
    const results: ImportResult = { success: 0, failed: 0, linked: 0 };
    const errors: ErrorLog[] = [];

    for (let i = 0; i < cards.length; i++) {
      if (isCancelled) break;

      const card = cards[i];
      setStatus(`Importing ${i + 1}/${cards.length}...`);
      setProgress(Math.round((i / cards.length) * 100));

      try {
        const name = sanitizeText(card.name);
        if (!name) throw new Error('Empty name');

        const vendorMatch = card.desc?.match(/(?:vendor|supplier)[:\s]+([^\n]+)/i);
        const vendor = vendorMatch ? sanitizeText(vendorMatch[1]) : null;

        const inStock = getCustomFieldValue(card, cfMap, 'stock') || 0;
        const available = getCustomFieldValue(card, cfMap, 'available') || inStock;
        const price = getCustomFieldValue(card, cfMap, 'price') || 0;

        await inventoryService.createInventory({
          name: name,
          category: getCategory(listMap.get(card.idList) || ''),
          inStock: Math.max(0, Math.round(inStock)),
          available: Math.max(0, Math.round(available)),
          disposed: 0,
          onOrder: 0,
          price: price > 0 ? price : undefined,
          unit: 'units',
          vendor: vendor,
          hasImage: false,
        });

        results.success++;
      } catch (err: unknown) {
        results.failed++;
        errors.push({
          cardName: sanitizeText(card.name) || 'Unknown',
          error: err instanceof Error ? err.message : 'Error',
        });
        console.error(
          `Ã¢ÂÅ’ Failed to import inventory "${card.name}":`,
          err instanceof Error ? err.message : 'Error'
        );
      }

      if (i % 3 === 0 && i > 0) await delay(300);
    }

    setErrorLog(errors);
    return results;
  };

  const handleImport = async () => {
    if (!trelloData) return;

    setIsImporting(true);
    setIsCancelled(false);
    setProgress(0);
    setResult(null);
    setErrorLog([]);

    try {
      const listMap = new Map<string, string>();
      trelloData.lists.forEach((l) => listMap.set(l.id, l.name));

      const cfMap = new Map<string, string>();
      trelloData.customFields?.forEach((cf) => cfMap.set(cf.id, cf.name.toLowerCase()));

      const cards = trelloData.cards.filter((c) => !c.closed);

      const importResult =
        boardType === 'admin'
          ? await importJobs(cards, listMap, cfMap)
          : await importInventory(cards, listMap, cfMap);

      setResult(importResult);
      setStatus('Complete!');
      setProgress(100);

      // CRITICAL: Wait 2 seconds before callback to prevent crash
      await delay(2000);

      if (importResult.success > 0) {
        onImportComplete();
      }
    } catch (err: unknown) {
      setError(
        `Import failed: ${(err instanceof Error ? err.message : 'Error') || 'Unknown error'}`
      );
      console.error('Ã¢ÂÅ’ Import error:', err);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3">
      <div className="w-full max-w-2xl overflow-hidden rounded-md border border-white/10 bg-card-dark">
        <div className="border-b border-white/10 p-6">
          <h2 className="text-2xl font-bold text-white">Import from Trello</h2>
        </div>

        <div className="space-y-6 p-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">Board Type</label>
            <div className="flex gap-3">
              <button
                onClick={() => setBoardType('admin')}
                disabled={isImporting}
                className={`flex-1 rounded-sm py-3 font-bold transition ${
                  boardType === 'admin'
                    ? 'bg-primary text-white'
                    : 'bg-white/10 text-slate-400 hover:bg-white/15'
                }`}
              >
                Admin Jobs
              </button>
              <button
                onClick={() => setBoardType('inventory')}
                disabled={isImporting}
                className={`flex-1 rounded-sm py-3 font-bold transition ${
                  boardType === 'inventory'
                    ? 'bg-primary text-white'
                    : 'bg-white/10 text-slate-400 hover:bg-white/15'
                }`}
              >
                Inventory
              </button>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">Upload JSON</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              disabled={isImporting}
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              className="w-full rounded-sm border border-white/20 bg-white/10 p-3 text-white focus:border-primary focus:outline-none"
            />
          </div>

          {trelloData && !isImporting && !result && (
            <div className="rounded-sm border border-white/10 bg-white/5 p-3">
              <p className="font-medium text-white">{trelloData.name}</p>
              <p className="text-sm text-slate-400">
                {trelloData.cards.filter((c) => !c.closed).length} cards
              </p>
            </div>
          )}

          {isImporting && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">{status}</span>
                <span className="font-bold text-primary">{progress}%</span>
              </div>
              <div className="h-2 w-full rounded-sm bg-white/10">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-2 rounded-sm border border-white/10 bg-white/5 p-3">
              <div className="flex justify-between">
                <span className="text-green-400">Success:</span>
                <span className="font-bold text-white">{result.success}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-red-400">Failed:</span>
                <span className="font-bold text-white">{result.failed}</span>
              </div>
              {boardType === 'admin' && (
                <div className="flex justify-between">
                  <span className="text-blue-400">Materials Linked:</span>
                  <span className="font-bold text-white">{result.linked}</span>
                </div>
              )}
            </div>
          )}

          {errorLog.length > 0 && (
            <div>
              <button
                onClick={() => setShowErrorLog(!showErrorLog)}
                className="text-sm text-red-400 hover:text-red-300"
              >
                {showErrorLog ? 'Ã¢â€“Â¼' : 'Ã¢â€“Â¶'} {errorLog.length} errors
              </button>
              {showErrorLog && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-sm border border-red-500/20 bg-red-500/10 p-3">
                  {errorLog.map((err, i) => (
                    <div key={i} className="mb-2 text-xs text-red-300">
                      <span className="font-bold">{err.cardName}:</span> {err.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-sm border border-red-500/20 bg-red-500/10 p-3">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 border-t border-white/10 p-6">
          <button
            onClick={onClose}
            disabled={isImporting}
            className="flex-1 rounded-sm bg-white/10 py-3 font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {isImporting ? (
            <button
              onClick={() => setIsCancelled(true)}
              className="flex-1 rounded-sm bg-red-500 py-3 font-bold text-white transition hover:bg-red-600"
            >
              Cancel Import
            </button>
          ) : (
            <button
              onClick={handleImport}
              disabled={!trelloData || isImporting}
              className="flex-1 rounded-sm bg-primary py-3 font-bold text-white transition hover:bg-primary/90 disabled:opacity-50"
            >
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TrelloImport;
