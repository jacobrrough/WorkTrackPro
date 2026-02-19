import React, { useState, useRef } from 'react';
import { JobStatus, InventoryCategory } from '@/core/types';
import { buildJobNameFromConvention } from '@/lib/formatJob';
import { jobService, inventoryService, supabase } from './pocketbase';
import { partsService } from './services/api/parts';

interface TrelloImportProps {
  onClose: () => void;
  onImportComplete: () => void;
}

type BoardType = 'admin' | 'shopFloor' | 'inventory';

interface CustomField {
  id: string;
  name: string;
  type: string;
}

interface CustomFieldItem {
  id: string;
  idCustomField: string;
  value: { number?: string | number; text?: string; date?: string };
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
  const [selectedCardIds, setSelectedCardIds] = useState<Record<string, boolean>>({});
  const [cardListFilter, setCardListFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MATERIAL_CACHE_KEY = 'worktrack_trello_material_cache';
  const materialMatchCacheRef = useRef<Record<string, string> | null>(null);

  const getMaterialMatchCache = (): Record<string, string> => {
    if (materialMatchCacheRef.current === null) {
      try {
        materialMatchCacheRef.current =
          JSON.parse(localStorage.getItem(MATERIAL_CACHE_KEY) || '{}') || {};
      } catch {
        materialMatchCacheRef.current = {};
      }
    }
    return materialMatchCacheRef.current;
  };

  const saveMaterialMatch = (material: string, inventoryId: string) => {
    const key = material.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key) return;
    const cache = getMaterialMatchCache();
    cache[key] = inventoryId;
    try {
      localStorage.setItem(MATERIAL_CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* ignore */
    }
  };

  const normalizeMaterialKey = (material: string): string =>
    material.toLowerCase().replace(/\s+/g, ' ').trim();

  /** Admin format: link in []. Trello URL -> slug (e.g. "123-red-herc-60-yd" -> "red herc 60 yd"). */
  const materialNameFromBracketLink = (bracketContent: string): string => {
    const s = bracketContent.trim();
    const trelloMatch = s.match(/trello\.com\/c\/[\w-]+\/(\d+-[\w-]+)/i);
    if (trelloMatch) {
      return trelloMatch[1].replace(/-/g, ' ').replace(/^\d+\s*/, '').trim();
    }
    return s;
  };

  /** When a material can't be matched, we show a modal and resolve this with the picked inventory id or null (skip). */
  const [unmatchedPrompt, setUnmatchedPrompt] = useState<{
    material: string;
    qty: number;
    jobName: string;
    inventoryList: { id: string; name: string }[];
  } | null>(null);
  const [unmatchedSearch, setUnmatchedSearch] = useState('');
  const [unmatchedSelectedId, setUnmatchedSelectedId] = useState<string | null>(null);
  const unmatchedResolverRef = useRef<((inventoryId: string | null) => void) | null>(null);

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Pause import and ask user to pick an inventory item for an unmatched material. Returns inventory id or null (skip). */
  const promptForUnmatchedMaterial = (
    material: string,
    qty: number,
    jobName: string,
    inventoryMap: Map<string, { id: string; name: string }>
  ): Promise<string | null> => {
    return new Promise((resolve) => {
      unmatchedResolverRef.current = resolve;
      setUnmatchedSearch('');
      setUnmatchedSelectedId(null);
      setUnmatchedPrompt({
        material,
        qty,
        jobName,
        inventoryList: Array.from(inventoryMap.entries()).map(([id, v]) => ({ id, name: v.name })),
      });
    });
  };

  const handleUnmatchedLink = () => {
    if (unmatchedSelectedId && unmatchedPrompt) {
      saveMaterialMatch(unmatchedPrompt.material, unmatchedSelectedId);
      unmatchedResolverRef.current?.(unmatchedSelectedId);
      unmatchedResolverRef.current = null;
      setUnmatchedPrompt(null);
    }
  };

  const handleUnmatchedSkip = () => {
    unmatchedResolverRef.current?.(null);
    unmatchedResolverRef.current = null;
    setUnmatchedPrompt(null);
  };

  // If user cancels import while the picker is open, resolve with null so the loop can exit
  React.useEffect(() => {
    if (isCancelled && unmatchedPrompt) {
      unmatchedResolverRef.current?.(null);
      unmatchedResolverRef.current = null;
      setUnmatchedPrompt(null);
    }
  }, [isCancelled, unmatchedPrompt]);

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

  /** Normalize spacing so "10YARDS", "10 YARDSRed", "1/4"WHITE", "10 YARDS[link]" parse correctly. */
  const normalizeMaterialLineSpacing = (text: string): string => {
    return text
      .replace(/(\d)(YARDS?|SHEETS?|SHEET|EA|EACH|UNITS?)(\s|$)/gi, '$1 $2$3')
      .replace(/(YARDS?|SHEETS?|SHEET|EA|EACH|UNITS?)([A-Za-z])/gi, '$1 $2')
      .replace(/([A-Za-z0-9"])(\[)/g, '$1 $2')
      .replace(/"\s*(\w)/g, '" $1')
      .replace(/(\d)\s*([x×])\s*/gi, '$1 $2 ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const parseMaterials = (
    description: string
  ): Array<{ material: string; qty: number; unit?: string }> => {
    const materials: Array<{ material: string; qty: number; unit?: string }> = [];
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

      if (
        inMaterials &&
        /^[A-Z][a-z]+[:：]\s*$/.test(line) &&
        !materialKeywords.some((p) => p.test(line))
      ) {
        const nextLines = lines
          .slice(i + 1, i + 3)
          .join(' ')
          .trim();
        if (!nextLines || !/[\d•\-*]/.test(nextLines)) {
          break;
        }
      }

      if (inMaterials || /^[•\-*\d.\s]/.test(line)) {
        const rawCleaned = line
          .replace(/^[•\-*\d.)]\s*/, '')
          .replace(/^\((\d+)\)\s*/, '$1 ')
          .trim();
        const cleaned = normalizeMaterialLineSpacing(rawCleaned);

        if (cleaned.length < 2 || /^[A-Z][a-z]+[:：]\s*$/.test(cleaned)) continue;
        if (/\bSCRAP\b/i.test(cleaned)) continue;

        let qty = 1;
        let materialName = cleaned;
        let parsedUnit: string | undefined;

        // Admin format: NUMBER, optional unit/text, then [LINK]. Use only content inside [] for material.
        const bracketLinkMatch = cleaned.match(/^(\d+)\s+.*?\[([^\]]+)\]/);
        if (bracketLinkMatch) {
          qty = parseInt(bracketLinkMatch[1], 10);
          materialName = materialNameFromBracketLink(bracketLinkMatch[2]);
          parsedUnit = undefined;
        } else {
        const adminBracketMatch = cleaned.match(
          /^(\d+)\s+(YARDS?|SHEETS?|SHEET|EA|EACH|UNITS?)?\s*\[([^\]]+)\]$/i
        );
        if (adminBracketMatch) {
          qty = parseInt(adminBracketMatch[1], 10);
          materialName = materialNameFromBracketLink(adminBracketMatch[3]);
          parsedUnit = adminBracketMatch[2];
        } else {
        const qtyUnitName = cleaned.match(/^(\d+)\s+(YARDS?|SHEETS?|SHEET|EA|EACH|UNITS?)\s+(.+)$/i);
        if (qtyUnitName) {
          qty = parseInt(qtyUnitName[1], 10);
          materialName = qtyUnitName[3].trim();
          parsedUnit = qtyUnitName[2];
        } else {
          const qtyPrefix = cleaned.match(/^(\d+)\s*x?\s+(.+)$/i);
          if (qtyPrefix) {
            qty = parseInt(qtyPrefix[1], 10);
            materialName = qtyPrefix[2];
            parsedUnit = undefined;
          } else {
          const qtySuffix = cleaned.match(/^(.+?)\s+(?:x|Ãƒâ€”|\()(\d+)\)?$/i);
          if (qtySuffix) {
            materialName = qtySuffix[1];
            qty = parseInt(qtySuffix[2], 10);
            parsedUnit = undefined;
          } else parsedUnit = undefined;
          }
        }
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
            !/^(note|note:|important|warning|tip|instructions?|steps?|process|procedure)/i.test(
              materialName
            ) &&
            !/^[A-Z][a-z]+\s*[:：]\s*$/.test(materialName) &&
            materialName.length <= 200;

          if (isLikelyMaterial) {
            materials.push({ material: materialName, qty, unit: parsedUnit });
          }
        }
      }
    }

    // Also try to extract materials from inline text if no materials found in lists
    if (materials.length === 0) {
      const descWithSpacing = normalizeMaterialLineSpacing(
        normalized.replace(/\n/g, ' ')
      );
      const inlinePatterns = [
        /(?:need|needs|requires?|use|uses?|with)\s+(\d+\.?\d*)\s*[x×]?\s*([A-Za-z][^.!?;,\n]{2,50})/gi,
        /(\d+\.?\d*)\s*[x×]\s*([A-Za-z][^.!?;,\n]{2,50})/gi,
        /(\d+)\s+(YARDS?|SHEETS?|SHEET|EA|EACH|UNITS?)\s+([A-Za-z][^.!?;,\n]{2,80})/gi,
      ];

      for (const pattern of inlinePatterns) {
        let match;
        const searchText = pattern.source.includes('YARDS') ? descWithSpacing : description;
        while ((match = pattern.exec(searchText)) !== null) {
          const qty = parseFloat(match[1]);
          const material = (match[3] ?? match[2]).trim();
          const unit = match[3] != null ? match[2] : undefined;
          if (qty > 0 && qty <= 100000 && material.length >= 2 && material.length <= 200) {
            const exists = materials.some(
              (m) => m.material.toLowerCase() === material.toLowerCase()
            );
            if (!exists) {
              materials.push({ material, qty, unit });
            }
          }
        }
      }
    }

    return materials;
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
      const parsed: Record<string, unknown> = JSON.parse(text);
      // Normalize: support root-level or nested board (e.g. data.board?.cards)
      const data: TrelloExport = {
        name: (parsed.name as string) ?? (parsed as TrelloExport).name ?? 'Board',
        cards: (parsed.cards ?? (parsed as { board?: { cards?: TrelloCard[] } }).board?.cards) as TrelloCard[] ?? [],
        lists: (parsed.lists ?? (parsed as { board?: { lists?: TrelloList[] } }).board?.lists) as TrelloList[] ?? [],
        customFields: (parsed.customFields ?? (parsed as { board?: { customFields?: CustomField[] } }).board?.customFields) as CustomField[] | undefined,
      };

      if (!data.cards || !Array.isArray(data.cards)) {
        setError('Invalid Trello export.');
        return;
      }

      setTrelloData(data);
      const openCards = data.cards.filter((c: TrelloCard) => !c.closed);
      setSelectedCardIds(Object.fromEntries(openCards.map((c: TrelloCard) => [c.id, true])));
      setCardListFilter('');
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
    fieldNameOrAliases: string | string[],
    options?: { excludeIfNameContains?: string }
  ): number | null => {
    if (!card.customFieldItems) return null;
    const aliases = Array.isArray(fieldNameOrAliases)
      ? fieldNameOrAliases
      : [fieldNameOrAliases];
    const exclude = options?.excludeIfNameContains?.toLowerCase();

    try {
      for (const item of card.customFieldItems) {
        const cfName = cfMap.get(item.idCustomField)?.toLowerCase() ?? '';
        if (exclude && cfName.includes(exclude)) continue;
        const matches = aliases.some((a) => cfName.includes(a.toLowerCase()));
        if (!matches) continue;

        const v = item.value;
        if (v?.number !== undefined && v?.number !== null) {
          const n = typeof v.number === 'number' ? v.number : parseFloat(String(v.number));
          if (!isNaN(n)) return n;
        }
        if (v?.text) {
          const n = parseFloat(v.text);
          if (!isNaN(n)) return n;
        }
      }
    } catch {
      // Ignore errors when parsing custom fields
    }
    return null;
  };

  /** Parse unit type from Trello card description (e.g. "Measured in yards", "MEASURED IN YARDS", "Unit: sheets"). */
  const parseUnitFromDescription = (desc: string): string => {
    if (!desc || !desc.trim()) return 'units';
    const lower = desc.toLowerCase().trim();
    const yardMatch = lower.match(/(?:measured\s+in|unit[s]?\s*[:=]|in)\s*yards?/i) || lower.match(/\byards?\b/);
    if (yardMatch) return 'yards';
    const sheetMatch = lower.match(/(?:measured\s+in|unit[s]?\s*[:=]|in)\s*sheets?/i) || lower.match(/\bsheets?\b/);
    if (sheetMatch) return 'sheets';
    const eachMatch = lower.match(/(?:measured\s+in|unit[s]?\s*[:=]|in)\s*(?:each|ea\b)/i) || lower.match(/\b(?:each|ea)\b/);
    if (eachMatch) return 'each';
    const rollMatch = lower.match(/\brolls?\b/);
    if (rollMatch) return 'rolls';
    const lbMatch = lower.match(/\b(?:lbs?|pounds?)\b/);
    if (lbMatch) return 'lbs';
    return 'units';
  };

  /** Normalize unit string to a canonical form (yards, sheets, each, lbs, rolls, units). */
  const normalizeUnit = (u: string): string => {
    const t = u.toLowerCase().trim();
    if (!t) return 'units';
    if (/^yards?$/.test(t)) return 'yards';
    if (/^sheets?$/.test(t)) return 'sheets';
    if (/^(each|ea)$/.test(t)) return 'each';
    if (/^rolls?$/.test(t)) return 'rolls';
    if (/^(lbs?|pounds?)$/.test(t)) return 'lbs';
    return t || 'units';
  };

  const getCustomFieldDate = (
    card: TrelloCard,
    cfMap: Map<string, string>,
    fieldName: string
  ): string | null => {
    if (!card.customFieldItems) return null;
    try {
      for (const item of card.customFieldItems) {
        const name = cfMap.get(item.idCustomField)?.toLowerCase() ?? '';
        if (name.includes(fieldName.toLowerCase()) && item.value?.date) {
          const d = item.value.date;
          if (typeof d === 'string') return d.split('T')[0] ?? d;
        }
      }
    } catch {
      // Ignore
    }
    return null;
  };

  const getCustomFieldText = (
    card: TrelloCard,
    cfMap: Map<string, string>,
    fieldName: string
  ): string | null => {
    if (!card.customFieldItems) return null;
    try {
      for (const item of card.customFieldItems) {
        const name = cfMap.get(item.idCustomField)?.toLowerCase() ?? '';
        if (name.includes(fieldName.toLowerCase()) && item.value?.text) {
          return String(item.value.text).trim() || null;
        }
      }
    } catch {
      // Ignore
    }
    return null;
  };

  const importJobs = async (
    cards: TrelloCard[],
    listMap: Map<string, string>,
    cfMap: Map<string, string>
  ): Promise<ImportResult> => {
    const results: ImportResult = { success: 0, failed: 0, linked: 0 };
    const errors: ErrorLog[] = [];

    setStatus('Loading inventory...');
    const inventoryMap = new Map<string, { id: string; name: string }>();
    try {
      const inv = await inventoryService.getAllInventory();
      inv.forEach((i) => inventoryMap.set(i.id, { id: i.id, name: i.name }));
    } catch (err) {
      console.error('Failed to load inventory:', err);
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
        const poMatch =
          cardName.match(/PO#?\s*:?\s*(\d+)/i) || description.match(/PO#?\s*:?\s*(\d+)/i);
        const po = poMatch ? poMatch[1] : '';

        // Part number: SK-02P-0120, SK-F35-1719, etc.
        const partNumberMatch =
          cardName.match(/(SK-[A-Z0-9]+(?:-[A-Z0-9]+)*)/i) ||
          description.match(/(SK-[A-Z0-9]+(?:-[A-Z0-9]+)*)/i);
        const partNumber = partNumberMatch ? partNumberMatch[1] : '';

        // OWR# (Order/Work Request)
        const owrMatch =
          description.match(/OWR#?\s*:?\s*(\d+)/i) || cardName.match(/OWR#?\s*:?\s*(\d+)/i) ||
          description.match(/OWR-(\d+)/i) ||
          description.match(/JC\s*#?\s*:?\s*(\d+)/i);
        const owrNumber = owrMatch ? owrMatch[1] : undefined;

        // EST#, RFQ#, INV# from description
        const estMatch = description.match(/EST\s*#?\s*:?\s*(\d+)/i) || cardName.match(/EST\s*#?\s*(\d+)/i);
        const estNumber = estMatch ? estMatch[1] : undefined;
        const rfqMatch = description.match(/RFQ\s*#?\s*:?\s*(\d+)/i);
        const rfqNumber = rfqMatch ? rfqMatch[1] : undefined;
        const invMatch = description.match(/INV\s*#?\s*:?\s*(\d+)/i);
        const invNumber = invMatch ? invMatch[1] : undefined;

        // Part name: "PART NAME: X" or text between part number and " Rev " (e.g. Tank Entry Land Slide)
        let partName = '';
        const partNameLine = description.match(/PART\s*NAME\s*[:]?\s*([^\n]+?)(?=\n|$)/i) ||
          description.match(/(?:^|\n)NAME\s*[:]?\s*([^\n]+?)(?=\n|$)/i);
        if (partNameLine) partName = partNameLine[1].trim();
        else if (partNumber) {
          const escaped = partNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const afterPart = description.match(
            new RegExp(`${escaped}\\s*([A-Za-z][A-Za-z0-9\\s\\-'"]*?)\\s+Rev\\s+[A-Z0-9]`, 'i')
          );
          if (afterPart) partName = afterPart[1].trim();
        }

        // Revision: word boundary so "Rev B" gives B not BQTY
        const revMatch =
          description.match(/Rev(?:ision)?\s*[:]?\s*([A-Z0-9]+)\b/i) ||
          cardName.match(/Rev(?:ision)?\s*[:]?\s*([A-Z0-9]+)\b/i);
        const revision = revMatch ? revMatch[1].trim() : undefined;

        // Qty: only digits/spaces/commas/dashes/x, stop at EST# or next keyword
        const qtyMatch =
          cardName.match(/(?:Qty|Quantity|QTY)[:：]?\s*([\d\s,\-xX]+?)(?=\s*EST#|\s*RFQ#|\s*PO#|\n|$)/i) ||
          description.match(/(?:Qty|Quantity|QTY)[:：]?\s*([\d\s,\-xX]+?)(?=\s*EST#|\s*RFQ#|\s*PO#|\n|$)/i);
        const qtyRaw = qtyMatch ? qtyMatch[1].trim() : '';
        const qty = qtyRaw;

        // Dash quantities from "5 X -01, 5 X -02, 5 X -03" -> { "-01": 5, "-02": 5, ... }
        let dashQuantities: Record<string, number> | undefined;
        const dashPairs = qtyRaw.matchAll(/(\d+)\s*[xX]\s*(-\d+)/g);
        const dashArr = [...dashPairs];
        if (dashArr.length > 0) {
          dashQuantities = {};
          for (const m of dashArr) {
            const suffix = m[2];
            const num = parseInt(m[1], 10);
            if (!isNaN(num) && suffix) dashQuantities[suffix] = num;
          }
        }

        // Due date: from custom field first, then card.due, then description
        let dueDate =
          getCustomFieldDate(card, cfMap, 'Delivery Date') ||
          getCustomFieldDate(card, cfMap, 'delivery date') ||
          (card.due ? String(card.due).split('T')[0] : undefined);
        if (!dueDate) {
          const dateMatch = description.match(
            /(?:Due|Due Date|Deadline)[:：]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i
          );
          if (dateMatch) {
            try {
              const parsed = new Date(dateMatch[1]);
              if (!isNaN(parsed.getTime())) dueDate = parsed.toISOString().split('T')[0];
            } catch {
              // Ignore
            }
          }
        }
        const ecd =
          getCustomFieldDate(card, cfMap, 'ECD') ||
          (card.due ? String(card.due).split('T')[0] : undefined) ||
          dueDate;

        // JOB CODE and ADDITIONAL STENCILING from custom fields -> append to description if missing
        const jobCodeText = getCustomFieldText(card, cfMap, 'JOB CODE');
        const additionalStencil = getCustomFieldText(card, cfMap, 'ADDITIONAL STENCIL');
        if (jobCodeText && !description.match(/JC\s*#/i)) {
          description += (description ? '\n' : '') + `JC# ${jobCodeText}`;
        }
        if (additionalStencil) {
          description += (description ? '\n' : '') + `ADDITIONAL STENCILING: ${additionalStencil}`;
        }

        // Extract labor hours from description
        let laborHours: number | undefined = undefined;
        const laborMatch = description.match(
          /(?:Labor|Hours|Time)[:：]?\s*(\d+(?:\.\d+)?)\s*(?:h|hours?)?/i
        );
        if (laborMatch) {
          laborHours = parseFloat(laborMatch[1]);
        }

        // Extract bin location
        const binMatch =
          cardName.match(/\[([A-Z]\d+[a-z]?)\]/i) ||
          description.match(/Bin[:：]?\s*([A-Z]\d+[a-z]?)/i);
        const binLocation = binMatch ? binMatch[1] : undefined;

        // Create or update part BEFORE the job so jobs.part_number FK to parts.part_number is satisfied.
        // jobs.part_number must equal parts.part_number (base only); variant is in dash_quantities.
        let partId: string | undefined;
        const basePartNumber = partNumber ? partNumber.replace(/-\d+$/, '') : '';
        if (partNumber) {
          try {
            const existingPart = await partsService.getPartByNumber(basePartNumber);
            const refParts: string[] = [];
            if (estNumber) refParts.push(`EST# ${estNumber}`);
            if (rfqNumber) refParts.push(`RFQ# ${rfqNumber}`);
            if (po) refParts.push(`PO# ${po}`);
            if (invNumber) refParts.push(`INV# ${invNumber}`);
            const referenceLine =
              refParts.length > 0 ? `\n\nReference: ${refParts.join(', ')}` : '';
            const partDescription =
              (description || '').trim() + referenceLine || undefined;

            if (!existingPart) {
              const created = await partsService.createPart({
                partNumber: basePartNumber,
                name: partName || cardName,
                description: partDescription || undefined,
                laborHours: laborHours,
                pricePerSet: undefined,
              });
              if (created) partId = created.id;
            } else {
              await partsService.updatePart(existingPart.id, {
                name: partName || existingPart.name,
                description: partDescription || existingPart.description,
                laborHours: laborHours ?? existingPart.laborHours,
              });
              partId = existingPart.id;
            }
          } catch (partError) {
            console.warn('Failed to create/update part:', partError);
          }
        }

        const statusFromList = getStatus(listMap.get(card.idList) || '');
        const jobNameFromConvention = buildJobNameFromConvention({
          partNumber: partNumber || undefined,
          revision,
          estNumber,
          po: po || undefined,
          status: statusFromList,
        });
        const jobName = jobNameFromConvention.trim() || cardName;

        const {
          data: { user },
        } = await supabase.auth.getUser();
        const createdJob = await jobService.createJob({
          name: jobName,
          po: po,
          description: '', // Cleared after import; do not store raw Trello card text
          qty: qty || undefined,
          status: statusFromList,
          boardType: boardType === 'shopFloor' ? 'shopFloor' : 'admin',
          dueDate: dueDate,
          ecd: ecd,
          laborHours: laborHours,
          active: true,
          isRush: card.labels?.some((l) => l.name?.toLowerCase().includes('rush')) || false,
          createdBy: user?.id ?? undefined,
          binLocation: binLocation,
          owrNumber: owrNumber,
          estNumber: estNumber,
          rfqNumber: rfqNumber,
          invNumber: invNumber,
          partNumber: partId ? basePartNumber || undefined : undefined,
          revision,
          dashQuantities,
          partId,
        });
        if (!createdJob) throw new Error('Failed to create job');
        const job = createdJob;

        results.success++;

        // Materials: use description only (qty, unit, name). Linked Trello cards in attachments
        // are the same materials — do not add from links/attachments or we duplicate.
        const materials = parseMaterials(card.desc || '');
        for (const { material, qty, unit: parsedUnit } of materials) {
          let match = findBestMatch(material, inventoryMap);
          if (!match) {
            const cacheKey = normalizeMaterialKey(material);
            const cachedId = getMaterialMatchCache()[cacheKey];
            if (cachedId && inventoryMap.has(cachedId)) {
              match = { id: cachedId, name: '' };
            }
          }
          if (!match) {
            const pickedId = await promptForUnmatchedMaterial(
              material,
              qty,
              cardName,
              inventoryMap
            );
            if (pickedId) {
              match = { id: pickedId, name: '' };
              saveMaterialMatch(material, pickedId);
            }
          }
          if (match) {
            const unitForJob = parsedUnit ? normalizeUnit(parsedUnit) : 'units';
            try {
              await jobService.addJobInventory(job.id, match.id, qty, unitForJob);
              results.linked++;
              if (unitForJob !== 'units') {
                try {
                  await inventoryService.updateInventory(match.id, { unit: unitForJob });
                } catch {
                  // Non-blocking: inventory unit update is best-effort
                }
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'Unknown error';
              console.warn('Failed to link material:', material, msg);
            }
          }
        }

        // File attachments: download from Trello URL and upload to Supabase (default admin-only)
        const fileAttachments = card.attachments?.filter(
          (a) => a.url && !a.url.includes('trello.com/c/')
        ) ?? [];
        for (const att of fileAttachments) {
          try {
            setStatus(`Importing attachment ${att.name || 'file'}...`);
            const res = await fetch(att.url, { mode: 'cors' });
            if (!res.ok) continue;
            const blob = await res.blob();
            const filename = att.name || att.url.split('/').pop() || 'attachment';
            const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
            await jobService.addAttachment(job.id, file, true);
          } catch {
            // Trello URLs may require auth or CORS; skip on failure
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

        // Match specific field names so we don't use "Stock Value" for quantity or "Add to Disposed" for disposed count
        const inStock = getCustomFieldValue(card, cfMap, 'in stock') ?? 0;
        const availableVal = getCustomFieldValue(card, cfMap, 'available');
        const available = availableVal !== null ? availableVal : inStock;
        const disposed = getCustomFieldValue(card, cfMap, 'disposed', {
          excludeIfNameContains: 'add to',
        }) ?? 0;
        const price = getCustomFieldValue(card, cfMap, 'price') ?? 0;

        const unitFromField = getCustomFieldText(card, cfMap, 'unit');
        const rawUnit = unitFromField
          ? unitFromField.toLowerCase().replace(/\s+/g, ' ').trim()
          : parseUnitFromDescription(card.desc ?? '');
        const unit = normalizeUnit(rawUnit);

        await inventoryService.createInventory({
          name: name,
          category: getCategory(listMap.get(card.idList) || ''),
          inStock: Math.round(inStock),
          available: Math.round(available),
          disposed: Math.round(disposed),
          onOrder: 0,
          price: price > 0 ? price : undefined,
          unit,
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

      const openCards = trelloData.cards.filter((c) => !c.closed);
      const cards = openCards.filter((c) => selectedCardIds[c.id] === true);

      if (cards.length === 0) {
        setError('No cards selected. Select at least one card to import.');
        setIsImporting(false);
        return;
      }

      const importResult =
        boardType === 'inventory'
          ? await importInventory(cards, listMap, cfMap)
          : await importJobs(cards, listMap, cfMap);

      setResult(importResult);
      setStatus('Complete!');
      setProgress(100);
      if (importResult.failed > 0) setShowErrorLog(true);
    } catch (err: unknown) {
      setError(
        `Import failed: ${(err instanceof Error ? err.message : 'Error') || 'Unknown error'}`
      );
      console.error('Ã¢ÂÅ’ Import error:', err);
    } finally {
      setIsImporting(false);
    }
  };

  const filteredUnmatchedList = unmatchedPrompt
    ? unmatchedPrompt.inventoryList.filter((item) =>
        item.name.toLowerCase().includes(unmatchedSearch.toLowerCase().trim())
      )
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3">
      {/* Modal: pick inventory for unmatched material */}
      {unmatchedPrompt && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-md border border-white/20 bg-card-dark p-4 shadow-xl">
            <h3 className="mb-2 text-lg font-bold text-white">No match for this material</h3>
            <p className="mb-1 text-sm text-slate-300">
              <span className="font-medium">{unmatchedPrompt.material}</span>
              {unmatchedPrompt.qty > 1 && (
                <span className="ml-1 text-slate-400">(qty: {unmatchedPrompt.qty})</span>
              )}
            </p>
            <p className="mb-3 text-xs text-slate-500">Job: {unmatchedPrompt.jobName}</p>
            <input
              type="text"
              value={unmatchedSearch}
              onChange={(e) => setUnmatchedSearch(e.target.value)}
              placeholder="Search inventory..."
              className="mb-3 w-full rounded border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:outline-none"
            />
            <div className="mb-4 max-h-48 overflow-y-auto rounded border border-white/10 bg-white/5">
              {filteredUnmatchedList.length === 0 ? (
                <p className="p-3 text-center text-sm text-slate-500">No inventory items match</p>
              ) : (
                filteredUnmatchedList.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setUnmatchedSelectedId(item.id)}
                    className={`block w-full px-3 py-2 text-left text-sm transition ${
                      unmatchedSelectedId === item.id
                        ? 'bg-primary/30 text-white'
                        : 'text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {item.name}
                  </button>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleUnmatchedLink}
                disabled={!unmatchedSelectedId}
                className="flex-1 rounded-sm bg-primary py-2.5 font-bold text-white transition hover:bg-primary/90 disabled:opacity-50 disabled:hover:bg-primary"
              >
                Link to selected
              </button>
              <button
                type="button"
                onClick={handleUnmatchedSkip}
                className="rounded-sm border border-white/20 bg-white/10 py-2.5 px-4 font-bold text-white transition hover:bg-white/20"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-2xl overflow-hidden rounded-md border border-white/10 bg-card-dark">
        <div className="border-b border-white/10 p-6">
          <h2 className="text-2xl font-bold text-white">Import from Trello</h2>
        </div>

        <div className="space-y-6 p-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">Board Type</label>
            <div className="flex gap-2">
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
                onClick={() => setBoardType('shopFloor')}
                disabled={isImporting}
                className={`flex-1 rounded-sm py-3 font-bold transition ${
                  boardType === 'shopFloor'
                    ? 'bg-primary text-white'
                    : 'bg-white/10 text-slate-400 hover:bg-white/15'
                }`}
              >
                Shop Floor
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

          {trelloData && !isImporting && !result && (() => {
            const openCards = trelloData.cards
              .filter((c) => !c.closed)
              .map((c) => ({
                ...c,
                listName: trelloData.lists?.find((l) => l.id === c.idList)?.name ?? 'Unknown',
              }))
              .filter(
                (c) =>
                  !cardListFilter.trim() ||
                  c.name.toLowerCase().includes(cardListFilter.toLowerCase().trim()) ||
                  c.listName.toLowerCase().includes(cardListFilter.toLowerCase().trim())
              )
              .sort((a, b) => a.listName.localeCompare(b.listName) || a.name.localeCompare(b.name));
            const totalOpen = trelloData.cards.filter((c) => !c.closed).length;
            const selectedCount = totalOpen && Object.keys(selectedCardIds).length
              ? trelloData.cards.filter((c) => !c.closed && selectedCardIds[c.id]).length
              : totalOpen;
            return (
              <div className="space-y-3 rounded-sm border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-white">{trelloData.name}</p>
                  <p className="text-sm text-slate-400">
                    {selectedCount} of {totalOpen} cards selected
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="Filter by card or list name..."
                    value={cardListFilter}
                    onChange={(e) => setCardListFilter(e.target.value)}
                    className="min-w-0 flex-1 rounded-sm border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedCardIds((prev) => {
                        const next = { ...prev };
                        trelloData.cards.filter((c) => !c.closed).forEach((c) => (next[c.id] = true));
                        return next;
                      })
                    }
                    className="rounded-sm border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/15"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedCardIds((prev) => {
                        const next = { ...prev };
                        trelloData.cards.filter((c) => !c.closed).forEach((c) => (next[c.id] = false));
                        return next;
                      })
                    }
                    className="rounded-sm border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/15"
                  >
                    Deselect all
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto rounded border border-white/10 bg-black/20">
                  <ul className="divide-y divide-white/10">
                    {openCards.length === 0 ? (
                      <li className="px-3 py-4 text-center text-sm text-slate-400">
                        {cardListFilter.trim() ? 'No cards match the filter.' : 'No open cards.'}
                      </li>
                    ) : (
                      openCards.map((card) => (
                        <li key={card.id} className="flex items-center gap-3 px-3 py-2">
                          <input
                            type="checkbox"
                            id={`card-${card.id}`}
                            checked={selectedCardIds[card.id] === true}
                            onChange={() =>
                              setSelectedCardIds((prev) => ({
                                ...prev,
                                [card.id]: !prev[card.id],
                              }))
                            }
                            className="h-5 w-5 shrink-0 rounded border-white/30 bg-white/10 text-primary focus:ring-primary"
                          />
                          <label
                            htmlFor={`card-${card.id}`}
                            className="min-w-0 flex-1 cursor-pointer text-sm text-white"
                          >
                            <span className="font-medium">{card.name}</span>
                            <span className="ml-2 text-slate-400">— {card.listName}</span>
                          </label>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            );
          })()}

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
                {showErrorLog ? 'Hide' : 'Show'} {errorLog.length} errors
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
            {result ? 'Cancel' : 'Close'}
          </button>
          {isImporting ? (
            <button
              onClick={() => setIsCancelled(true)}
              className="flex-1 rounded-sm bg-red-500 py-3 font-bold text-white transition hover:bg-red-600"
            >
              Cancel Import
            </button>
          ) : result ? (
            <button
              onClick={() => {
                if (result.success > 0) onImportComplete();
                onClose();
              }}
              className="flex-1 rounded-sm bg-primary py-3 font-bold text-white transition hover:bg-primary/90"
            >
              Finish
            </button>
          ) : (
            <button
              onClick={handleImport}
              disabled={!trelloData}
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
