import { describe, it, expect } from 'vitest';
import { parseSlashArgs } from '../../src/tours/slash-arg-parser.js';

describe('parseSlashArgs', () => {
  it('parses "<poi> <mode>"', () => {
    expect(parseSlashArgs('mt.fuji pricing')).toEqual({
      kind: 'ok', poi: 'mt.fuji', mode: 'pricing',
    });
  });

  it('treats "detail" as alias for "scan"', () => {
    expect(parseSlashArgs('mt.fuji detail')).toEqual({
      kind: 'ok', poi: 'mt.fuji', mode: 'scan',
    });
  });

  it('accepts "all"', () => {
    expect(parseSlashArgs('mt.fuji all')).toEqual({
      kind: 'ok', poi: 'mt.fuji', mode: 'all',
    });
  });

  it('handles quoted POI with spaces', () => {
    expect(parseSlashArgs('"mt fuji" pricing')).toEqual({
      kind: 'ok', poi: 'mt fuji', mode: 'pricing',
    });
  });

  it('multi-word POI without quotes joins everything before the trailing mode', () => {
    expect(parseSlashArgs('mt fuji pricing')).toEqual({
      kind: 'ok', poi: 'mt fuji', mode: 'pricing',
    });
  });

  it('asks when only POI given (no mode)', () => {
    const r = parseSlashArgs('mt.fuji');
    expect(r.kind).toBe('ask');
    if (r.kind !== 'ask') throw new Error();
    expect(r.choices.map((c) => c.id)).toEqual(['scan', 'pricing', 'all']);
  });

  it('asks when input is empty', () => {
    expect(parseSlashArgs('').kind).toBe('ask');
  });

  it('asks when input is whitespace only', () => {
    expect(parseSlashArgs('   ').kind).toBe('ask');
  });

  it('rejects unknown mode with helpful error', () => {
    const r = parseSlashArgs('mt.fuji frobnicate');
    expect(r.kind).toBe('error');
    if (r.kind !== 'error') throw new Error();
    expect(r.message).toMatch(/unknown mode.*frobnicate/i);
  });

  it('case-insensitive mode keyword', () => {
    expect(parseSlashArgs('mt.fuji PRICING')).toEqual({
      kind: 'ok', poi: 'mt.fuji', mode: 'pricing',
    });
  });
});
