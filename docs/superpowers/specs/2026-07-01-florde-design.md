# Florde — Design Specification

## Overview
A two-part product: a marketing website (landing + e-commerce) and an Electron desktop app (AI coding tutor). The product is named **Florde**. Users discover the product via the website, purchase a license, and use the desktop app to generate code from natural language.

## Project Structure
```
Florde/
├── Website/          # Static marketing site
│   ├── index.html    # All-in-one landing page
│   ├── style.css     # Styles
│   └── script.js     # Interactivity
├── App/              # Electron desktop app
│   ├── main.js       # Electron main process
│   ├── preload.js    # Context bridge
│   ├── renderer/     # UI files
│   │   ├── index.html
│   │   ├── style.css
│   │   └── script.js
│   ├── providers/    # AI provider clients
│   │   ├── openai.js
│   │   ├── deepseek.js
│   │   ├── mistral.js
│   │   └── ollama.js
│   └── package.json
├── run.bat           # Launches both in dev mode
└── build.bat         # Builds both for production
```

## Website (Plain HTML/CSS/JS)
- Single scrollable landing page
- Sections: Hero, How It Works, Features/Bonuses, Pricing (3 tiers), Footer
- Static "Buy Now" buttons (placeholder — no real payment processing)
- Modern design: clean typography, gradient accents, smooth scrolling, responsive

## Electron App (Monaco Editor + Multi-Provider AI Chat)
- Split-panel layout: Monaco editor (left) + AI chat (right)
- Provider selector: OpenAI, DeepSeek, Mistral, Ollama
- Settings modal for API keys and model selection per provider
- Chat panel: conversation history, code blocks rendered with syntax highlighting, send button
- Editor panel: full Monaco editor, file name display, save functionality
- AI provider architecture: common interface (prompt → stream response), each provider implements it

## AI Provider Interface
```
sendMessage(messages, onChunk) → stream response text
```
Each provider adapts its own API format to this interface. Ollama runs locally (http://localhost:11434).

## Design Style: Modern
- Dark theme with gradient accents (purple/blue)
- Smooth transitions and micro-animations
- Glassmorphism panels
- Clean, sans-serif typography
- Responsive down to tablet

## Out of Scope (v1)
- Real payment processing
- User accounts / authentication
- Project save/load system
- File tree explorer
- Code execution
