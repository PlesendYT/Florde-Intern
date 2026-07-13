# Task 1: HTML — Add Tabs + KI-Aktionen Panel im Audit Modal

**Goal:** Add a tab bar to the existing Audit Log modal overlay with two tabs ("Cloud/Lokal" and "KI-Aktionen") and the KI-Aktionen content.

**File:** Modify `App/renderer/index.html`

**Context:** The existing audit modal is at line ~881 in index.html. It contains:
- A `<div id="audit-modal" class="modal hidden">` 
- Inside: title "Daten-Audit-Log", summary div, filter buttons, audit list, close button

**What to do:** Replace the entire content inside `#audit-modal` with the new structure below. The key changes:
1. Add `#audit-overlay-tabs` with two tab buttons
2. Wrap old content in `#audit-messages-tab` div
3. Add new `#audit-actions-tab` div with search, filters, and actions list
4. Keep the existing `btn-audit-clear` and `btn-close-audit` at the bottom

## Exact HTML to use

Replace the entire content of the `#audit-modal` div with:

```html
  <div id="audit-modal" class="modal hidden">
    <div class="modal-content" style="max-width:750px;min-width:550px;max-height:85vh;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;gap:1rem;padding:0 0 0.5rem;">
        <h2 style="margin:0;">Daten-Audit-Log</h2>
        <div id="audit-overlay-tabs" style="display:flex;gap:2px;margin-left:auto;">
          <button class="audit-overlay-tab active" data-tab="messages">Cloud/Lokal</button>
          <button class="audit-overlay-tab" data-tab="actions">KI-Aktionen</button>
        </div>
      </div>
      <!-- Messages Tab -->
      <div id="audit-messages-tab" class="audit-overlay-content">
        <p style="color:var(--text2);margin-bottom:1rem;font-size:0.85rem;">&#128200; Was wurde an die Cloud gesendet vs. lokal verarbeitet</p>
        <div style="display:flex;gap:1rem;margin-bottom:1rem;">
          <div id="audit-summary" style="flex:1;display:flex;gap:1rem;"></div>
        </div>
        <div style="border-bottom:1px solid var(--border);margin-bottom:0.5rem;padding-bottom:0.3rem;display:flex;gap:0.5rem;">
          <button class="audit-filter active" data-filter="all">Alle</button>
          <button class="audit-filter" data-filter="cloud">Cloud</button>
          <button class="audit-filter" data-filter="local">Lokal</button>
        </div>
        <div id="audit-list" class="audit-list" style="max-height:40vh;overflow-y:auto;"></div>
      </div>
      <!-- KI Actions Tab -->
      <div id="audit-actions-tab" class="audit-overlay-content hidden">
        <div id="audit-search-row" style="display:flex;gap:0.3rem;align-items:center;margin-bottom:0.5rem;">
          <input type="text" id="audit-ki-search" placeholder="Search logs or ask AI..." style="flex:1;padding:0.35rem 0.5rem;background:var(--bg1);border:1px solid var(--border2);color:var(--text);border-radius:4px;font-size:0.8rem;" />
          <button id="btn-audit-ai-toggle" title="Toggle AI search" class="audit-ai-btn">&#129302;</button>
        </div>
        <div id="audit-ki-filter-row" style="display:flex;gap:0.3rem;align-items:center;margin-bottom:0.3rem;">
          <select id="audit-ki-filter-type" class="audit-filter-select">
            <option value="all">All Types</option>
          </select>
          <select id="audit-ki-filter-status" class="audit-filter-select">
            <option value="all">All Status</option>
          </select>
          <select id="audit-ki-filter-date" class="audit-filter-select">
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
          <span id="audit-ki-count" style="font-size:0.7rem;color:var(--text3);margin-left:auto;">0 entries</span>
        </div>
        <div id="audit-actions-list" style="flex:1;overflow-y:auto;max-height:45vh;"></div>
      </div>
      <div class="modal-actions" style="margin-top:1rem;">
        <button id="btn-audit-clear" class="btn btn-secondary" style="margin-right:auto;">Clear Log</button>
        <button id="btn-close-audit" class="btn btn-secondary">Close</button>
      </div>
    </div>
  </div>
```

## Verification

After editing, verify:
1. The file is valid HTML (no unclosed tags)
2. All IDs from the old structure still exist: `audit-summary`, `audit-list`, `audit-filter`, `btn-audit-clear`, `btn-close-audit`
3. New IDs exist: `audit-overlay-tabs`, `audit-messages-tab`, `audit-actions-tab`, `audit-ki-search`, `btn-audit-ai-toggle`, `audit-ki-filter-type`, `audit-ki-filter-status`, `audit-ki-filter-date`, `audit-ki-count`, `audit-actions-list`
4. The modal still has class `modal hidden`

## Output Format

Report file: `.superpowers/sdd/task-1-report.md`

Write your report with:
- Status (DONE / NEEDS_CONTEXT / BLOCKED)
- Commits made
- Any concerns
