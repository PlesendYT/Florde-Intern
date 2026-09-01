export function createTaskClassifier(config = {}) {
  const getAttachedImages = typeof config.getAttachedImages === 'function'
    ? config.getAttachedImages
    : () => [];

  const _rules = [
    {
      task: 'coding',
      patterns: [
        /\b(write|create|implement|fix|debug|refactor|edit|update|change|modify|add|remove|delete)\b.*\b(code|function|class|method|component|file|module|script|bug|error|test)\b/i,
        /\b(code|coding|program|develop|build|compile|deploy|syntax)\b/i,
        /\b(python|javascript|typescript|rust|go|java|c\+\+|ruby|php|swift|kotlin|html|css|sql|bash|shell)\b/i,
        /```[\s\S]*?```/,
        /\b(read_file|write_file|edit_file|list_files|search_files|exec_command)\b/
      ],
      weight: 1.0
    },
    {
      task: 'planning',
      patterns: [
        /\b(plan|planung|architect|design|structure|organize|outline|roadmap|strategy|approach)\b/i,
        /\b(how should|what's the best way|what approach|steps? to|workflow)\b/i,
        /\b(break down|decompose|divide|sequence|order|priority|milestone)\b/i
      ],
      weight: 1.0
    },
    {
      task: 'brainstorming',
      patterns: [
        /\b(brainstorm|ideate|ideas?|suggest|creative|innovative|alternatives?|options?|possibilities)\b/i,
        /\b(what if|could we|maybe we|let's think|imagine|explore)\b/i,
        /\b(pros?\s*(and|&)\s*cons?|trade-?offs?|compare|versus|vs\.?)\b/i
      ],
      weight: 0.9
    },
    {
      task: 'vision',
      patterns: [
        /\b(look at|analyze this image|screenshot|what do you see|describe this picture|ocr|read this text from)\b/i,
        /\.(png|jpg|jpeg|gif|webp|bmp|svg)\b/i,
        /\b(see|visible|display|show in|depicted|illustrated)\b.*\b(image|picture|photo|screenshot|diagram)\b/i
      ],
      weight: 1.0
    },
    {
      task: 'image_generation',
      patterns: [
        /\b(generate|create|draw|make|produce|design)\b.*\b(image|picture|photo|illustration|icon|logo|banner|artwork|graphic)\b/i,
        /\b(dall-?e|midjourney|stable diffusion|image gen|text.to.image)\b/i,
        /\b(design|sketch|mockup|wireframe|ui design)\b/i
      ],
      weight: 1.0
    },
    {
      task: 'tool_calling',
      patterns: [
        /\b(run|execute|execute|install|build|start|stop|restart|deploy)\b.*\b(command|script|server|docker|npm|pip|cargo|brew)\b/i,
        /\b(make_list|make_create|make_update|make_delete|github_|slack_|jira_|notion_)\b/,
        /\b(connect|integrate|api|webhook|service)\b/i
      ],
      weight: 0.8
    },
    {
      task: 'chatting',
      patterns: [
        /.*/
      ],
      weight: 0.3
    }
  ];

  function classify(text) {
    if (!text || typeof text !== 'string') return { primary: 'chatting', confidence: 0.3, secondary: null };

    const scores = {};
    for (const rule of _rules) {
      let matchCount = 0;
      for (const pat of rule.patterns) {
        if (pat.test(text)) matchCount++;
      }
      if (matchCount > 0) {
        scores[rule.task] = (scores[rule.task] || 0) + matchCount * rule.weight;
      }
    }

    const attachedImages = getAttachedImages();
    if (attachedImages && attachedImages.length > 0) {
      scores['vision'] = (scores['vision'] || 0) + 5;
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return { primary: 'chatting', confidence: 0.3, secondary: null };

    const total = sorted.reduce((s, e) => s + e[1], 0);
    const primary = sorted[0][0];
    const confidence = Math.min(sorted[0][1] / total, 1.0);
    const secondary = sorted.length > 1 && sorted[1][1] / total > 0.2 ? sorted[1][0] : null;

    return { primary, confidence, secondary };
  }

  function _riskOf(text) {
    const t = (text || '').toLowerCase();
    const hints = ['delete', 'rm ', 'drop ', 'format', 'clear', 'reset', 'password', 'secret', 'credential', 'chmod', 'sudo', 'usb', 'partition', 'bios', 'remove ', 'uninstal', 'löschen', 'formatieren', 'passwort', 'geheim'];
    const hits = hints.filter(h => t.includes(h)).length;
    if (hits >= 3) return 'high';
    if (hits >= 1) return 'medium';
    return 'low';
  }

  return { classify, _riskOf };
}

export default createTaskClassifier;

if (typeof window !== 'undefined') {
  window.__taskClassifierCore = createTaskClassifier;
}
