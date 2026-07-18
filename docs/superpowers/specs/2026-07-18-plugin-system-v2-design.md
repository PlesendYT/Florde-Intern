# Plugin System v2 — Design Spec

## Overview

Erweiterung des existierenden Plugin-Systems (`plugin-system.js`) um:

- Erweitertes Manifest mit Permissions, Capabilities, Dependencies, API-Version, Changelog
- Berechtigungssystem mit deaktivierbaren Checkboxen
- Custom Prompts mit Toggle (registrierbar, Checkbox zum An/Aus)
- `/`-Commands in der Chatleiste (Prompt-Templates + Action-Commands)
- Tools für die KI (bereits vorhanden, wird ins Permission-System integriert)
- Interaktion mit existierenden Tools (`execCommand`, `readFile`, etc.) via PluginAPI
- Eigene Themes (erscheinen im Theme-Selector)
- Accessibility-Features (kategorisiert, erscheinen im Accessibility-Panel)
- Plugin-Kategorien für Marketplace und Accessibility
- Verbesserter lokaler Installations-Flow (Sicherheitswarnung, Hold-to-Install, KI-Erklärung)
- Neue Plugin-Dokumentation

Nicht enthalten (später): Server-basierte Features (Upload, Review, Community Store, Usage-Statistiken).

---

## 1. Manifest (erweitert)

Neue optionale Felder in `manifest.json`:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "...",
  "author": "...",
  "icon": "...",
  "main": "index.js",
  "apiVersion": "2.0",
  "minFlordeVersion": "1.0.0",
  "license": "MIT",
  "categories": ["development", "design"],
  "hooks": ["onMessage", "onAppReady"],
  "permissions": [
    "files-read",
    "files-write",
    "terminal"
  ],
  "capabilities": [
    "terminal",
    "git"
  ],
  "dependencies": [
    "flos-accessmode-plugin"
  ],
  "changelog": [
    {
      "version": "1.1.0",
      "features": ["Neues Tool hinzugefügt"],
      "bugfixes": ["Fixed crash on empty input"],
      "newPermissions": ["network"]
    }
  ],
  "tools": [...]
}
```

### 1.1 `permissions`

Liste aller Berechtigungen, die das Plugin benötigt. Mögliche Werte:

| Permission | Beschreibung |
|---|---|
| `files-read` | Dateien lesen |
| `files-write` | Dateien schreiben/löschen |
| `network` | Netzwerkzugriff (fetch) |
| `terminal` | Shell-Befehle ausführen |
| `git` | Git-Operationen |
| `editor` | Editor/Tab-API |
| `other-plugins` | Auf andere Plugins zugreifen |
| `florde-core` | Core-API (Settings, Projekte, etc.) |
| `prompts` | Prompt-Templates registrieren |
| `commands` | `/`-Commands registrieren |
| `tools` | KI-Tools registrieren |
| `renderer` | DOM-Zugriff, UI-Manipulation |
| `notifications` | Benachrichtigungen senden |

### 1.2 `capabilities`

Liste der System-Features, die das Plugin nutzt (für UI-Anzeige, keine Permission-Prüfung).

### 1.3 `dependencies`

Array von Plugin-IDs, die vorher installiert sein müssen.

### 1.4 `apiVersion`

Semver-String. Bei Inkompatibilität wird das Plugin als nicht ladbar markiert und der User informiert.

### 1.5 `changelog`

Array von Versions-Einträgen. Jeder Eintrag kann enthalten: `version`, `features`, `bugfixes`, `newPermissions`, `removedPermissions`. Bei neuen Permissions muss der User erneut zustimmen.

---

## 2. Permission-System

### 2.1 Prüfung

- `PluginRegistry` hält pro Plugin eine Map der aktiven Permissions (`_activePermissions: Map<pluginId, Set<string>>`)
- Jede Registry-Methode, die eine Aktion ausführt, prüft ob die Permission aktiv ist
- Die Permission-Prüfung passiert im `PluginAPI`-Proxy, den das Plugin zur Laufzeit bekommt

### 2.2 UI

- In der Plugin-Karte/Installationsansicht: Tabelle aller Permissions mit Checkboxen
- User kann einzelne Permissions deaktivieren
- Standardmäßig sind alle deklarierten Permissions aktiviert
- Deaktivierte Permissions werden in der UI markiert
- Das Plugin kann auf deaktivierte Permissions nicht zugreifen (API wirft Fehler)

### 2.3 Speicherung

- `plugins.json` speichert pro Plugin: `id`, `enabled`, `installed`, `activePermissions` (Array der aktivierten)
- Beim Laden: `activePermissions` wird mit `manifest.permissions` abgeglichen; unbekannte werden ignoriert

---

## 3. PluginRegistry Erweiterungen

Neue Methoden auf der existierenden `PluginRegistry`-Klasse:

### 3.1 `registerPrompt(name, config)`

```ts
registerPrompt(name: string, config: {
  text: string,        // Prompt-Text (kann {{file}} oder {{selection}} Platzhalter enthalten)
  icon?: string,       // optionales Icon
  category?: string,   // für Gruppierung
  permission?: string  // optionale Permission-Prüfung
})
```

- Prompt erscheint als Button in einem Prompt-Panel und via `/name` in der Chatleiste
- `text` wird beim Aufruf in den Chat eingefügt (Platzhalter werden ersetzt)
- Hat einen Toggle (Checkbox) im Plugin-Manager zum An/Aus

### 3.2 `registerCommand(name, handler, options?)`

```ts
registerCommand(name: string, handler: (args: string, api: PluginAPI) => void | Promise<void>, options?: {
  description?: string,
  permission?: string,   // Erfordert diese Permission
  icon?: string
})
```

- Command erscheint in der Chat-Autovervollständigung bei `/`
- `args` ist der Text nach dem Befehl
- `api` ist das Permission-geprüfte PluginAPI-Objekt
- Bei `permission`: Prüfung vor Ausführung, sonst Fehlermeldung

### 3.3 `registerTheme(config)`

```ts
registerTheme(config: {
  id: string,
  name: string,
  type: 'dark' | 'light',
  colors: Record<string, string>  // CSS custom properties
})
```

- Theme wird in `<select id="settings-theme">` eingefügt
- Beim Aktivieren: `document.documentElement.setAttribute('data-theme', pluginThemeId)`
- Plugin muss `renderer`-Permission haben

### 3.4 `registerAccessibility(config)`

```ts
registerAccessibility(config: {
  id: string,
  name: string,
  description: string,
  category: 'sehen' | 'hören' | 'motorik' | 'kognition' | 'sprache' | 'allgemein',
  type: 'toggle' | 'slider' | 'select' | 'color',
  default?: any,
  options?: { label: string, value: any }[],  // für type: 'select'
  min?: number, max?: number, step?: number,  // für type: 'slider'
  apply: (value: any) => void                  // wird beim Ändern aufgerufen
})
```

- Erscheint im Accessibility-Panel unter der passenden Kategorie
- `apply()` wird aufgerufen wenn der User den Wert ändert
- Plugin muss `renderer`-Permission haben wenn `apply()` DOM manipuliert

### 3.5 `getAPI(pluginId)`

```ts
getAPI(pluginId: string): PluginAPI | null
```

Gibt ein Permission-geprüftes API-Objekt zurück. Enthält nur Methoden, die zu aktivierten Permissions gehören.

---

## 4. PluginAPI

Das Objekt, das Plugin-Code zur Laufzeit bekommt. Jede Methode prüft die entsprechende Permission:

### File Operations (files-read, files-write)
```ts
api.readFile(path: string): Promise<string>
api.writeFile(path: string, content: string): Promise<void>
api.deleteFile(path: string): Promise<void>
api.listFiles(): Promise<string[]>
```

### Terminal (terminal)
```ts
api.execCommand(command: string): Promise<{stdout: string, stderr: string, code: number}>
```

### Git (git)
```ts
api.gitStatus(): Promise<string>
api.gitCommit(message: string): Promise<void>
api.gitPush(): Promise<void>
api.gitPull(): Promise<void>
```

### Editor (editor)
```ts
api.getOpenFiles(): string[]
api.getActiveFile(): string | null
api.setActiveFile(path: string): void
api.insertText(text: string): void
api.getSelection(): string | null
```

### Notifications (notifications)
```ts
api.notify(title: string, body: string): void
```

### Network (network)
```ts
api.fetch(url: string, options?: RequestInit): Promise<Response>
```

### Other Plugins (other-plugins)
```ts
api.getPlugin(pluginId: string): PluginAPI | null
```

### Florde Core (florde-core)
```ts
api.getProjectName(): string
api.getProjectRoot(): string
api.getSetting(key: string): any
```

---

## 5. Chat Command System

### 5.1 Erkennung

In `sendMessage()` (script.js:4396): prüfen ob `input` mit `/` beginnt.

Wenn ja:
1. Parse: `/commandName arg1 arg2` → `name = "commandName"`, `args = "arg1 arg2"`
2. Durchsuche registrierte Commands (zuerst Built-in, dann Plugin-Commands)
3. Wenn gefunden:
   - **Prompt-Command**: Prompt-Text direkt in Chat-History einfügen (ohne `/` prefix), `sendMessage()` wird mit dem Prompt-Text aufgerufen
   - **Action-Command**: Permission prüfen, Handler ausführen, Ergebnis als Assistant-Nachricht im Chat anzeigen
4. Wenn nicht gefunden: als normale Nachricht behandeln (`sendMessage()` mit `/commandName arg1 arg2`)

### 5.2 Built-in Commands

| Command | Beschreibung |
|---|---|
| `/explain` | "Erkläre den folgenden Code..." |
| `/fix` | "Finde und behebe Fehler..." |
| `/refactor` | "Optimiere diesen Code..." |
| `/test` | "Schreibe Tests für..." |
| `/doc` | "Dokumentiere diese Funktion..." |

### 5.3 Autovervollständigung

- Bei Eingabe von `/` in `chat-input`: Dropdown mit passenden Commands anzeigen (wie Discord/Notion)
- Built-in und Plugin-Commands gemischt
- Plugin-Commands zeigen Plugin-Namen als Subtext

---

## 6. Theme System

### 6.1 Plugin-Themes

- Themes registriert via `registerTheme()` werden in den Theme-Selector eingefügt
- Beim Wechsel: `document.documentElement.dataset.theme` auf Theme-ID setzen
- CSS-Custom-Properties müssen von `applyTheme()` erkannt werden

### 6.2 `applyTheme()` Erweiterung

```js
function applyTheme() {
  const themeId = currentTheme;
  if (pluginRegistry.hasTheme(themeId)) {
    const theme = pluginRegistry.getTheme(themeId);
    for (const [key, val] of Object.entries(theme.colors)) {
      document.documentElement.style.setProperty(key, val);
    }
  } else {
    document.documentElement.setAttribute('data-theme', themeId);
  }
  // ...
}
```

---

## 7. Accessibility System

### 7.1 Architektur

- Neue globale `AccessibilityManager`-Klasse (oder Singleton)
- Verwaltet alle Accessibility-Features (Built-in + Plugin-registrierte)
- Kategorisiert nach: `sehen`, `hören`, `motorik`, `kognition`, `sprache`, `allgemein`
- Jedes Feature hat einen `type` (toggle, slider, select, color) und `apply()` Callback
- Features werden im Accessibility-Panel gerendert (eigenes Modal/Tab)

### 7.2 Built-in Accessibility Features

Built-in (alle vorhanden, kategorisiert):

- **Sehen**: Hoher Kontrast, Skalierbare UI, Farbenblind-Modi, Bionic Reading, Leseline, Blaulicht Filter, Sehbehinderung (Schriftart, Zeilenabstand, Cursor, Lupe, Monochrom)
- **Hören**: Screenreader/ARIA, Visuelle Hinweise
- **Motorik**: Vollständige Tastatursteuerung, Größere Klickflächen, Sticky Keys, Hover-Zeit, Spracheingabe
- **Kognition**: Einfacher Modus, KI-Erklärmodus, Animationen reduzieren, Fachbegriff-Erklärtool, Längere Timeouts
- **Allgemein**: Sprache (UI + KI + Fehlermeldungen), Benachrichtigungen (Ton/Popup/Blinken), Accessibility Preview

### 7.3 Accessibility Preview

- Button "Vorschau" im Accessibility-Panel
- Öffnet ein Overlay, das die aktuelle UI mit den ausgewählten Einstellungen zeigt
- Zeigt Beispiel-Szenario (ohne KI-Funktionen)
- Für jedes Feature: kurze Erklärung wie es funktioniert

### 7.4 Fachbegriff-Erklärtool

- Standardmäßig aktiviert
- User wählt Text mit der Maus aus
- Neben der Selektion erscheint ein "Erklären"-Knopf (Text-Bubble, nicht Chat)
- Bubble zeigt KI-generierte Erklärung des Begriffs
- Ruft dafür den aktiven KI-Provider auf

---

## 8. Lokaler Installations-Flow

Ersetzt den aktuellen simplen Upload:

1. User wählt ZIP oder Ordner
2. **Manifest parsen & validieren** (id, name, version, apiVersion, permissions)
3. **Sicherheitswarnung** anzeigen:
   - Plugin-Name, Version, Autor
   - Permissions-Tabelle mit Checkboxen
   - Capabilities-Liste
   - Dependencies (nicht erfüllte rot markieren)
   - "Nicht offiziell geprüft"-Badge
4. **"Plugin erklären"-Button**: Sendet Plugin-Code an KI → Zusammenfassung (Risiken, Vorteile, Funktionsweise) in einer Text-Bubble
5. **Hold-to-Install**: Button muss 5 Sekunden gedrückt gehalten werden (Fortschrittsbalken)
6. **Zweite Bestätigung**: "Willst du dieses Plugin wirklich installieren?" (Ja/Nein)
7. Plugin wird via `pluginRegistry.registerLocal(manifest)` registriert
8. Plugin-Code wird geladen (eval oder via blob URL)

### 8.1 Update-Erkennung

- Wenn bereits installiert und Version unterschiedlich: Changelog anzeigen
- Bei neuen Permissions: erneute Zustimmung erforderlich

---

## 9. Plugin Docs (Erweiterung)

Der existierende `PluginDocs._content` wird erweitert um:

- **Permissions** — vollständige Liste aller Permission-Typen
- **PluginAPI** — Referenz aller verfügbaren API-Methoden
- **Commands** — wie `/`-Befehle registriert werden
- **Themes** — wie Themes erstellt werden
- **Accessibility** — wie Accessibility-Features beigesteuert werden
- **Capabilities & Dependencies** — wozu sie dienen
- **Versioning & Changelog** — API-Version, Changelog-Format

---

## 10. Dateien & Änderungen

| Datei | Änderung |
|---|---|
| `renderer/plugin-system.js` | Haupt-Änderungen: Manifest-Validierung, Permission-System, PluginAPI, neue Registry-Methoden, neuer Install-Flow |
| `renderer/script.js` | `sendMessage()` `/`-Command Erkennung, `applyTheme()` Plugin-Theme-Support |
| `renderer/style.css` | Neue CSS-Klassen für Permission-Tabelle, Hold-to-Install, Accessibility-Panel, etc. |
| `renderer/index.html` | Accessibility-Panel Modal, neue Plugin-Docs-Tabs |
| `renderer/tools/accessibility-manager.js` (neu) | AccessibilityManager-Klasse, verwaltet Built-in + Plugin-Features |
| `docs/superpowers/specs/2026-07-18-plugin-system-v2-design.md` | Dieses Dokument |

