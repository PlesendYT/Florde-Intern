class SubagentInstance {
  constructor(id, parentSessionId, goal, context, permissionCallback, onChunk) {
    this.id = id;
    this.parentSessionId = parentSessionId;
    this.goal = goal;
    this.context = context;
    this.status = 'pending';
    this.summary = '';
    this.createdAt = Date.now();
    this._messages = [];
    this._onChunk = onChunk;
    this._permissionCallback = permissionCallback;
    this._aborted = false;
    this._abortController = null;

    const systemPrompt = `You are a subagent working on a delegated task.
Your job is to complete the assigned goal autonomously.

IMPORTANT RULES:
- You do NOT have access to the spawn_subagent tool. You cannot delegate work.
- Complete the goal using the tools available to you.
- Report your results clearly when done.

Goal: ${goal}

Context from parent agent:
${context}`;

    this._systemPrompt = systemPrompt;
  }

  addMessage(role, content) {
    this._messages.push({ role, content });
    if (this._messages.length > 40) {
      this._messages = [this._messages[0], ...this._messages.slice(-39)];
    }
  }

  async start() {
    if (this.status !== 'pending') return;
    this.status = 'running';
    this._onChunk?.('system', `⚡ Agent '${this.id}' gestartet: ${this.goal}`);
    this.addMessage('user', `Führe folgende Aufgabe aus:\n\n${this.goal}`);
    await this._runConversation();
  }

  abort() {
    this._aborted = true;
    this.status = 'aborted';
    this._abortController?.abort();
    this._onChunk?.('system', `🛑 Agent '${this.id}' abgebrochen`);
  }

  _buildTools() {
    const baseTools = getActiveTools();
    return baseTools.filter(t => t.function?.name !== 'spawn_subagent');
  }

  async _runConversation() {
    const MAX_TURNS = 15;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (this._aborted) return;

      this._onChunk?.('status', `Agent '${this.id}': Runde ${turn + 1}/${MAX_TURNS}`);

      const messages = [
        { role: 'system', content: this._systemPrompt },
        ...this._messages
      ];

      try {
        const response = await this._callAI(messages);

        if (this._aborted) return;

        if (response.tool_call) {
          this._onChunk?.('tool', `Agent '${this.id}': ${response.tool_call.name}(${JSON.stringify(response.tool_call.args)})`);
          const result = await this._executeTool(response.tool_call);
          this.addMessage('assistant', `Tool ${response.tool_call.name} executed.`);
          this.addMessage('user', `Tool result: ${result}`);
        } else {
          const text = response.content || '';
          this.addMessage('assistant', text);
          this.summary = text.slice(0, 500);
          this._onChunk?.('text', text);

          if (this._isDone(text)) {
            this.status = 'completed';
            this._onChunk?.('system', `✅ Agent '${this.id}' abgeschlossen`);
            this._onChunk?.('done', this.summary);
            return;
          }
        }
      } catch (err) {
        if (this._aborted) return;
        this.status = 'failed';
        this.summary = `Fehler: ${err.message}`;
        this._onChunk?.('system', `❌ Agent '${this.id}' fehlgeschlagen: ${err.message}`);
        return;
      }
    }
    this.status = 'completed';
    this.summary = 'Maximale Anzahl an Runden erreicht.';
    this._onChunk?.('system', `⚠️ Agent '${this.id}': Maximale Runden erreicht`);
  }

  _isDone(text) {
    const lower = text.toLowerCase();
    return lower.includes('aufgabe abgeschlossen') ||
           lower.includes('task complete') ||
           lower.includes('i am done') ||
           lower.includes('erledigt') ||
           lower.includes('fertig');
  }

  async _callAI(messages) {
    const session = ChatManager.getActive();
    if (!session) throw new Error('No active chat session');

    const providerId = session.provider || document.getElementById('provider-select')?.value || 'openai';
    const prov = providers[providerId];
    if (!prov) throw new Error('No active provider: ' + providerId);

    const tools = this._buildTools();

    const filteredTools = tools.filter(t => t.function?.name !== 'spawn_subagent');
    const supportsTools = prov.supportsTools ? true : await checkToolSupport(prov, providerId);

    const systemWithTools = { role: 'system', content: this._systemPrompt };
    const reminder = filteredTools.length > 0
      ? { role: 'user', content: buildToolReminder() }
      : null;

    const msgs = reminder
      ? [systemWithTools, reminder, ...this._messages.slice(-30)]
      : [systemWithTools, ...this._messages.slice(-30)];

    this._abortController = new AbortController();

    if (supportsTools && filteredTools.length > 0) {
      const response = await prov.sendWithTools(msgs, filteredTools);
      if (!response) throw new Error('Empty response from provider');

      const content = response.content || '';
      const toolCalls = response.tool_calls;

      if (toolCalls && toolCalls.length > 0) {
        const tc = toolCalls[0];
        return {
          tool_call: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments || '{}')
          }
        };
      }

      this.addMessage('assistant', content);
      return { content };
    } else {
      const response = await prov.sendMessage(msgs, () => {});
      const text = response || '';
      const textCalls = parseTextToolCalls ? parseTextToolCalls(text) : [];
      if (textCalls.length > 0) {
        const tc = textCalls[0];
        return {
          tool_call: {
            name: tc.function?.name || tc.name,
            args: tc.args || {}
          }
        };
      }
      this.addMessage('assistant', text);
      return { content: text };
    }
  }

  async _executeTool(toolCall) {
    if (this._aborted) throw new Error('Aborted');

    if (this._permissionCallback) {
      const allowed = await this._permissionCallback(toolCall.name, toolCall.args);
      if (!allowed) return 'Permission denied: ' + toolCall.name;
    }

    return await executeToolCall(toolCall.name, toolCall.args);
  }
}

class SubagentManager {
  constructor() {
    this._instances = new Map();
    this._nextId = 1;
  }

  create(parentSessionId, goal, context, permissionCallback, onChunk) {
    const id = 'sub-' + (this._nextId++);
    const instance = new SubagentInstance(id, parentSessionId, goal, context, permissionCallback, onChunk);
    this._instances.set(id, instance);
    return instance;
  }

  get(id) {
    return this._instances.get(id);
  }

  getAll() {
    return Array.from(this._instances.values());
  }

  abort(id) {
    const inst = this._instances.get(id);
    if (inst) inst.abort();
  }

  abortAll() {
    for (const inst of this._instances.values()) {
      inst.abort();
    }
  }
}

window.SubagentManager = new SubagentManager();
window._subagentLiveCallback = null;
