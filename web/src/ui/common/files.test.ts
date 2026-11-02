import { describe, expect, it } from 'vitest';
import { isRawFileName, readDroppedFiles } from './files';

describe('isRawFileName', () => {
  it('accepts raw and DNG extensions case-insensitively', () => {
    expect(isRawFileName('photo.dng')).toBe(true);
    expect(isRawFileName('photo.DNG')).toBe(true);
    expect(isRawFileName('DSC001.ARW')).toBe(true);
    expect(isRawFileName('IMG_001.CR3')).toBe(true);
    expect(isRawFileName('DSC_0001.NEF')).toBe(true);
    expect(isRawFileName('FUJI001.RAF')).toBe(true);
  });

  it('rejects non-raw files, metadata, and hidden files', () => {
    expect(isRawFileName('photo.jpg')).toBe(false);
    expect(isRawFileName('photo.jpeg')).toBe(false);
    expect(isRawFileName('sidecar.xmp')).toBe(false);
    expect(isRawFileName('notes.txt')).toBe(false);
    expect(isRawFileName('Thumbs.db')).toBe(false);
    expect(isRawFileName('.DS_Store')).toBe(false);
    expect(isRawFileName('no_extension')).toBe(false);
  });
});

describe('readDroppedFiles', () => {
  it('filters out non-raw files from files fallback', async () => {
    const rawFile = new File(['raw'], 'photo.arw');
    const jpgFile = new File(['jpg'], 'photo.jpg');
    const xmpFile = new File(['xmp'], 'photo.xmp');
    const txtFile = new File(['txt'], 'readme.txt');
    const dbFile = new File(['db'], 'Thumbs.db');
    const hiddenFile = new File(['hidden'], '.DS_Store');

    const dt = {
      items: [],
      files: [rawFile, jpgFile, xmpFile, txtFile, dbFile, hiddenFile],
    } as unknown as DataTransfer;

    const result = await readDroppedFiles(dt);
    expect(result).toHaveLength(1);
    expect(result[0].file.name).toBe('photo.arw');
  });

  it('filters out non-raw files and hidden files during directory traversal', async () => {
    const rawFile = new File(['raw'], 'DSC001.ARW');
    const jpgFile = new File(['jpg'], 'DSC001.JPG');
    const xmpFile = new File(['xmp'], 'DSC001.xmp');
    const dbFile = new File(['db'], 'Thumbs.db');

    const makeFileEntry = (file: File) => ({
      isFile: true,
      isDirectory: false,
      name: file.name,
      file: (cb: (f: File) => void) => cb(file),
    });

    const entries = [
      makeFileEntry(rawFile),
      makeFileEntry(jpgFile),
      makeFileEntry(xmpFile),
      makeFileEntry(dbFile),
    ];

    let read = false;
    const dirReader = {
      readEntries: (cb: (entries: unknown[]) => void) => {
        if (!read) {
          read = true;
          cb(entries);
        } else {
          cb([]);
        }
      },
    };

    const dirEntry = {
      isFile: false,
      isDirectory: true,
      name: 'Vacation',
      createReader: () => dirReader,
    };

    const item = {
      kind: 'file',
      webkitGetAsEntry: () => dirEntry,
    };

    const dt = {
      items: [item],
      files: [],
    } as unknown as DataTransfer;

    const result = await readDroppedFiles(dt);
    expect(result).toHaveLength(1);
    expect(result[0].file.name).toBe('DSC001.ARW');
    expect(result[0].folder).toBe('Vacation');
  });
});
