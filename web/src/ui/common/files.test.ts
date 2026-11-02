import { describe, expect, it } from 'vitest';
import { canPickFolder, isRawFileName, readDroppedFiles } from './files';

interface MockFileEntry {
  isFile: true;
  isDirectory: false;
  name: string;
  fullPath: string;
  file: (success: (f: File) => void, error?: () => void) => void;
}

interface MockDirEntry {
  isFile: false;
  isDirectory: true;
  name: string;
  fullPath: string;
  createReader: () => { readEntries: (success: (entries: FileSystemEntry[]) => void, error?: () => void) => void };
}

describe('canPickFolder', () => {
  it('returns a boolean based on webkitdirectory support', () => {
    expect(typeof canPickFolder()).toBe('boolean');
  });
});

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

    const makeFileEntry = (f: File, dir: string): MockFileEntry => ({
      isFile: true,
      isDirectory: false,
      name: f.name,
      fullPath: `/${dir}/${f.name}`,
      file: (cb: (file: File) => void) => cb(f),
    });

    const entries: FileSystemEntry[] = [
      makeFileEntry(rawFile, 'Vacation') as unknown as FileSystemEntry,
      makeFileEntry(jpgFile, 'Vacation') as unknown as FileSystemEntry,
      makeFileEntry(xmpFile, 'Vacation') as unknown as FileSystemEntry,
      makeFileEntry(dbFile, 'Vacation') as unknown as FileSystemEntry,
    ];

    let read = false;
    const dirReader = {
      readEntries: (cb: (items: FileSystemEntry[]) => void) => {
        if (!read) {
          read = true;
          cb(entries);
        } else {
          cb([]);
        }
      },
    };

    const dirEntry: MockDirEntry = {
      isFile: false,
      isDirectory: true,
      name: 'Vacation',
      fullPath: '/Vacation',
      createReader: () => dirReader,
    };

    const item = {
      kind: 'file',
      webkitGetAsEntry: () => dirEntry as unknown as FileSystemEntry,
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

  it('disambiguates two dropped folders with the same name', async () => {
    const file1 = new File(['card1'], 'DSC001.ARW');
    const file2 = new File(['card2'], 'DSC001.ARW');

    const makeDirEntry = (name: string, file: File): MockDirEntry => {
      let read = false;
      const fileEntry: MockFileEntry = {
        isFile: true,
        isDirectory: false,
        name: file.name,
        fullPath: `/${name}/${file.name}`,
        file: (cb: (f: File) => void) => cb(file),
      };
      return {
        isFile: false,
        isDirectory: true,
        name,
        fullPath: `/${name}`,
        createReader: () => ({
          readEntries: (cb: (items: FileSystemEntry[]) => void) => {
            if (!read) {
              read = true;
              cb([fileEntry as unknown as FileSystemEntry]);
            } else {
              cb([]);
            }
          },
        }),
      };
    };

    const dt = {
      items: [
        { kind: 'file', webkitGetAsEntry: () => makeDirEntry('DCIM', file1) as unknown as FileSystemEntry },
        { kind: 'file', webkitGetAsEntry: () => makeDirEntry('DCIM', file2) as unknown as FileSystemEntry },
      ],
      files: [],
    } as unknown as DataTransfer;

    const result = await readDroppedFiles(dt);
    expect(result).toHaveLength(2);
    expect(result[0].folder).toBe('DCIM');
    expect(result[1].folder).toBe('DCIM (2)');
  });
});
