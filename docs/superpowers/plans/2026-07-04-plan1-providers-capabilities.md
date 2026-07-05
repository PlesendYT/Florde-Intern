# Plan 1: Providers & Capabilities

**Files:**
- Modify: `App/renderer/script.js` — provider list, capability detection, model info
- Modify: `App/renderer/index.html` — settings UI for new providers
- Modify: `App/renderer/style.css` — model info indicator styles
- Modify: `App/preload.js` — expose new APIs if needed
- Modify: `App/main.js` — IPC handlers if needed

## Tasks

### Task 1: OpenCode Provider
- Add "OpenCode" to provider list in `loadSettings`/`validateAndSaveSettings`
- API-compatible (OpenAI-format endpoint)
- Fields: Base URL (custom), API Key, Model Name
- Reuse existing OpenAI-compatible chat completion logic

### Task 2: Mistral Models
- In existing Mistral provider: add model options `devstral`, `codestral`, `mistral-tiny`
- Each with version variants in dropdown
- Map model names to API model strings for Mistral API

### Task 3: Tool Capability Detection
- Before first AI request to a model: send small test prompt to check tool support
- If tools supported → use `tools` API parameter
- If not → inject tool descriptions into system prompt, parse tool calls from response text
- Cache result in memory per session

### Task 4: Capability Detection System
- On model first load: run capability tests (Tool Calling, Thinking, Streaming, JSON Mode, Vision, Images, Embeddings, Function Calling, Custom Temperature, Seed, Context Caching)
- On "Save" in settings: persist results to localStorage
- Capabilities shown in model info popup

### Task 5: Temperature Per Provider
- Add temperature slider in each provider's settings section
- Default: 0.7
- Disabled when capability `custom_temperature` is false
- Passed in API calls when supported

### Task 6: Model Info Indicator
- Show active model name in editor (small badge)
- Click/hover opens detail popup: limits, rate, costs, context, RAM/VRAM, capabilities, avg response time, tokens/sec, tool success rate, temperature
- For local models: show RAM/VRAM usage (via `ollama ps` or similar)

### Task 7: Free/API-Key Indicator
- Icon next to model name in selector: `🆓` for free, `🔑` for API-key required
- Based on provider config
