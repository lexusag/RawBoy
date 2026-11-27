import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MARKER, run } from './rollup.mjs';

function makeTempRepo(archiveContent, fragments = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rawboy-changelog-'));
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), archiveContent, 'utf8');
  const dir = path.join(root, 'changelog');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Changelog entries\n', 'utf8');
  for (const [name, content] of Object.entries(fragments)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return root;
}

const BASE_ARCHIVE = `# Changelog

> Note.

${MARKER}

**Older entry (all platforms, 2026-11-26)**

- Previous change.
`;

test('check passes on valid fragments and ignores README.md', () => {
  const root = makeTempRepo(BASE_ARCHIVE, {
    '2026-11-27-first-change.md': '**First change (web, 2026-11-27)**\n\n- Added a thing.\n',
  });
  try {
    const res = run(['--check'], root);
    assert.equal(res.ok, true);
    assert.equal(res.fragments.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('check rejects invalid filename, bad date, missing bold heading, and conflict markers', () => {
  const root = makeTempRepo(BASE_ARCHIVE, {
    'bad-name.md': '**Bad name (2026-11-27)**\n\n- Nope.\n',
    '2026-02-30-bad-date.md': '**Bad date (2026-02-30)**\n\n- Nope.\n',
    '2026-11-27-no-bold.md': '# Heading instead of bold\n\n- Nope.\n',
    '2026-11-27-conflict.md': '**Conflict (2026-11-27)**\n\n<<<<<<< HEAD\n- A\n=======\n- B\n>>>>>>> branch\n',
  });
  try {
    const res = run(['--check'], root);
    assert.equal(res.ok, false);
    assert.equal(res.errors.length, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('check fails when CHANGELOG.md marker is missing', () => {
  const root = makeTempRepo('**No marker (2026-11-26)**\n\n- Old.\n');
  try {
    const res = run(['--check'], root);
    assert.equal(res.ok, false);
    assert.match(res.output, /missing the <!-- changelog-entries --> marker/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dry-run and render leave files untouched', () => {
  const root = makeTempRepo(BASE_ARCHIVE, {
    '2026-11-27-alpha.md': '**Alpha (2026-11-27)**\n\n- Alpha bullet.\n',
    '2026-11-28-beta.md': '**Beta (2026-11-28)**\n\n- Beta bullet.\n',
  });
  try {
    const dry = run(['--dry-run'], root);
    assert.equal(dry.ok, true);
    assert.match(dry.output, /2026-11-28-beta\.md[\s\S]*2026-11-27-alpha\.md/);
    assert.equal(fs.existsSync(path.join(root, 'changelog', '2026-11-27-alpha.md')), true);

    const rendered = run(['--render'], root);
    assert.equal(rendered.ok, true);
    assert.ok(rendered.output.indexOf('**Beta') < rendered.output.indexOf('**Alpha'));
    assert.ok(rendered.output.indexOf('**Alpha') < rendered.output.indexOf('**Older entry'));
    assert.equal(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), BASE_ARCHIVE);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rollup folds fragments newest-first, removes them, keeps README, and is idempotent', () => {
  const root = makeTempRepo(BASE_ARCHIVE, {
    '2026-11-27-alpha.md': '**Alpha (2026-11-27)**\n\n- Alpha bullet.\n',
    '2026-11-28-beta.md': '**Beta (2026-11-28)**\n\n- Beta bullet.\n',
  });
  try {
    const res = run([], root);
    assert.equal(res.ok, true);
    assert.equal(res.fragments.length, 2);

    const updated = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const expected = `# Changelog

> Note.

${MARKER}

**Beta (2026-11-28)**

- Beta bullet.

**Alpha (2026-11-27)**

- Alpha bullet.

**Older entry (all platforms, 2026-11-26)**

- Previous change.
`;
    assert.equal(updated, expected);
    assert.equal(fs.existsSync(path.join(root, 'changelog', '2026-11-27-alpha.md')), false);
    assert.equal(fs.existsSync(path.join(root, 'changelog', '2026-11-28-beta.md')), false);
    assert.equal(fs.existsSync(path.join(root, 'changelog', 'README.md')), true);

    const second = run([], root);
    assert.equal(second.ok, true);
    assert.match(second.output, /No changelog fragments/);
    assert.equal(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), expected);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
