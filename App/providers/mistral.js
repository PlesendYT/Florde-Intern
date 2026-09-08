class MistralProvider {
  constructor(apiKey, model = 'mistral-large-latest') {
    this.apiKey = apiKey;
    this.model = model;
  }

  // Security/robustness (b-15): bounded fetch with timeout, HTTP status check,
  // null-body guard, output cap, no silent infinite stream.
  async _post(url, body, timeoutMs = 120000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new Error('Mistral request failed: ' + (e.name === 'AbortError' ? 'timeout' : e.message));
    } finally {
      clearTimeout(timer);
    }
  }

  async sendMessage(messages, onChunk) {
    const response = await this._post('https://api.mistral.ai/v1/chat/completions', {
      model: this.model,
      messages: [{ role: 'system', content: 'You are Florde, a coding assistant. Generate working code based on user descriptions. Always include complete, runnable code blocks.' }, ...messages],
      stream: true,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Mistral API error ${response.status}: ${body.slice(0, 300)}`);
    }
    if (!response.body) throw new Error('Mistral API error: empty response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let badLines = 0;

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
          badLines = 0;
          if (fullText.length > 2000000) throw new Error('Mistral response too large (2MB cap)');
          onChunk(fullText);
        } catch (e) {
          if (e.message && e.message.includes('too large')) throw e;
          if (++badLines > 100) throw new Error('Mistral stream: too many malformed chunks');
        }
      }
    }
    return fullText;
  }
}

module.exports = { MistralProvider };
