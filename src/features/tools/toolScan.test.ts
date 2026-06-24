import { describe, it, expect } from 'vitest';
import type { Tool } from '@/core/types';
import {
  binsMatch,
  isToolScanPayload,
  normalizeBin,
  normalizeToolScan,
  resolveToolByScan,
} from './toolScan';

const tool = (over: Partial<Tool>): Tool => ({
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Impact Driver',
  toolNumber: 'T-100',
  homeBin: 'A4c',
  status: 'available',
  ...over,
});

const tools: Tool[] = [
  tool({ id: 'id-1', toolNumber: 'T-100' }),
  tool({ id: 'id-2', toolNumber: 'DRILL-7', name: 'Drill' }),
];

describe('normalizeToolScan / isToolScanPayload', () => {
  it('strips a TOOL: prefix (any case) and trims', () => {
    expect(normalizeToolScan('TOOL:T-100')).toBe('T-100');
    expect(normalizeToolScan('tool: T-100 ')).toBe('T-100');
    expect(normalizeToolScan('  T-100  ')).toBe('T-100');
  });

  it('detects the TOOL: prefix', () => {
    expect(isToolScanPayload('TOOL:T-100')).toBe(true);
    expect(isToolScanPayload('tool:x')).toBe(true);
    expect(isToolScanPayload('T-100')).toBe(false);
    expect(isToolScanPayload('A4c')).toBe(false);
  });
});

describe('resolveToolByScan', () => {
  it('matches by tool number, case-insensitively, with or without prefix', () => {
    expect(resolveToolByScan('T-100', tools)?.id).toBe('id-1');
    expect(resolveToolByScan('TOOL:t-100', tools)?.id).toBe('id-1');
    expect(resolveToolByScan('drill-7', tools)?.id).toBe('id-2');
  });

  it('falls back to matching by id', () => {
    expect(resolveToolByScan('id-2', tools)?.id).toBe('id-2');
  });

  it('returns null for empty or unknown payloads', () => {
    expect(resolveToolByScan('', tools)).toBeNull();
    expect(resolveToolByScan('   ', tools)).toBeNull();
    expect(resolveToolByScan('TOOL:', tools)).toBeNull();
    expect(resolveToolByScan('NOPE-999', tools)).toBeNull();
  });
});

describe('normalizeBin / binsMatch', () => {
  it('normalizes BIN: prefix, whitespace, and case', () => {
    expect(normalizeBin('BIN:A4c')).toBe('A4c'.toUpperCase());
    expect(normalizeBin(' a4c ')).toBe('A4C');
  });

  it('matches bins ignoring case and prefix', () => {
    expect(binsMatch('A4c', 'A4c')).toBe(true);
    expect(binsMatch('BIN:a4c', 'A4c')).toBe(true);
    expect(binsMatch('B2a', 'A4c')).toBe(false);
  });

  it('treats an empty scan as no match', () => {
    expect(binsMatch('', 'A4c')).toBe(false);
    expect(binsMatch('BIN:', 'A4c')).toBe(false);
  });
});
