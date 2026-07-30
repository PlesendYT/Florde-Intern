# Sandbox-Manager Design

> **Goal:** Replace the current `execSync`-based command execution with a pluggable Sandbox Backend system — Firejail, Docker, Podman, VMware — wählbar via Settings oder Setup-Wizard.

**Status:** Draft / Design Phase

---

## 1. Architektur

### Dateistruktur

```
App/
├── sandbox/
│   ├── manager.js              ← SandboxManager (Singleton)
│   ├── backend.js              ← SandboxBackend (abstract)
│   ├── backends/
│   │   ├── none.js             ← Aktuelles execSync-Verhalten (Fallback)
│   │   ├── firejail.js         ← firejail --profile=...
│   │   ├── docker.js           ← docker run/exec
│   │   ├── podman.js           ← podman run/exec
│   │   └── vmware.js           ← vmrun + VNC-Screen
│   ├── system-detector.js      ← CPU/RAM/GPU-Erkennung + Empfehlung
│   └── os-templates.js         ← OS-Template-Definitionen
│
├── main.js                     ← IPC-Handler, Initialisierung
├── preload.js                  ← Sandbox-API für Renderer
│
└── renderer/
    ├── sandbox-settings.js     ← Settings-UI (renderer-safe)
    └── script.js               ← executeToolCall nutzt SandboxManager per IPC
```

### SandboxBackend (abstract)

```js
class SandboxBackend {
  // Meta
  get type()        // 'none' | 'firejail' | 'docker' | 'podman' | 'vmware'
  get label()       // Anzeigename (z.B. "Docker Sandbox")
  get description() // Beschreibung für den Wizard
  get icon()        // optional

  // Detection
  async isAvailable()  // Ist das Tool installiert? Lauffähig?

  // Lifecycle
  async init()         // Image pullen, Profil anlegen, Container starten
  async destroy()      // Aufräumen

  // Execution
  async exec(command, options)
  // options: { cwd, network, timeout, env }

  // Filesystem
  async readFile(path)
  async writeFile(path, content)
  async listFiles(path)
  async deleteFile(path)

  // VM-only (werfen Error bei anderen Backends)
  async startVM()
  async stopVM()
  async screenshot()  // → base64
  async sendMouse(x, y, button)
  async sendKey(key)
  async createSnapshot(name)
  async revertSnapshot(name)
}
```

### SandboxManager

```js
class SandboxManager {
  activeType: string       // aktuelles Backend
  backends: Map<string, SandboxBackend>

  async switchBackend(type)  // destroy alt, init neu
  get active()               // → aktuelles Backend
  async exec(cmd, opts)      // → active.exec(cmd, opts)
  async readFile(path)       // → active.readFile(path)
  // ... Delegation an active
}
```

---

## 2. Backend-Implementierungen

### NoneBackend

Aktuelles Verhalten: `execSync` mit Path-Check, `readFile`/`writeFile` direkt via `fs`. Keine Isolation.

**Wann:** Fallback, kein Docker/Firejail/VM installiert.

### FirejailBackend

**init:** Erstellt `~/.config/florde/firejail.profile`:
```
read-only /
private-dev
private-tmp
netfilter
caps.drop all
whitelist /tmp/project
```

**exec:** `firejail --profile=florde.profile --private-cwd=/workspace bash -c '<cmd>'`

**Netzwerk:** `--net=none` (none), `--net=lo` (localhost), `--net=enp0s3` (full), oder Default.

**Wann:** Linux, Firejail installiert, < 16 GB RAM.

### DockerBackend

**init:**
```bash
docker pull florde/sandbox:minimal   # Alpine + git, node, python, gcc
docker create --name florde-sbx-{id} florde/sandbox:minimal sleep infinity
docker cp /project/. florde-sbx-{id}:/workspace/
docker start florde-sbx-{id}
```

**exec:** `docker exec -w /workspace florde-sbx-{id} sh -c '<cmd>'`

**Netzwerk:** `--network none` / `--network host` / benutzerdefiniertes Netz.

**Wann:** Docker installiert, 8+ GB RAM.

### PodmanBackend

Identisch zu Docker, nur `podman` statt `docker`. Rootless, kein Daemon.

**init:** `podman pull florde/sandbox:minimal && podman create ...`

**exec:** `podman exec -w /workspace florde-sbx-{id} sh -c '<cmd>'`

**Wann:** Podman installiert, 8+ GB RAM.

### VMWareBackend

**OS-Templates:**

| Name | Typ | Image |
|------|-----|-------|
| Ubuntu Server | headless | `ubuntu-24.04-server.iso` |
| Ubuntu Desktop | desktop | `ubuntu-24.04-desktop.iso` |
| Debian | headless | `debian-12.iso` |
| Fedora Workstation | desktop | `fedora-40-workstation.iso` |
| Arch Linux | desktop/headless | `archlinux-YYYY.MM.DD.iso` |
| Tiny10 | headless | `tiny10-23h2.iso` (Fallback: Windows 10 LTSC) |
| Windows Server | headless | `windows-server-2022.iso` |
| Custom | benutzerdefiniert | Eigene ISO/IMG per Drag&Drop, Pfadauswahl oder Datei-Dialog |

Templates definiert in `App/sandbox/os-templates.js`. Florde lädt das ISO selbst herunter oder verwendet ein vorhandenes. Bei Custom kann der User eine beliebige ISO/IMG/VDMK/VMDK angeben.

**init:**
- Template-VM auswählen
- `vmrun -T ws start /path/to/florde-template.vmx nogui`
- Automatische Installation (preseed/kickstart/unattend)
- `vmrun -T ws snapshot` als Baseline

**exec:** `vmrun -T ws -gu user -gp pass runProgramInGuest /path/to/vm.vmx -interactive -activeWindow '<cmd>'`

**screenshot:** `vmrun -T ws captureScreen /path/to/vm.vmx /tmp/screen.png` → base64

**sendMouse:** VNC-Protokoll oder `vmrun`/AutoIt-Script.

**snapshot:** `vmrun -T ws snapshot /path/to/vm.vmx <name>` vor riskanten Aktionen.

**Netzwerk:** `vmrun -T ws setNetworkAdapter ... nat|host|bridged|none`.

**Wann:** 32+ GB RAM, VMware Workstation installiert.

---

## 3. System-Empfehlung (SystemDetector)

### Erkennung

```js
class SystemDetector {
  async detect() {
    return {
      cpu: { model: 'Ryzen 7 7800X', cores: 12, threads: 24 },
      ram: { total: 32_000 },  // MB
      gpu: { model: 'RTX 3060', vram: 12_000 },  // MB, optional
      os: { platform: 'linux', distro: 'Ubuntu 24.04' },
      hasDocker: bool,
      hasPodman: bool,
      hasFirejail: bool,
      hasVmware: bool,
      hasVisionModel: bool
    }
  }

  recommend(spec) {
    // Gibt geordnete Liste mit Gründen zurück
  }
}
```

### Empfehlungslogik (weich — Richtwerte, keine harten Grenzen)

| RAM | CPU | GPU | Vision | Empfehlung |
|-----|-----|-----|--------|------------|
| < 8 GB | egal | egal | nein | None / Firejail |
| 8-16 GB | 4+ Cores | egal | nein | Docker empfohlen, VM eingeschränkt |
| 8-16 GB | 4+ Cores | egal | ja | Docker (Headless) oder VM (langsamer) |
| 16-32 GB | 8+ Cores | VRAM < 8 GB | nein | Docker empfohlen, VM möglich |
| 16-32 GB | 8+ Cores | VRAM 8+ GB | ja | VM empfohlen, Docker (Headless) möglich |
| 32+ GB | 8+ Cores | VRAM 8+ GB | ja/nein | VM empfohlen für riskante Aufgaben |
| 32+ GB | 16+ Cores | VRAM 16+ GB | ja | VM klar empfohlen |

GPU ohne Vision: CPU-Kerne sind relevanter als GPU bei der VM-Empfehlung.

**Ausgabe im Wizard:**
```
System erkannt:
  CPU: Ryzen 7 7800X (12 Cores)  ✓ (≥ 8)
  RAM: 32 GB                      ✓ (≥ 16)
  GPU: RTX 3060 (12 GB VRAM)      ✓
  Docker installiert              ✓

Empfohlen: Docker Sandbox
           Gut für Entwicklung, Testing, Code-Analyse.
           VM möglich für risikoreiche Aufgaben.

Alternative: VMWare Sandbox (empfohlen bei Vision-Aufgaben)
```

### Pro-Contra-Tabelle (im Wizard)

| Backend | Geschwindigkeit | Isolation | Vision | RAM |
|---------|----------------|-----------|--------|-----|
| None (aktuell) | ⭐⭐⭐⭐⭐ | ⭐ | ❌ | ~0 |
| Firejail | ⭐⭐⭐⭐ | ⭐⭐ | ❌ | ~50 MB |
| Docker | ⭐⭐⭐ | ⭐⭐⭐⭐ | Headless | ~200 MB |
| Podman | ⭐⭐⭐ | ⭐⭐⭐⭐ | Headless | ~200 MB |
| VMWare | ⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ | ~2-8 GB |

---

## 4. Integration in Florde

### Main Process Init

```js
// main.js
const { SandboxManager } = require('./sandbox/manager');
const sandboxManager = new SandboxManager();
```

### IPC Handler

Neue Handler in `main.js`:
- `sandbox:init` → `sandboxManager.switchBackend(type)`
- `sandbox:exec` → `sandboxManager.exec(cmd, opts)`
- `sandbox:read-file` / `sandbox:write-file` / `sandbox:list-files` / `sandbox:delete-file`
- `sandbox:detect` → `SystemDetector.detect()`
- `sandbox:recommend` → `SystemDetector.recommend(spec)`
- `sandbox:vm-screenshot` → `sandboxManager.active.screenshot()`
- `sandbox:vm-snapshot` → `sandboxManager.active.createSnapshot(name)`
- `sandbox:vm-mouse` → `sandboxManager.active.sendMouse(x, y, button)`
- `sandbox:vm-key` → `sandboxManager.active.sendKey(key)`

### Renderer Integration

`executeToolCall('exec_command', args)` → `window.electronAPI.sandbox.exec(cmd, opts)` (neuer preload-Pfad).

Bestehende Handler (`sandbox-exec`, `sandbox-read-file`) bleiben als Fallback für NoneBackend oder werden durch die neuen Handler ersetzt.

### Settings UI

Neuer Tab "Sandbox" in den Settings:
- Dropdown: None | Firejail | Docker | Podman | VMware
- Status-Anzeige: ✅ Verfügbar / ❌ Nicht installiert
- "System erkennen" Button → zeigt Empfehlung
- Netzwerk: None / Localhost / Project / Full
- VM-spezifisch: OS-Template, Snapshots, Auto-Snapshots vor riskanten Commands

### Audit Log

Neue Event-Typen:
- `sandbox_switch`: Wechsel von none → docker
- `sandbox_init`: Docker-Image pulled, Container gestartet
- `sandbox_exec`: Befehl in Sandbox ausgeführt
- `sandbox_snapshot`: VM-Snapshot erstellt
- `sandbox_vision_start`: Vision-Session gestartet

### VM-Live-View (separates Subsystem, hier nur skizziert)

Wenn Backend = VMware, erscheint ein Panel mit:
- Live-Screen (polled alle 1-2s via `captureScreen`/VNC)
- Buttons: Pause | Stop | Übernehmen
- Übernehmen: User übernimmt Maus/Tastatur im Panel
- Vision-Session: KI "sieht" den Screen und kann Maus bewegen/klicken

---

## 5. Setup-Wizard (separates Subsystem)

Beim ersten Start:
1. "Wie soll die KI arbeiten?" — Pro/Contra-Tabelle
2. System-Erkennung läuft → Empfehlung
3. Auswahl + ggf. Konfiguration (VM-OS, Netzwerk)
4. Backend wird initialisiert (Image pullen, Container starten)

Änderbar später in Settings → Sandbox.

---

## 6. Events

SandboxManager feuert Events für UI-Updates:
- `'switch'` — Backend gewechselt
- `'exec'` — Befehl ausgeführt (mit Exit-Code)
- `'error'` — Backend-Fehler
- `'status'` — Backend-Status (init, running, stopping, stopped)

UI-Komponenten (Overlay, Audit Log, Settings) abonnieren via `sandboxManager.on(event, callback)`.

---

## 7. Nicht enthalten (Phase 2)

- Multi-Backend parallel (z.B. Docker für exec, VM für Vision)
- Benutzerdefinierte Docker-Images / Dockerfiles
- QEMU/KVM als VM-Backend
- Remote-Sandbox (SSH, Cloud)
- Sandbox-Templates speichern/teilen
- Resource Limits (CPU-Pinning, RAM-Limit) pro Backend
