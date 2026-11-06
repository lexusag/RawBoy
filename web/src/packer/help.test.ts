import { describe, expect, it } from 'vitest';
import { PACKER_HELP } from './help';

describe('PACKER_HELP', () => {
  it('contains structured help sections', () => {
    expect(PACKER_HELP.length).toBeGreaterThan(0);
    for (const section of PACKER_HELP) {
      expect(section.title).toBeTruthy();
      expect(section.items.length).toBeGreaterThan(0);
      for (const item of section.items) {
        expect(item.text).toBeTruthy();
        expect(item.how || (item.keys && item.keys.length > 0)).toBeTruthy();
      }
    }
  });

  it('includes basics, queue, preview, settings and compatibility sections', () => {
    const titles = PACKER_HELP.map((s) => s.title);
    expect(titles).toContain('Basics');
    expect(titles).toContain('Queue and folders');
    expect(titles).toContain('Photo preview');
    expect(titles).toContain('Settings and features');
    expect(titles).toContain('Back to maximum compatibility');
  });
});
