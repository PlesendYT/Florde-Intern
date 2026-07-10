# RAG — Eigene Dateien als Wissensbasis für AI

**Kategorie:** 1. Chat / AI | **Feature:** 1.6

## Ziel
Die AI kann eigene Projekt-Dateien durchsuchen und als Kontext für Antworten nutzen (Retrieval-Augmented Generation).

## Funktionsweise
1. Beim Öffnen eines Projekts werden alle Textdateien indexiert
2. Dateiinhalte werden in Chunks geteilt und embedded (via lokales Embedding-Modell oder API)
3. Bei einer Chat-Frage sucht die AI relevante Chunks und hängt sie als Kontext an
4. Ein Indikator zeigt an, ob/ welche Dateien als Quelle verwendet wurden

## Specs
- **Embedding**: Lokal via Ollama (`nomic-embed-text`) — kein API-Key nötig
- **Index-Format**: Einfache JSON-Datei pro Projekt (`.florde/rag-index.json`)
- **Chunk-Größe**: 512 Tokens mit 50 Tokens Overlap
- **UI**: Ein kleines "RAG"-Icon im Chat-Input zeigt an ob Index bereit ist; gehoverte Quellen werden in der Chat-Nachricht angezeigt
- **Dateitypen**: `.js`, `.ts`, `.py`, `.html`, `.css`, `.json`, `.md`, `.txt`, `.jsx`, `.tsx`
- **Max Chunks pro Query**: 5
- **Storage**: Index wird bei Projekt-Wechsel/Neustart neu aufgebaut (bei großen Projekten asynchron im Hintergrund)
