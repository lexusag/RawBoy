# Changelog entries

Each pull request or user-visible change adds **one new file** in this directory instead of editing `CHANGELOG.md`. Because parallel PRs never touch the same file, they do not trigger merge conflicts on the changelog.

## Adding an entry

1. Create `changelog/YYYY-MM-DD-<short-slug>.md` (lowercase letters, digits, and hyphens; e.g. `2026-11-27-camera-portrait-toggle.md`).
2. Use the same format as entries in [`../CHANGELOG.md`](../CHANGELOG.md):

```markdown
**<Title> (<platforms>, YYYY-MM-DD)**

- <User-visible summary of the change>
- Code: `<files>`; Tests: `<tests>`.
```

## Rolling up into `CHANGELOG.md`

Pending entries stay here until folded into the archive in [`../CHANGELOG.md`](../CHANGELOG.md):

```bash
node tools/changelog/rollup.mjs --check    # validate pending fragments
node tools/changelog/rollup.mjs --dry-run  # preview rollup order
node tools/changelog/rollup.mjs --render   # print combined changelog to stdout
node tools/changelog/rollup.mjs            # fold fragments into CHANGELOG.md and remove them
```

Rolling up inserts the entries newest-first right after `<!-- changelog-entries -->` in `CHANGELOG.md` without rewriting older lines (keeping `git blame` intact for historical entries).
