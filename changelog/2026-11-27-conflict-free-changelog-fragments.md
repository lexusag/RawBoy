**Changelog: per-change fragment files to avoid merge conflicts (repo tooling, 2026-11-27)**

- New changelog entries are now added as standalone files under `changelog/YYYY-MM-DD-<slug>.md` instead of prepending to `CHANGELOG.md`, so parallel pull requests never collide on line 1 of `CHANGELOG.md`.
- `CHANGELOG.md` keeps the historical archive intact (preserving `git blame` for release dating in `docs/features.md`) under a `<!-- changelog-entries -->` marker.
- Added `tools/changelog/rollup.mjs` (`--check`, `--dry-run`, `--render`, and default rollup that folds `changelog/*.md` newest-first into `CHANGELOG.md` and deletes the folded files) with unit tests in `tools/changelog/test.mjs`, a fast `changelog` CI check in `.github/workflows/ci.yml`, and `:!changelog` in `.github/workflows/release.yml`'s `NOT_APP_PATHS`.
- Updated `CLAUDE.md`, `Readme.md`, `docs/features.md`, `docs/camera-platforms.md`, and `docs/video.md` to document the new workflow.
