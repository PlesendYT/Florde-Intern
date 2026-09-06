// Main-seitige Risiko-Klassifizierung von Shell-Kommandos.
// Spiegelt renderer/domains/tools/registry.js:assessShellRisk als CommonJS, damit
// die Sicherheit nicht nur client-seitig, sondern auch im Main-Prozess greift.
const PATTERNS = {
  critical: [
    /\brm\s+-rf\s+\/\s*$/mi, /\bformat\b/i, /\bdd\s+if=\/dev\/zero/i,
    /\bmkfs\b/i, /grub-install|fdisk|mbr/i, /:\(\)\s*\{|fork\s+bomb/i,
    /chmod\s+777\s+\//i, /mv\s+\/\s+\/dev\/null/i,
  ],
  high: [
    /\bsudo\b/i, /\brm\s+-rf\b/i, /\bcurl\b.*\|\s*(?:bash|sh)\b/i,
    /\bwget\b.*\|\s*(?:bash|sh)\b/i, /\bchmod\s+-R\s+777\b/i,
    /\bnmap\b/i,     /\bapt(?:-get)?\s+(?:install|remove|purge)\b/i,
    /\bpip\s+install\b/i, /\bnpm\s+(?:install|publish|delete)\s+-g\b/i,
  ],
  medium: [
    /\bnpm\s+(?:install|publish)\b/i, /\bgit\s+push\b/i,
    /\bpip\s+install\b/i, /\bchmod\b/i, /\bkill\b/i,
    /\bsystemctl\b/i, /\bservice\b/i,
  ],
  low: [
    /\bmkdir\b/i, /\btouch\b/i, /\becho\s+>/, /\bmv\b/i, /\bcp\b/i,
    /\bcd\b/i, /\bnano\b/i, /\bvi\b/i, /\bcode\b/i,
  ],
  safe: [
    /\bls\b/i, /\bpwd\b/i, /\bcat\b/i, /\bhead\b/i, /\btail\b/i,
    /\bgrep\b/i, /\bfind\b/i, /\bwhich\b/i, /\bwhoami\b/i, /\bdate\b/i,
    /\bwc\b/i, /\bsort\b/i, /\buniq\b/i, /\bless\b/i, /\bmore\b/i,
    /\bps\b/i, /\bdf\b/i, /\bdu\b/i,
  ],
};

function assessCommandRisk(command) {
  for (const [level, regexps] of Object.entries(PATTERNS)) {
    for (const re of regexps) {
      if (re.test(command || '')) return level;
    }
  }
  return 'safe';
}

module.exports = { assessCommandRisk };
