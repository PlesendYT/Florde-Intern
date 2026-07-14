# Code Intelligence V2 — 5 New Tools

Date: 2026-07-14

## Overview

Add 5 new tools to Code Intelligence in the Management Panel CI tab. All follow the existing `_renderToolView()` → `_render*()` pattern in `App/renderer/tools/code-intelligence.js`. No new files, no architectural changes.

## 1. Project Health Scan

**Tab:** `health-scan` | Label: `Project Health Scan` | Icon: `🔍`

### Flow
- One "Scan starten" button
- Runs 5 checks sequentially

### Checks

| Check | Implementation | Success | Warning | Fail |
|-------|---------------|---------|---------|------|
| Build | Run `npm run build` via `child_process`, check exit code | ✅ Build successful | - | ❌ Build failed (show stderr) |
| Outdated packages | Run `npm outdated --json`, parse result | Keine veralteten Pakete | N/A | X veraltete Pakete |
| Git status | Run `git status --porcelain` | Sauberer Working Tree | N/A | X uncommitted files |
| Security | Run `npm audit --json`, parse | Keine Sicherheitswarnungen | Moderate/Low warnings | Critical/High warnings |
| Backup | Check if `.git/refs/heads/main` age < 7d or `backup-*.zip` exists | Backup vorhanden (< 7d) | Backup > 7d alt | Kein Backup gefunden |

### UI
- List of 5 result rows: icon + label + detail text
- Each row colored: green (success), yellow/amber (warning), red (fail)
- Below the list: compact summary (e.g. "3/5 bestanden, 1 Warnung, 1 Fehler")

### Storage
- None (results displayed only, no persistence)

## 2. Feature Timeline

**Tab:** `feature-timeline` | Label: `Feature Timeline` | Icon: `📅`

### Auto-logging
- Called by the AI agent via `CodeIntelligence._addTimelineEntry(name, description)` after completing a feature
- Dedup by name: if an entry with the same `name` already exists, skip (re-work on same feature does not create duplicate)
- Also callable via an "In Timeline eintragen" button in the UI (manual entry)

### Data Model (localStorage key: `ci-timeline`)
```json
[
  { "name": "Dark Mode", "description": "Full dark mode support...", "date": "2026-07-13" },
  { "name": "Export PDF", "description": "Export documents as PDF", "date": "2026-07-10" }
]
```

### UI
- Grouped by month (e.g. "Juli 2026" heading)
- Within month, sorted by day descending (newest first)
- Each entry: bold **name**, gray date on the right
- Hover: tooltip with full description
- Month headers are sticky within the scroll area

### Sound
On add (auto or manual): short audio feedback (see Sound System in section 5)

## 3. Idea Evolution

**Tab:** `idea-evolution` | Label: `Idea Evolution` | Icon: `💡`

### Flow
1. Textarea (placeholder: "Deine Idee...")
2. Below: 5 checkboxes: `[x] Task` `[ ] Spec` `[ ] Plan` `[ ] Konzept` `[ ] Note`
3. Button "Generieren" (disabled if textarea empty or no checkbox selected)
4. On click:
   - Button shows spinner/text "Generiere..."
   - Sends prompt to provider: format the idea into the selected output types
   - On complete: render results + play sound
   - On error: show error message

### Output Display
- Each selected type gets its own section box with type header (e.g. "Task", "Spec")
- Sections are collapsible
- Content is rendered as formatted text

### Sound System
- Small module `CodeIntelligence._playEventSound()` using `new Audio()` or `AudioContext`
- Single short UI plink sound (base64-encoded WAV or inline generated)
- Used by: Idea Evolution complete, Feature Timeline add, Health Scan complete

## 4. Git Clarify

**Tab:** `git-clarify` | Label: `Git Clarify` | Icon: `🔧`

### Flow
1. Button "Commits analysieren" opens a confirmation overlay:
   "Git Clarify wird alle Commit-Nachrichten analysieren und Vorschläge machen. Git-History wird umgeschrieben (amend/rebase). Fortfahren?"
   - [Abbrechen] [Fortfahren]
2. On confirm:
   - Runs `git log --all --oneline --format="%H %s"` (or up to limit)
   - Alternatively use `git log --all --format="%H|||%s|||%b|||%an|||%ad"`
   - Send each commit (hash + message + diff summary) to AI
   - AI returns `{ hash: "<full hash>", suggestedName: "...", suggestedDescription: "..." }` per commit
3. Display results in a list

### UI (overlay within the CI tool view)
- Each commit row shows:
  - Short hash (7 chars)
  - **Old name** (strikethrough) → **New name** (green)
  - Old description → New description (if changed)
  - `[✓ Übernehmen]` `[✗ Ablehnen]`
- Bottom bar with:
  - `[Alles übernehmen]` `[Alles ablehnen]`
  - Status text: "3/10 angenommen"
- On "Übernehmen" for the latest commit: `git commit --amend -m "<new name>" -m "<new description>"`
- On "Übernehmen" for older commits: interactive rebase via `git rebase -i HEAD~N` + environment variables or GIT_SEQUENCE_EDITOR
- After each amend/rebase, re-run `git log` to refresh

### Sound
On completion of all reviews + sounds per batch update

## 5. Explain my Project

**Tab:** `explain-project` | Label: `Explain my Project` | Icon: `📋`

### Flow
1. Button "Projekt analysieren"
2. KI sammelt via predefined gatherers:
   - Project root inspection (package.json, README.md, config files)
   - Key source file summaries (first 50 lines of `.js`, `.py`, `.ts`, `.rs`, etc.)
   - Git commit summary (last 50 commits via `git log --oneline`)
   - Directory tree (top 2 levels)
3. AI generates a comprehensive summary (~500-1000 words)
4. Display in a scrollable text block with a `[📋 Kopieren]` button
5. On copy: `navigator.clipboard.writeText(summary)` — done

### Output Sections
- Was ist das Projekt? (one-liner + purpose)
- Tech-Stack & Architektur
- Wichtige Entscheidungen & Patterns
- Aktueller Status (was ist fertig, was in Arbeit)
- Struktur (how folders are organized)

## Implementation Notes

### Code Changes

**`App/renderer/tools/code-intelligence.js`:**
- Extend `_getTools()` with 5 new entries
- Add `_renderProjectHealth()`, `_renderFeatureTimeline()`, `_renderIdeaEvolution()`, `_renderGitClarify()`, `_renderExplainProject()`
- Add `_renderToolView()` dispatch for the 5 new IDs
- Add `_playEventSound()` helper
- Add `_addTimelineEntry()` public method (called externally)
- Add `_runHealthScan()`, `_runGitClarify()`, `_runExplainProject()` — the actual logic methods
- Add `_ciTimeline` data management helpers (`_loadTimeline()`, `_saveTimeline()`)

**`App/renderer/style.css`:**
- New CSS classes for the 5 tools (colored check results, timeline month groups, idea evolution checkboxes, git clarify commit rows, explain project output block)
- Remove orphaned `#ci-panel` CSS block (lines 583-597)
- Sound system is pure JS, no CSS needed

**`App/renderer/script.js`:**
- ManagementPanel `_refreshActiveTab('ci')` already works — no changes needed
- Remove dead CI code (`CodeIntelligence.toggle()/hide()` if they reference `#ci-panel`)

### Sound Implementation
```js
_playEventSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.15;
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch(e) { /* silent fail */ }
}
```

### Provider Integration
- Idea Evolution, Git Clarify, Explain my Project all need an active provider (AI model)
- Use `window.providers[providerId].sendPlain()` pattern (same as permission prompt edit/explain flows)
- Show a notice if no provider is configured (like existing tools do)
- Timeout: 60s for these calls
- Git Clarify processes commits sequentially (one at a time) to avoid token overflow

### Git Clarify Technical Note
- For non-latest commits, use `git rebase -i` programmatically:
  - Set `GIT_SEQUENCE_EDITOR` to a script that replaces `pick` with `reword`
  - Set `GIT_EDITOR` to a script that writes the new message
  - Alternative: use `git filter-branch` or `git rebase --onto` for older commits
- Safety: show a warning that this rewrites history (already in confirmation overlay)

## Files Modified
- `App/renderer/tools/code-intelligence.js` — main implementation
- `App/renderer/style.css` — new styles, dead code cleanup
- `App/renderer/script.js` — minor cleanup (dead CI references)
