class OllamaProvider {
  constructor(baseUrl = 'http://localhost:11434', model = 'qwen2.5-coder') {
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
