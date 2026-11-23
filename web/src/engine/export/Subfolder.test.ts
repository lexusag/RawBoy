import { describe, expect, it } from 'vitest';
import { cleanSubfolder } from './Subfolder';

const day = new Date(2026, 10, 3);

describe('cleanSubfolder', () => {
  it('keeps a plain name and trims it', () => {
    expect(cleanSubfolder('Paris')).toBe('Paris');
    expect(cleanSubfolder('  Paris 2026  ')).toBe('Paris 2026');
    expect(cleanSubfolder('')).toBe('');
    expect(cleanSubfolder('   ')).toBe('');
  });

  it('fills in {date}', () => {
    expect(cleanSubfolder('Export {date}', day)).toBe('Export 2026-11-03');
    expect(cleanSubfolder('{DATE}', day)).toBe('2026-11-03');
  });

  it('turns separators and refused characters into dashes, one level only', () => {
    expect(cleanSubfolder('a/b\\c')).toBe('a-b-c');
    expect(cleanSubfolder('a:b*c?"d<e>f|g')).toBe('a-b-c--d-e-f-g');
    expect(cleanSubfolder('x\ny')).toBe('x-y');
  });

  it('never gives ".." or a hidden or dotted-out name', () => {
    expect(cleanSubfolder('..')).toBe('');
    expect(cleanSubfolder('../..')).toBe('-');
    expect(cleanSubfolder('.hidden')).toBe('hidden');
    expect(cleanSubfolder('name.')).toBe('name');
    expect(cleanSubfolder(' . ')).toBe('');
  });

  it('caps the length', () => {
    expect(cleanSubfolder('a'.repeat(300))).toHaveLength(100);
  });
});
