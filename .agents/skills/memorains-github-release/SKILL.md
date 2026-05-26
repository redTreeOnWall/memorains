---
name: memorains-github-release
description: Tag a new version, create a GitHub release with organized release notes, build all packages, and upload artifacts. Use when the user wants to release, tag, publish, or ship a new version of memorains on GitHub, or mentions putting out a GitHub release.
---

# Memorains GitHub Release

Create a GitHub release for memorains: tag the version, write release notes by reviewing actual code changes, build all platform packages, and upload them as release assets.

## Prerequisites

- `gh` CLI must be installed and authenticated (`gh auth status`)
- Working Node.js and npm setup in `client/` and `server/`
- Android SDK configured (for `.apk` builds)
- `script/build_all.sh` must be runnable

## Release Steps

Execute these in order. Wait for each step to complete before starting the next.

### 1. Determine the version and last release

Read the current version from `client/package.json` — this is the version to release:

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('client/package.json')).version)"
```

Then find the **latest published GitHub release** — this is the baseline for "what changed":

```bash
gh release list --limit 5
```

Use the top entry as the last release. If the user mentions a specific prior release (e.g., "since 0.8.68"), prefer that instead.

Release notes should cover all commits since that release tag:

```bash
git log <LAST_RELEASE_TAG>..HEAD --oneline --no-decorate
```

### 2. Review commits since the last release

Get the full list of commits between the last release tag and HEAD:

```bash
git log <LAST_RELEASE_TAG>..HEAD --oneline --no-decorate
```

Then, **read the actual code diffs** — not just commit messages. For each major feature/fix area, inspect the relevant files:

```bash
# Get the list of files that changed
git diff --stat <LAST_RELEASE_TAG>..HEAD

# Read diffs for key areas (group by component/feature)
git diff <LAST_RELEASE_TAG>..HEAD -- <file-path>
```

Pay special attention to:
- New files (new features)
- `client/src/components/` — UI components
- `client/src/editor/` — editor logic
- `client/src/utils/` — utilities
- `client/src/internationnalization/` — new i18n strings

### 3. Write organized release notes

Group changes by category, not by commit. Use sections like:

- **New Features** — brand new capabilities
- **Improvements** — enhancements to existing features
- **UI** — visual/presentation changes
- **Bug Fixes** — problems resolved

For each item, write a one-line summary describing what changed from the user's perspective. Include keyboard shortcuts, file paths, or UI positions when relevant. Be specific — prefer "Outline panel with hierarchical tree view, collapsible by heading level" over "added outline".

Write notes to a temp file to avoid shell escaping issues:

```bash
# Write to /tmp/release-notes-<VERSION>.md first, then use --notes-file
gh release create <VERSION> --title "v<VERSION>" --notes-file /tmp/release-notes-<VERSION>.md
```

### 4. Create and push the tag

```bash
git tag -a <VERSION> -m "<VERSION>: <short summary>"
git push origin <VERSION>
```

### 5. Create the GitHub release

```bash
gh release create <VERSION> \
  --title "v<VERSION>" \
  --notes-file /tmp/release-notes-<VERSION>.md
```

Verify the release body afterward:

```bash
gh release view <VERSION> --json body | python3 -m json.tool | head -20
```

If the body is truncated (shows only a heading), the notes file content wasn't passed correctly. Re-edit the release:

```bash
gh release edit <VERSION> --notes-file /tmp/release-notes-<VERSION>.md
```

### 6. Build all packages

Run from the `script/` directory:

```bash
cd <PROJECT_ROOT>/script && bash build_all.sh
```

This produces:
- `script/out/package.tar.gz` — web deploy package (Docker)
- `script/out/memorains-note_<VERSION>_amd64.deb` — Linux desktop
- `script/out/memorains-note-win32-x64-<VERSION>.zip` — Windows desktop
- `script/out/memorains-release.apk` — Android (signed)

### 7. Upload artifacts to the release

```bash
cd <PROJECT_ROOT>/script/out && \
gh release upload <VERSION> \
  memorains-note_<VERSION>_amd64.deb \
  memorains-note-win32-x64-<VERSION>.zip \
  memorains-release.apk \
  package.tar.gz \
  --clobber
```

Verify with:

```bash
gh release view <VERSION> --json assets --jq '.assets[] | "\(.name)  \(.size | tonumber / 1048576 * 100 | floor / 100)MB"'
```

### 8. Bump version for next development cycle

After the release, bump the patch version in `client/package.json` so the next changes start from a fresh version. **Do not commit or push** — the user will do that when they start the next round of changes.

## Example Release Notes Structure

```markdown
## What's New in v<VERSION>

### ✨ New Features
- Item one
- Item two

### 🔄 Improvements
- Item one

### ⌨️ Keyboard Shortcuts
- **Shortcut** — description

### 🎨 UI Improvements
- Item one

### 🐛 Bug Fixes
- **Bold summary** — detail about the fix

---

_N commits since v<LAST_TAG>_ | _Co-authored-by: pi_
```

Keep notes concise but specific. Every item should tell the reader what changed and why it matters. Avoid vague summaries and group related commits into single bullet points.
