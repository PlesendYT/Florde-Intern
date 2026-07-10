# Website — Vergleichstabelle (vs Cursor / Copilot)

**Kategorie:** 10. Website - Marketing | **Feature:** 10.2

## Ziel
Eine Vergleichstabelle, die Florde gegen Cursor, GitHub Copilot, und andere AI-Coding-Tools vergleicht.

## Vergleichs-Kategorien
| Feature | Florde | Cursor | Copilot |
|---------|--------|--------|---------|
| Preis | Kostenlos | $20/Monat | $10/Monat |
| Lokale LLMs | ✅ (Ollama) | ❌ | ❌ |
| Offline Modus | ✅ | ❌ | ❌ |
| Eigenes Terminal | ✅ | ✅ (integriert) | ❌ |
| Git Integration | ✅ | ✅ | ❌ |
| Docker Steuerung | ✅ | ❌ | ❌ |
| Open Source | ✅ | ❌ | ❌ |
| Plugin System | ✅ | ❌ | ❌ |
| Windows/Linux/Mac | ✅ | ✅ | ✅ (VS Code) |

## Design
- Tabelle mit horizontalem Scroll auf Mobile
- Florde-Spalte hervorgehoben (accent color)
- ✅ / ❌ / — Icons
- CTA Button unter der Tabelle: "Download Florde Free"

## Implementation
- Section in `index.html`
- Daten als HTML-Tabelle (kein JS nötig)
- Highlights via CSS: `florde-column { background: ... }`
