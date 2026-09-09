const { contextBridge, ipcRenderer } = require('electron');
// Security (b-03): child_process.spawn is NEVER exposed to the renderer.
// MCP servers start exclusively via the main-process 'mcp:start-server' IPC
// (allowlisted in ShellService.mcpStartServer).

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  listProjects: () => ipcRenderer.invoke('list-projects'),
  createSandboxProject: (n) => ipcRenderer.invoke('create-sandbox-project', n),
  createLocalProject: (n, p) => ipcRenderer.invoke('create-local-project', n, p),
  deleteProject: (n) => ipcRenderer.invoke('delete-project', n),

  loadSession: (n) => ipcRenderer.invoke('load-session', n),
  saveSession: (n, d) => ipcRenderer.invoke('save-session', n, d),

  projectListFiles: (n) => ipcRenderer.invoke('project-list-files', n),
  projectReadFile: (n, f) => ipcRenderer.invoke('project-read-file', n, f),
  projectWriteFile: (n, f, c) => ipcRenderer.invoke('project-write-file', n, f, c),
  projectDeleteFile: (n, f) => ipcRenderer.invoke('project-delete-file', n, f),
  projectRenameFile: (n, o, n2) => ipcRenderer.invoke('project-rename-file', n, o, n2),

  getProjectRoot: (n) => ipcRenderer.invoke('get-project-root', n),
  searchInFiles: (n, q) => ipcRenderer.invoke('search-in-files', n, q),

  exportZip: (n) => ipcRenderer.invoke('export-zip', n),

  getSandboxDir: () => ipcRenderer.invoke('get-sandbox-dir'),
  sandboxListFiles: (s) => ipcRenderer.invoke('sandbox-list-files', s),
  sandboxReadFile: (s, f) => ipcRenderer.invoke('sandbox-read-file', s, f),
  sandboxWriteFile: (s, f, c) => ipcRenderer.invoke('sandbox-write-file', s, f, c),
  sandboxDeleteFile: (s, f) => ipcRenderer.invoke('sandbox-delete-file', s, f),
  sandboxExec: (s, c) => ipcRenderer.invoke('sandbox-exec', s, c),
  downloadSandboxFile: (s) => ipcRenderer.invoke('download-sandbox-file', s),

  sandbox: {
    exec: (cmd, opts) => ipcRenderer.invoke('sandbox:exec', cmd, opts),
    readFile: (p) => ipcRenderer.invoke('sandbox:read-file', p),
    writeFile: (p, c) => ipcRenderer.invoke('sandbox:write-file', p, c),
    listFiles: (p) => ipcRenderer.invoke('sandbox:list-files', p),
    deleteFile: (p) => ipcRenderer.invoke('sandbox:delete-file', p),
    switchBackend: (t) => ipcRenderer.invoke('sandbox:switch', t),
    detect: () => ipcRenderer.invoke('sandbox:detect'),
    recommend: (s) => ipcRenderer.invoke('sandbox:recommend', s),
    status: () => ipcRenderer.invoke('sandbox:status'),
    vmScreenshot: () => ipcRenderer.invoke('sandbox:vm-screenshot'),
    vmSnapshot: (n) => ipcRenderer.invoke('sandbox:vm-snapshot', n),
    vmMouse: (x, y, b) => ipcRenderer.invoke('sandbox:vm-mouse', x, y, b),
    vmKey: (k) => ipcRenderer.invoke('sandbox:vm-key', k),
    getConfig: () => ipcRenderer.invoke('sandbox:get-config'),
    setConfig: (cfg) => ipcRenderer.invoke('sandbox:set-config', cfg),
    setNetwork: (n) => ipcRenderer.invoke('sandbox:set-network', n),
    vmStreamStart: (o) => ipcRenderer.invoke('sandbox:vm-stream-start', o),
    vmStreamStop: () => ipcRenderer.invoke('sandbox:vm-stream-stop'),
    listTemplates: () => ipcRenderer.invoke('sandbox:list-templates'),
    downloadImage: (key) => ipcRenderer.invoke('sandbox:download-image', key),
    getPermissionRules: (project) => ipcRenderer.invoke('sandbox:get-permission-rules', project),
    setPermissionRule: (rule) => ipcRenderer.invoke('sandbox:set-permission-rule', rule),
    removePermissionRule: (rule) => ipcRenderer.invoke('sandbox:remove-permission-rule', rule),
    getCustomTools: (project) => ipcRenderer.invoke('sandbox:get-custom-tools', project),
    setCustomTools: (project, tools) => ipcRenderer.invoke('sandbox:set-custom-tools', project, tools),
    removeProjectVolumes: (project) => ipcRenderer.invoke('sandbox:remove-project-volumes', project),
  },

  watchProject: (n) => ipcRenderer.invoke('watch-project', n),
  unwatchProject: (n) => ipcRenderer.invoke('unwatch-project', n),
  onFileChanged: (callback) => {
    const handler = (_event, project, file) => callback(project, file);
    ipcRenderer.on('file-changed', handler);
    return () => ipcRenderer.removeListener('file-changed', handler);
  },

  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectNewFolder: () => ipcRenderer.invoke('select-new-folder'),

  setFullscreen: (fs) => ipcRenderer.invoke('set-fullscreen', fs),
  isFullScreen: () => ipcRenderer.invoke('is-full-screen'),

  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (e) => ipcRenderer.invoke('set-auto-start', e),

  getPlugins: () => ipcRenderer.invoke('get-plugins'),
  savePlugins: (d) => ipcRenderer.invoke('save-plugins', d),

  webSearch: (q, n) => ipcRenderer.invoke('web-search', q, n),
  ollamaList: () => ipcRenderer.invoke('ollama-list'),

  ollama: {
    list: () => ipcRenderer.invoke('ollama-list'),
    pull: (name) => ipcRenderer.invoke('ollama-pull', name),
    delete: (name) => ipcRenderer.invoke('ollama-delete', name),
    show: (name) => ipcRenderer.invoke('ollama-show', name),
    ps: () => ipcRenderer.invoke('ollama-ps'),
  },

  gitStatus: (p) => ipcRenderer.invoke('git-status', p),
  gitDiff: (p) => ipcRenderer.invoke('git-diff', p),
  gitDiffFile: (p, f) => ipcRenderer.invoke('git-diff-file', p, f),
  gitCommit: (p, n, d) => ipcRenderer.invoke('git-commit', p, n, d),
  gitBranchList: (p) => ipcRenderer.invoke('git-branch-list', p),
  gitBranchCreate: (p, n) => ipcRenderer.invoke('git-branch-create', p, n),
  gitBranchDelete: (p, n) => ipcRenderer.invoke('git-branch-delete', p, n),
  gitCheckout: (p, n) => ipcRenderer.invoke('git-checkout', p, n),
  gitLog: (p, l) => ipcRenderer.invoke('git-log', p, l),
  gitBlame: (p, f) => ipcRenderer.invoke('git-blame', p, f),
  gitPush: (p, r, b) => ipcRenderer.invoke('git-push', p, r, b),
  gitPull: (p, r, b) => ipcRenderer.invoke('git-pull', p, r, b),
  gitExec: (p, args) => ipcRenderer.invoke('git:exec', p, args),

  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),

  mcpExec: {
    spawn: (id, command, args, env) => ipcRenderer.invoke('mcp:start-server', id, command, args, env),
    kill: (id) => ipcRenderer.invoke('mcp:stop-server', id),
  },

  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  browser: {
    open: (url) => ipcRenderer.invoke('browser:open', url),
    navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
    evaluate: (js) => ipcRenderer.invoke('browser:evaluate', js),
    capturePage: () => ipcRenderer.invoke('browser:capture-page'),
    goBack: () => ipcRenderer.invoke('browser:go-back'),
    goForward: () => ipcRenderer.invoke('browser:go-forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    close: () => ipcRenderer.invoke('browser:close'),
    isOpen: () => ipcRenderer.invoke('browser:is-open'),
    onClosed: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('browser-closed', handler);
      return () => ipcRenderer.removeListener('browser-closed', handler);
    }
  },

  keychain: {
    store: (opts) => ipcRenderer.invoke('keychain:store', opts),
    retrieve: (opts) => ipcRenderer.invoke('keychain:retrieve', opts),
    delete: (opts) => ipcRenderer.invoke('keychain:delete', opts),
    list: () => ipcRenderer.invoke('keychain:list')
  },

  docker: {
    ps: () => ipcRenderer.invoke('docker:ps'),
    images: () => ipcRenderer.invoke('docker:images'),
    start: (id) => ipcRenderer.invoke('docker:start', id),
    stop: (id) => ipcRenderer.invoke('docker:stop', id),
    restart: (id) => ipcRenderer.invoke('docker:restart', id),
    logs: (id, lines) => ipcRenderer.invoke('docker:logs', id, lines),
    info: () => ipcRenderer.invoke('docker:info'),
    composeUp: (file) => ipcRenderer.invoke('docker:compose-up', file),
    composeDown: (file) => ipcRenderer.invoke('docker:compose-down', file),
    composeLogs: (file) => ipcRenderer.invoke('docker:compose-logs', file),
  },

  flordeDb: {
    ensureDir: (n) => ipcRenderer.invoke('florde:ensure-dir', n),
    initDb: (n) => ipcRenderer.invoke('florde:init-db', n),
    get: (n, ns, k) => ipcRenderer.invoke('florde:get', n, ns, k),
    set: (n, ns, k, v) => ipcRenderer.invoke('florde:set', n, ns, k, v),
    delete: (n, ns, k) => ipcRenderer.invoke('florde:delete', n, ns, k),
    getAll: (n, ns) => ipcRenderer.invoke('florde:get-all', n, ns),
    query: (n, sql, params) => ipcRenderer.invoke('florde:query', n, sql, params),
    run: (n, sql, params) => ipcRenderer.invoke('florde:run', n, sql, params),
    transaction: (n, statements) => ipcRenderer.invoke('florde:transaction', n, statements),
    close: (n) => ipcRenderer.invoke('florde:close', n),
    getDbPath: (n) => ipcRenderer.invoke('florde:get-db-path', n),
  },

  flordeDir: {
    check: (n) => ipcRenderer.invoke('florde:check-dir', n),
    remove: (n) => ipcRenderer.invoke('florde:remove-dir', n),
    getGitignoreState: (n) => ipcRenderer.invoke('florde:get-gitignore-state', n),
    setGitignoreEntry: (n, e, x) => ipcRenderer.invoke('florde:set-gitignore-entry', n, e, x),
    getPath: (n) => ipcRenderer.invoke('florde:get-dir-path', n),
  },

  flordeFs: {
    memoryRead: (project, file) => ipcRenderer.invoke('florde:memory-read', project, file),
    memoryWrite: (project, file, content) => ipcRenderer.invoke('florde:memory-write', project, file, content),
    memoryList: (project) => ipcRenderer.invoke('florde:memory-list', project),
    tempRead: (project, file) => ipcRenderer.invoke('florde:temp-read', project, file),
    tempWrite: (project, file, content) => ipcRenderer.invoke('florde:temp-write', project, file, content),
    tempList: (project) => ipcRenderer.invoke('florde:temp-list', project),
    tempDelete: (project, file) => ipcRenderer.invoke('florde:temp-delete', project, file),
  },

  terminal: {
    create: (opts) => ipcRenderer.invoke('terminal:create', opts),
    resize: (opts) => ipcRenderer.invoke('terminal:resize', opts),
    write: (opts) => ipcRenderer.invoke('terminal:write', opts),
    kill: (opts) => ipcRenderer.invoke('terminal:kill', opts),
    onData: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('terminal:data', handler);
      return () => ipcRenderer.removeListener('terminal:data', handler);
    },
    onExit: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('terminal:exit', handler);
      return () => ipcRenderer.removeListener('terminal:exit', handler);
    }
  },

  translation: {
    getCache: () => ipcRenderer.invoke('translation:get-cache'),
    saveCache: (cache) => ipcRenderer.invoke('translation:save-cache', cache),
    translate: (text, sl, tl) => ipcRenderer.invoke('translation:translate', text, sl, tl),
  },
});

contextBridge.exposeInMainWorld('onVmFrame', (cb) => {
  ipcRenderer.on('sandbox:vm-frame', (e, frame) => cb(frame));
});

contextBridge.exposeInMainWorld('onDownloadProgress', (cb) => {
  ipcRenderer.on('sandbox:download-progress', (e, p) => cb(p));
});

contextBridge.exposeInMainWorld('onPermissionRequest', (cb) => {
  ipcRenderer.on('sandbox:permission-request', (_e, info) => cb(info));
});

contextBridge.exposeInMainWorld('respondPermission', (payload) => {
  // Security (b-11): normalize to the {requestId, decision, persist} shape the
  // main handler correlates. Raw strings stay supported for compat.
  let out;
  if (payload && typeof payload === 'object' && typeof payload.decision === 'string') {
    out = {
      requestId: typeof payload.requestId === 'string' ? payload.requestId : null,
      decision: payload.decision,
      persist: payload.persist === 'always' ? 'always' : 'once',
    };
  } else if (typeof payload === 'string') {
    out = { requestId: null, decision: payload, persist: 'once' };
  } else {
    return;
  }
  if (!['allow', 'block'].includes(out.decision)) return;
  ipcRenderer.send('sandbox:permission-respond', out);
});
