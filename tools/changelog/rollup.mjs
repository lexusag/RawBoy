#!/usr/bin/env node
/**
 * Validates, renders, and folds per-change fragments from `changelog/*.md`
 * into the top of `CHANGELOG.md` (below the `<!-- changelog-entries -->` marker).
 *
 * Usage:
 *   node tools/changelog/rollup.mjs            # fold changelog/*.md into CHANGELOG.md
 *   node tools/changelog/rollup.mjs --dry-run  # preview without modifying files
 *   node tools/changelog/rollup.mjs --check    # validate fragments and CHANGELOG.md marker
 *   node tools/changelog/rollup.mjs --render   # print combined changelog to stdout
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = '<!-- changelog-entries -->';
export const FRAGMENT_RE = /^(\d{4})-(\d{2})-(\d{2})-([a-z0-9][a-z0-9-]*)\.md$/;
const CONFLICT_RE = /^(<{7}|={7}|>{7})(\s|$)/m;
const BOLD_HEADING_RE = /^\*\*.+\*\*$/;

function isValidDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Return the Unix timestamp when `relPath` was first added in git history, or 0 if untracked/unavailable.
 */
function gitAddedTimestamp(rootDir, relPath) {
  try {
    const out = execFileSync(
      'git',
      ['log', '--diff-filter=A', '--follow', '--format=%ct', '-1', '--', relPath],
      { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    const ts = Number(out);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

/**
 * Load and validate all changelog fragments in `<rootDir>/changelog`.
 * Returns `{ fragments, errors }` where `fragments` is sorted newest-first.
 */
export function loadFragments(rootDir) {
  const dir = path.join(rootDir, 'changelog');
  const errors = [];
  const fragments = [];

  if (!fs.existsSync(dir)) {
    return { fragments, errors };
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith('.') || name.toLowerCase() === 'readme.md') {
      continue;
    }
    if (!entry.isFile()) {
      errors.push(`changelog/${name}: expected a markdown file, not a directory`);
      continue;
    }

    const match = FRAGMENT_RE.exec(name);
    if (!match) {
      errors.push(
        `changelog/${name}: filename must match YYYY-MM-DD-<lowercase-slug>.md (e.g. 2026-11-27-my-change.md)`,
      );
      continue;
    }
    const [, year, month, day] = match;
    if (!isValidDate(year, month, day)) {
      errors.push(`changelog/${name}: invalid calendar date ${year}-${month}-${day}`);
      continue;
    }

    const filePath = path.join(dir, name);
    const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
    const content = raw.trim();

    if (!content) {
      errors.push(`changelog/${name}: file is empty`);
      continue;
    }
    if (CONFLICT_RE.test(content)) {
      errors.push(`changelog/${name}: contains unresolved merge conflict markers`);
      continue;
    }

    const firstLine = content.split('\n')[0].trim();
    if (!BOLD_HEADING_RE.test(firstLine)) {
      errors.push(
        `changelog/${name}: first line must be a bold entry heading (**Title (platforms, YYYY-MM-DD)**)`,
      );
      continue;
    }

    const relPath = path.posix.join('changelog', name);
    fragments.push({
      name,
      relPath,
      filePath,
      date: `${year}-${month}-${day}`,
      addedTs: gitAddedTimestamp(rootDir, relPath),
      content,
    });
  }

  // Newest first: date descending, then git commit-added time descending, then filename descending.
  fragments.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.addedTs !== b.addedTs) return b.addedTs - a.addedTs;
    return b.name.localeCompare(a.name);
  });

  return { fragments, errors };
}

/**
 * Split `CHANGELOG.md` around `<!-- changelog-entries -->`.
 */
export function readArchive(rootDir) {
  const archivePath = path.join(rootDir, 'CHANGELOG.md');
  if (!fs.existsSync(archivePath)) {
    return { archivePath, error: 'CHANGELOG.md not found' };
  }
  const raw = fs.readFileSync(archivePath, 'utf8').replace(/\r\n/g, '\n');
  const idx = raw.indexOf(MARKER);
  if (idx === -1) {
    return {
      archivePath,
      error: `CHANGELOG.md is missing the ${MARKER} marker`,
    };
  }
  const markerEnd = idx + MARKER.length;
  const header = raw.slice(0, markerEnd);
  const body = raw.slice(markerEnd).replace(/^\n+/, '');
  return { archivePath, header, body, error: null };
}

/**
 * Combine `CHANGELOG.md` header, sorted fragments, and existing archive body.
 */
export function buildCombined(header, fragments, body) {
  const parts = fragments.map((f) => f.content);
  const trimmedBody = body.replace(/\n+$/, '');
  if (trimmedBody) {
    parts.push(trimmedBody);
  }
  if (parts.length === 0) {
    return `${header}\n`;
  }
  return `${header}\n\n${parts.join('\n\n')}\n`;
}

export function run(args, rootDir) {
  const flags = new Set(args);
  const checkOnly = flags.has('--check');
  const dryRun = flags.has('--dry-run');
  const renderOnly = flags.has('--render');

  const archive = readArchive(rootDir);
  const { fragments, errors } = loadFragments(rootDir);
  if (archive.error) {
    errors.unshift(archive.error);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      fragments,
      output: errors.map((e) => `error: ${e}`).join('\n') + '\n',
    };
  }

  if (checkOnly) {
    return {
      ok: true,
      errors: [],
      fragments,
      output: `Changelog OK (${fragments.length} pending fragment${fragments.length === 1 ? '' : 's'}).\n`,
    };
  }

  if (renderOnly) {
    return {
      ok: true,
      errors: [],
      fragments,
      output: buildCombined(archive.header, fragments, archive.body),
    };
  }

  if (fragments.length === 0) {
    return {
      ok: true,
      errors: [],
      fragments,
      output: 'No changelog fragments to roll up.\n',
    };
  }

  if (dryRun) {
    const list = fragments.map((f) => `  - ${f.relPath}`).join('\n');
    return {
      ok: true,
      errors: [],
      fragments,
      output: `Would fold ${fragments.length} fragment${fragments.length === 1 ? '' : 's'} into CHANGELOG.md:\n${list}\n`,
    };
  }

  const combined = buildCombined(archive.header, fragments, archive.body);
  fs.writeFileSync(archive.archivePath, combined, 'utf8');
  for (const f of fragments) {
    fs.unlinkSync(f.filePath);
  }

  const list = fragments.map((f) => `  - ${f.relPath}`).join('\n');
  return {
    ok: true,
    errors: [],
    fragments,
    output: `Folded ${fragments.length} fragment${fragments.length === 1 ? '' : 's'} into CHANGELOG.md:\n${list}\n`,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });

  const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const args = process.argv.slice(2);
  let rootDir = defaultRoot;
  const filteredArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) {
      rootDir = path.resolve(args[++i]);
    } else {
      filteredArgs.push(args[i]);
    }
  }

  const result = run(filteredArgs, rootDir);
  if (result.ok) {
    process.stdout.write(result.output);
  } else {
    process.stderr.write(result.output);
    process.exit(1);
  }
}
