// Single Source of Truth für die App-Version ist App/config.json:
//   { "version": "1.0.0" }
// Dieses Skript schreibt sie nach package.json (+ package-lock.json), damit
// build/run/start, electron-builder-Artefakt-Namen und app.getVersion()
// (Update-Check) alle dieselbe Version nutzen. Läuft automatisch als
// npm pre-Hook (predev/prestart/prebuild*), kein manueller Aufruf nötig.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION_RE = /^\d+\.\d+(\.\d+)?([-+.][0-9A-Za-z.+-]+)?$/;

function isValidVersion(v) {
  return typeof v === 'string' && VERSION_RE.test(v.trim());
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function syncVersion(appDir) {
  const dir = appDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const configFile = path.join(dir, 'config.json');
  if (!fs.existsSync(configFile)) {
    throw new Error(`sync-version: ${configFile} fehlt — {"version":"x.y.z"} anlegen`);
  }
  const version = String(readJson(configFile).version || '').trim();
  if (!isValidVersion(version)) {
    throw new Error(`sync-version: ungültige version in config.json: ${JSON.stringify(version)}`);
  }
  let changed = false;
  for (const name of ['package.json', 'package-lock.json']) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    const data = readJson(file);
    let fileChanged = false;
    if (data.version !== version) {
      data.version = version;
      fileChanged = true;
    }
    // npm keeps packages[""].version in sync with the top-level version.
    if (name === 'package-lock.json' && data.packages && data.packages['']) {
      if (data.packages[''].version !== version) {
        data.packages[''].version = version;
        fileChanged = true;
      }
    }
    if (fileChanged) {
      writeJson(file, data);
      changed = true;
    }
  }
  return { version, changed };
}

export { isValidVersion, syncVersion };
export default { isValidVersion, syncVersion };

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const res = syncVersion();
    console.log(`sync-version: ${res.version}${res.changed ? ' (package.json aktualisiert)' : ' (bereits synchron)'}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
