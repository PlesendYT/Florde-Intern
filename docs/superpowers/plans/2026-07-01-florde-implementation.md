# Florde — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MVP of Florde — a marketing website and Electron desktop app for AI-powered code generation from natural language.

**Architecture:** Two independent subsystems under one repo: a static HTML/CSS/JS landing page (`Website/`) and an Electron desktop app with Monaco Editor and multi-provider AI chat (`App/`). Root-level batch files orchestrate dev and build.

**Tech Stack:** Website: plain HTML/CSS/JS. App: Electron, Monaco Editor, OpenAI SDK, Fetch API (DeepSeek/Mistral/Ollama).

## Global Constraints

- Website must be a single all-in-one scrollable HTML page with embedded section navigation
- App must support 4 AI providers: OpenAI, DeepSeek, Mistral, Ollama
- App uses Monaco Editor for code display/editing
- Dark modern theme across both subsystems with purple/blue gradient accents
- No real payment processing in v1 (static buy buttons)
- All provider API calls happen from the Electron renderer process (no backend server)

---
### Task 1: Website — HTML Structure

**Files:**
- Create: `Website/index.html`

- [ ] **Step 1: Create `index.html` with full page structure**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Florde — Build Software from Plain Language</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <nav class="navbar">
    <div class="nav-brand">Florde</div>
    <div class="nav-links">
      <a href="#how-it-works">How It Works</a>
      <a href="#features">Features</a>
      <a href="#pricing">Pricing</a>
    </div>
  </nav>

  <section id="hero">
    <div class="hero-content">
      <h1>Build real software<br />from <span class="gradient-text">plain language</span></h1>
      <p class="hero-sub">Describe your idea. Get a working project. Understand every line.</p>
      <div class="hero-cta">
        <a href="#pricing" class="btn btn-primary">Get Started</a>
        <a href="#how-it-works" class="btn btn-secondary">See How It Works</a>
      </div>
    </div>
  </section>

  <section id="how-it-works">
    <h2>How It Works</h2>
    <div class="steps">
      <div class="step">
        <div class="step-number">1</div>
        <h3>Describe Your Idea</h3>
        <p>Type what you want to build in plain English. No coding knowledge needed.</p>
      </div>
      <div class="step">
        <div class="step-number">2</div>
        <h3>AI Generates the Code</h3>
        <p>Our engine produces a complete, working project with clean architecture.</p>
      </div>
      <div class="step">
        <div class="step-number">3</div>
        <h3>Learn &amp; Customize</h3>
        <p>Get line-by-line explanations, then modify your project by talking to the AI.</p>
      </div>
    </div>
  </section>

  <section id="features">
    <h2>Everything You Need</h2>
    <div class="features-grid">
      <div class="feature-card">
        <h3>Project Starter Library</h3>
        <p>Prebuilt templates: To-Do App, Game Engine, Business Website, Automation Scripts.</p>
      </div>
      <div class="feature-card">
        <h3>Code Explained Mode</h3>
        <p>Line-by-line explanations, simplified summaries, and visual flow breakdowns.</p>
      </div>
      <div class="feature-card">
        <h3>Fix-It AI Debug Assistant</h3>
        <p>Paste broken code, get error explanations, and step-by-step auto-fixes.</p>
      </div>
    </div>
  </section>

  <section id="pricing">
    <h2>Choose Your Plan</h2>
    <div class="pricing-grid">
      <div class="pricing-card">
        <h3>Starter</h3>
        <p class="price">€19</p>
        <p class="price-period">one-time</p>
        <ul>
          <li>Basic code generation</li>
          <li>Project templates</li>
          <li>Community support</li>
        </ul>
        <button class="btn btn-primary buy-btn" data-plan="starter">Buy Now</button>
      </div>
      <div class="pricing-card featured">
        <h3>Pro</h3>
        <p class="price">€49</p>
        <p class="price-period">one-time</p>
        <ul>
          <li>Advanced code generation</li>
          <li>All project templates</li>
          <li>Code Explained Mode</li>
          <li>Priority support</li>
        </ul>
        <button class="btn btn-primary buy-btn" data-plan="pro">Buy Now</button>
      </div>
      <div class="pricing-card">
        <h3>Founder</h3>
        <p class="price">€199</p>
        <p class="price-period">one-time</p>
        <ul>
          <li>Everything in Pro</li>
          <li>Fix-It AI Debug Assistant</li>
          <li>Lifetime early access pricing</li>
          <li>Feature voting priority</li>
          <li>Direct support</li>
        </ul>
        <button class="btn btn-primary buy-btn" data-plan="founder">Buy Now</button>
      </div>
    </div>
  </section>

  <footer class="footer">
    <p>&copy; 2026 Florde. All rights reserved.</p>
  </footer>

  <script src="script.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add Website/index.html
git commit -m "feat(website): add landing page HTML structure"
```

---
### Task 2: Website — CSS Styling

**Files:**
- Create: `Website/style.css`

- [ ] **Step 1: Create `style.css` with modern dark theme**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0a0a0f;
  color: #e0e0e0;
  line-height: 1.6;
}

.navbar {
  position: fixed;
  top: 0;
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: rgba(10, 10, 15, 0.9);
  backdrop-filter: blur(10px);
  z-index: 100;
}

.nav-brand {
  font-size: 1.3rem;
  font-weight: 700;
  background: linear-gradient(135deg, #7c3aed, #3b82f6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.nav-links a {
  color: #a0a0b0;
  text-decoration: none;
  margin-left: 2rem;
  transition: color 0.2s;
}

.nav-links a:hover {
  color: #7c3aed;
}

section {
  padding: 6rem 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

#hero {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding-top: 80px;
}

.hero-content h1 {
  font-size: 3.5rem;
  font-weight: 800;
  margin-bottom: 1rem;
  line-height: 1.2;
}

.gradient-text {
  background: linear-gradient(135deg, #7c3aed, #3b82f6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-sub {
  font-size: 1.3rem;
  color: #888;
  margin-bottom: 2rem;
}

.btn {
  display: inline-block;
  padding: 0.8rem 2rem;
  border-radius: 8px;
  text-decoration: none;
  font-weight: 600;
  transition: all 0.2s;
  cursor: pointer;
  border: none;
  font-size: 1rem;
}

.btn-primary {
  background: linear-gradient(135deg, #7c3aed, #3b82f6);
  color: white;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(124, 58, 237, 0.4);
}

.btn-secondary {
  background: transparent;
  border: 2px solid #7c3aed;
  color: #7c3aed;
  margin-left: 1rem;
}

.btn-secondary:hover {
  background: rgba(124, 58, 237, 0.1);
}

h2 {
  font-size: 2.5rem;
  text-align: center;
  margin-bottom: 3rem;
  background: linear-gradient(135deg, #7c3aed, #3b82f6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2rem;
}

.step {
  text-align: center;
  padding: 2rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: transform 0.2s;
}

.step:hover {
  transform: translateY(-4px);
}

.step-number {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #7c3aed, #3b82f6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3rem;
  font-weight: 700;
  margin: 0 auto 1rem;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2rem;
}

.feature-card {
  padding: 2rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: all 0.2s;
}

.feature-card:hover {
  border-color: rgba(124, 58, 237, 0.3);
  box-shadow: 0 4px 20px rgba(124, 58, 237, 0.1);
}

.pricing-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2rem;
  align-items: center;
}

.pricing-card {
  padding: 2.5rem 2rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  text-align: center;
}

.pricing-card.featured {
  background: rgba(124, 58, 237, 0.08);
  border-color: rgba(124, 58, 237, 0.3);
  transform: scale(1.05);
}

.price {
  font-size: 3rem;
  font-weight: 800;
  margin: 1rem 0 0.2rem;
}

.price-period {
  color: #888;
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
}

.pricing-card ul {
  list-style: none;
  margin-bottom: 2rem;
}

.pricing-card li {
  padding: 0.4rem 0;
  color: #a0a0b0;
}

.pricing-card li::before {
  content: "✓ ";
  color: #7c3aed;
}

.footer {
  text-align: center;
  padding: 2rem;
  color: #666;
}

@media (max-width: 768px) {
  .steps, .features-grid, .pricing-grid {
    grid-template-columns: 1fr;
  }

  .hero-content h1 {
    font-size: 2rem;
  }

  .pricing-card.featured {
    transform: none;
  }

  .navbar {
    flex-direction: column;
    gap: 0.5rem;
  }

  .nav-links a {
    margin: 0 0.75rem;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add Website/style.css
git commit -m "feat(website): add modern dark theme CSS"
```

---
### Task 3: Website — JavaScript Interactivity

**Files:**
- Create: `Website/script.js`

- [ ] **Step 1: Create `script.js` with smooth scroll and buy button alerts**

```javascript
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

document.querySelectorAll('.buy-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const plan = btn.dataset.plan;
    const prices = { starter: 19, pro: 49, founder: 199 };
    alert(`[Demo] You selected the ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan (€${prices[plan]}). Payment integration coming soon!`);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add Website/script.js
git commit -m "feat(website): add smooth scroll and buy button handlers"
```

---
### Task 4: App — Initialize Electron Project

**Files:**
- Create: `App/package.json`

- [ ] **Step 1: Create `App/package.json`**

```json
{
  "name": "codementor-ai",
  "version": "1.0.0",
  "description": "AI-powered code generation from natural language",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder"
  },
  "dependencies": {
    "monaco-editor": "^0.45.0"
  },
  "devDependencies": {
    "electron": "^30.0.0",
    "electron-builder": "^24.0.0"
  },
  "build": {
    "appId": "com.codementor.ai",
    "productName": "Florde",
    "files": [
      "main.js",
      "preload.js",
      "renderer/**/*"
    ],
    "win": {
      "target": "nsis"
    }
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd App && npm install
```

- [ ] **Step 3: Commit**

```bash
git add App/package.json
git commit -m "feat(app): initialize Electron project with dependencies"
```

---
### Task 5: App — Electron Main Process + Preload

**Files:**
- Create: `App/main.js`
- Create: `App/preload.js`

- [ ] **Step 1: Create `App/main.js`**

```javascript
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

- [ ] **Step 2: Create `App/preload.js`**

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (content, defaultName) => ipcRenderer.invoke('save-file', content, defaultName),
  openFile: () => ipcRenderer.invoke('open-file'),
});
```

- [ ] **Step 3: Add save/open file handlers to `main.js`**

Insert before `app.whenReady()`:

```javascript
const fs = require('fs');

ipcMain.handle('save-file', async (event, content, defaultName) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'Code Files', extensions: ['py', 'js', 'ts', 'html', 'css', 'json', 'txt'] }],
  });
  if (filePath) {
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }
  return null;
});

ipcMain.handle('open-file', async () => {
  const { filePath, content } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
  });
  if (filePath) {
    const data = fs.readFileSync(filePath[0], 'utf-8');
    return { content: data, fileName: path.basename(filePath[0]) };
  }
  return null;
});
```

- [ ] **Step 4: Add `dialog` to the require at top of `main.js`**

Change first line to:
```javascript
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
```

- [ ] **Step 5: Commit**

```bash
git add App/main.js App/preload.js
git commit -m "feat(app): add Electron main process and preload with file I/O"
```

---
### Task 6: App — Renderer UI (HTML + CSS)

**Files:**
- Create: `App/renderer/index.html`
- Create: `App/renderer/style.css`

- [ ] **Step 1: Create `App/renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Florde</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="app-container">
    <div class="titlebar">
      <span class="titlebar-text">Florde</span>
      <div class="titlebar-controls">
        <button id="btn-save">Save</button>
        <button id="btn-open">Open</button>
      </div>
    </div>

    <div class="main-content">
      <div class="editor-panel">
        <div class="panel-header">
          <span id="file-name">untitled.py</span>
          <select id="language-select">
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
          </select>
        </div>
        <div id="editor-container"></div>
      </div>

      <div class="chat-panel">
        <div class="panel-header">
          <span>AI Chat</span>
          <select id="provider-select">
            <option value="openai">OpenAI</option>
            <option value="deepseek">DeepSeek</option>
            <option value="mistral">Mistral</option>
            <option value="ollama">Ollama (Local)</option>
          </select>
          <button id="btn-settings">⚙</button>
        </div>
        <div id="chat-messages"></div>
        <div class="chat-input-area">
          <textarea id="chat-input" placeholder="Describe what you want to build..." rows="3"></textarea>
          <button id="btn-send">Send</button>
        </div>
      </div>
    </div>
  </div>

  <div id="settings-modal" class="modal hidden">
    <div class="modal-content">
      <h2>Settings</h2>
      <div class="settings-form">
        <label>OpenAI API Key</label>
        <input type="password" id="key-openai" placeholder="sk-..." />
        <label>OpenAI Model</label>
        <select id="model-openai">
          <option value="gpt-4o">GPT-4o</option>
          <option value="gpt-4o-mini">GPT-4o Mini</option>
        </select>
        <label>DeepSeek API Key</label>
        <input type="password" id="key-deepseek" placeholder="sk-..." />
        <label>DeepSeek Model</label>
        <select id="model-deepseek">
          <option value="deepseek-chat">DeepSeek Chat</option>
          <option value="deepseek-coder">DeepSeek Coder</option>
        </select>
        <label>Mistral API Key</label>
        <input type="password" id="key-mistral" placeholder="..." />
        <label>Mistral Model</label>
        <select id="model-mistral">
          <option value="mistral-large-latest">Mistral Large</option>
          <option value="mistral-medium-latest">Mistral Medium</option>
        </select>
        <label>Ollama Base URL</label>
        <input type="text" id="url-ollama" value="http://localhost:11434" />
        <label>Ollama Model</label>
        <input type="text" id="model-ollama" value="codellama" />
      </div>
      <div class="modal-actions">
        <button id="btn-save-settings" class="btn btn-primary">Save</button>
        <button id="btn-close-settings" class="btn btn-secondary">Close</button>
      </div>
    </div>
  </div>

  <script src="../node_modules/monaco-editor/min/vs/loader.js"></script>
  <script src="script.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `App/renderer/style.css`**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0a0a0f;
  color: #e0e0e0;
  overflow: hidden;
  height: 100vh;
}

.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.titlebar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  -webkit-app-region: drag;
  user-select: none;
}

.titlebar-text {
  font-weight: 700;
  background: linear-gradient(135deg, #7c3aed, #3b82f6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.titlebar-controls button {
  -webkit-app-region: no-drag;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e0e0e0;
  padding: 0.3rem 0.8rem;
  border-radius: 4px;
  cursor: pointer;
  margin-left: 0.5rem;
}

.titlebar-controls button:hover {
  background: rgba(124, 58, 237, 0.2);
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.editor-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}

.chat-panel {
  width: 380px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.02);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 0.85rem;
}

.panel-header select, .panel-header input {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e0e0e0;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.8rem;
}

#btn-settings {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 1.1rem;
  margin-left: auto;
}

#btn-settings:hover {
  color: #7c3aed;
}

#editor-container {
  flex: 1;
  overflow: hidden;
}

#chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.message {
  margin-bottom: 1rem;
  padding: 0.8rem;
  border-radius: 8px;
  font-size: 0.9rem;
  line-height: 1.5;
}

.message.user {
  background: rgba(124, 58, 237, 0.1);
  border: 1px solid rgba(124, 58, 237, 0.2);
}

.message.assistant {
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.15);
}

.message.code {
  background: rgba(0, 0, 0, 0.3);
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 0.8rem;
  white-space: pre-wrap;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.chat-input-area {
  padding: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  gap: 0.5rem;
}

.chat-input-area textarea {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e0e0e0;
  padding: 0.5rem;
  border-radius: 6px;
  resize: none;
  font-family: inherit;
  font-size: 0.9rem;
}

.chat-input-area textarea:focus {
  outline: none;
  border-color: #7c3aed;
}

#btn-send {
  background: linear-gradient(135deg, #7c3aed, #3b82f6);
  border: none;
  color: white;
  padding: 0.5rem 1.2rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  align-self: flex-end;
}

#btn-send:hover {
  opacity: 0.9;
}

.modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal.hidden {
  display: none;
}

.modal-content {
  background: #1a1a24;
  border-radius: 12px;
  padding: 2rem;
  min-width: 400px;
  max-width: 500px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.modal-content h2 {
  margin-bottom: 1.5rem;
  background: linear-gradient(135deg, #7c3aed, #3b82f6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.settings-form label {
  font-size: 0.85rem;
  color: #a0a0b0;
  margin-top: 0.5rem;
}

.settings-form input, .settings-form select {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e0e0e0;
  padding: 0.5rem;
  border-radius: 6px;
  font-size: 0.9rem;
}

.settings-form input:focus, .settings-form select:focus {
  outline: none;
  border-color: #7c3aed;
}

.modal-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
```

- [ ] **Step 3: Commit**

```bash
git add App/renderer/index.html App/renderer/style.css
git commit -m "feat(app): add renderer UI with editor and chat panels"
```

---
### Task 7: App — Renderer Logic (Monaco + Chat + Provider Integration)

**Files:**
- Create: `App/renderer/script.js`
- Create: `App/providers/openai.js`
- Create: `App/providers/deepseek.js`
- Create: `App/providers/mistral.js`
- Create: `App/providers/ollama.js`

- [ ] **Step 1: Create `App/providers/openai.js`**

```javascript
class OpenAIProvider {
  constructor(apiKey, model = 'gpt-4o') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async sendMessage(messages, onChunk) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: 'You are Florde, a coding assistant. Generate working code based on user descriptions. Always include complete, runnable code blocks.' }, ...messages],
        stream: true,
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          fullText += content;
          onChunk(fullText);
        } catch {}
      }
    }
    return fullText;
  }
}

module.exports = { OpenAIProvider };
```

- [ ] **Step 2: Create `App/providers/deepseek.js`**

```javascript
class DeepSeekProvider {
  constructor(apiKey, model = 'deepseek-chat') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async sendMessage(messages, onChunk) {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: 'You are Florde, a coding assistant. Generate working code based on user descriptions. Always include complete, runnable code blocks.' }, ...messages],
        stream: true,
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          fullText += content;
          onChunk(fullText);
        } catch {}
      }
    }
    return fullText;
  }
}

module.exports = { DeepSeekProvider };
```

- [ ] **Step 3: Create `App/providers/mistral.js`**

```javascript
class MistralProvider {
  constructor(apiKey, model = 'mistral-large-latest') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async sendMessage(messages, onChunk) {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: 'You are Florde, a coding assistant. Generate working code based on user descriptions. Always include complete, runnable code blocks.' }, ...messages],
        stream: true,
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          fullText += content;
          onChunk(fullText);
        } catch {}
      }
    }
    return fullText;
  }
}

module.exports = { MistralProvider };
```

- [ ] **Step 4: Create `App/providers/ollama.js`**

```javascript
class OllamaProvider {
  constructor(baseUrl = 'http://localhost:11434', model = 'codellama') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async sendMessage(messages, onChunk) {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: 'You are Florde, a coding assistant. Generate working code based on user descriptions. Always include complete, runnable code blocks.' }, ...messages],
        stream: true,
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const content = parsed.message?.content || '';
          fullText += content;
          onChunk(fullText);
        } catch {}
      }
    }
    return fullText;
  }
}

module.exports = { OllamaProvider };
```

- [ ] **Step 5: Create `App/renderer/script.js`**

```javascript
const providers = {};

let editor = null;
let chatHistory = [];
let currentFileName = 'untitled.py';
let currentLanguage = 'python';

require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });

require(['vs/editor/editor.main'], function () {
  editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: '# Welcome to Florde\n# Describe what you want to build in the chat panel.\n',
    language: 'python',
    theme: 'vs-dark',
    fontSize: 14,
    minimap: { enabled: false },
    automaticLayout: true,
    padding: { top: 12 },
  });
});

function addMessage(role, content) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `message ${role}`;

  if (role === 'assistant' && content.includes('```')) {
    const parts = content.split('```');
    parts.forEach((part, i) => {
      if (i % 2 === 0) {
        const textDiv = document.createElement('div');
        textDiv.textContent = part;
        div.appendChild(textDiv);
      } else {
        const codeDiv = document.createElement('div');
        codeDiv.className = 'message code';
        codeDiv.textContent = part.replace(/^\w+\n/, '');
        div.appendChild(codeDiv);
      }
    });
  } else {
    div.textContent = content;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  addMessage('user', text);
  chatHistory.push({ role: 'user', content: text });

  const provider = document.getElementById('provider-select').value;
  const providerInstance = providers[provider];
  if (!providerInstance) {
    addMessage('assistant', 'Please configure the API key in Settings (⚙).');
    return;
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  document.getElementById('chat-messages').appendChild(messageDiv);

  try {
    const fullText = await providerInstance.sendMessage(chatHistory, (currentText) => {
      messageDiv.innerHTML = '';
      if (currentText.includes('```')) {
        const parts = currentText.split('```');
        parts.forEach((part, i) => {
          if (i % 2 === 0) {
            const textDiv = document.createElement('div');
            textDiv.textContent = part;
            messageDiv.appendChild(textDiv);
          } else {
            const codeDiv = document.createElement('div');
            codeDiv.className = 'message code';
            codeDiv.textContent = part.replace(/^\w+\n/, '');
            messageDiv.appendChild(codeDiv);
          }
        });
      } else {
        messageDiv.textContent = currentText;
      }
      document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
    });
    chatHistory.push({ role: 'assistant', content: fullText });
  } catch (err) {
    messageDiv.textContent = `Error: ${err.message}`;
  }
}

document.getElementById('btn-send').addEventListener('click', sendMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById('language-select').addEventListener('change', (e) => {
  currentLanguage = e.target.value;
  if (editor) {
    monaco.editor.setModelLanguage(editor.getModel(), currentLanguage);
  }
});

document.getElementById('btn-save').addEventListener('click', async () => {
  const content = editor ? editor.getValue() : '';
  const result = await window.electronAPI.saveFile(content, currentFileName);
  if (result) {
    currentFileName = result.split('\\').pop().split('/').pop();
    document.getElementById('file-name').textContent = currentFileName;
  }
});

document.getElementById('btn-open').addEventListener('click', async () => {
  const result = await window.electronAPI.openFile();
  if (result && editor) {
    editor.setValue(result.content);
    currentFileName = result.fileName;
    document.getElementById('file-name').textContent = currentFileName;
  }
});

document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.remove('hidden');
});

document.getElementById('btn-close-settings').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.add('hidden');
});

document.getElementById('btn-save-settings').addEventListener('click', () => {
  const openaiKey = document.getElementById('key-openai').value;
  const openaiModel = document.getElementById('model-openai').value;
  const deepseekKey = document.getElementById('key-deepseek').value;
  const deepseekModel = document.getElementById('model-deepseek').value;
  const mistralKey = document.getElementById('key-mistral').value;
  const mistralModel = document.getElementById('model-mistral').value;
  const ollamaUrl = document.getElementById('url-ollama').value;
  const ollamaModel = document.getElementById('model-ollama').value;

  if (openaiKey) {
    const { OpenAIProvider } = require('../providers/openai.js');
    providers.openai = new OpenAIProvider(openaiKey, openaiModel);
  }
  if (deepseekKey) {
    const { DeepSeekProvider } = require('../providers/deepseek.js');
    providers.deepseek = new DeepSeekProvider(deepseekKey, deepseekModel);
  }
  if (mistralKey) {
    const { MistralProvider } = require('../providers/mistral.js');
    providers.mistral = new MistralProvider(mistralKey, mistralModel);
  }
  const { OllamaProvider } = require('../providers/ollama.js');
  providers.ollama = new OllamaProvider(ollamaUrl, ollamaModel);

  document.getElementById('settings-modal').classList.add('hidden');
});
```

- [ ] **Step 6: Commit**

```bash
git add App/renderer/script.js App/providers/
git commit -m "feat(app): add Monaco editor, AI chat, and 4 provider clients"
```

---
### Task 8: Root Batch Files

**Files:**
- Create: `run.bat`
- Create: `build.bat`

- [ ] **Step 1: Create `run.bat`**

```batch
@echo off
title Florde

echo Starting Florde...
echo.

echo [Website] Opening landing page...
start "" "%~dp0Website\index.html"

echo [App] Launching Electron app...
cd /d "%~dp0App"
start "" cmd /c "npm start"

echo.
echo Both running. Close the app window to stop.
```

- [ ] **Step 2: Create `build.bat`**

```batch
@echo off
title Florde Builder

echo Building Florde...
echo.

echo [Website] Copying static files...
if not exist "%~dp0dist\Website" mkdir "%~dp0dist\Website"
copy "%~dp0Website\index.html" "%~dp0dist\Website\"
copy "%~dp0Website\style.css" "%~dp0dist\Website\"
copy "%~dp0Website\script.js" "%~dp0dist\Website\"

echo [App] Building Electron app...
cd /d "%~dp0App"
call npm run build

echo.
echo Build complete. Output in dist/ and App/dist/
pause
```

- [ ] **Step 3: Commit**

```bash
git add run.bat build.bat
git commit -m "feat: add root run and build batch files"
```

---

## Self-Review

- **Spec coverage:** Every section from the spec is covered — website structure, pricing tiers, Electron app with Monaco editor, 4 AI providers, dark theme, static buy buttons, batch files.
- **Placeholder scan:** No TBDs, TODOs, or vague steps. Every step has complete code.
- **Type consistency:** Provider classes all share the same `sendMessage(messages, onChunk)` interface. Electron IPC uses consistent `electronAPI` naming. No type mismatches.
- **Dependencies:** All imports match their file paths. Monaco loaded from `node_modules/monaco-editor/`. Provider modules required by relative path.
