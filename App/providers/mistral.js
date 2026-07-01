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
