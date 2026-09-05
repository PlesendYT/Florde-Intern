function registerShellIpc({ ipcMain, shellService }) {
  ipcMain.handle('web-search', async (event, query, numResults = 5) => shellService.webSearch(query, numResults));

  ipcMain.handle('git-status', (event, repoPath) => shellService.gitStatus(repoPath));
  ipcMain.handle('git-diff', (event, repoPath) => shellService.gitDiff(repoPath));
  ipcMain.handle('git-commit', (event, repoPath, name, description) => shellService.gitCommit(repoPath, name, description));
  ipcMain.handle('git-branch-list', (event, repoPath) => shellService.gitBranchList(repoPath));
  ipcMain.handle('git-branch-create', (event, repoPath, name) => shellService.gitBranchCreate(repoPath, name));
  ipcMain.handle('git-branch-delete', (event, repoPath, name) => shellService.gitBranchDelete(repoPath, name));
  ipcMain.handle('git-checkout', (event, repoPath, name) => shellService.gitCheckout(repoPath, name));
  ipcMain.handle('git:exec', (event, repoPath, args) => shellService.gitExec(repoPath, args));
  ipcMain.handle('git-log', (event, repoPath, limit) => shellService.gitLog(repoPath, limit));
  ipcMain.handle('git-blame', (event, repoPath, filePath) => shellService.gitBlame(repoPath, filePath));
  ipcMain.handle('git-diff-file', (event, repoPath, filePath) => shellService.gitDiffFile(repoPath, filePath));
  ipcMain.handle('git-push', (event, repoPath, remote, branch) => shellService.gitPush(repoPath, remote, branch));
  ipcMain.handle('git-pull', (event, repoPath, remote, branch) => shellService.gitPull(repoPath, remote, branch));

  ipcMain.handle('docker:info', () => shellService.dockerInfo());
  ipcMain.handle('docker:ps', () => shellService.dockerPs());
  ipcMain.handle('docker:images', () => shellService.dockerImages());
  ipcMain.handle('docker:start', (event, id) => shellService.dockerStart(id));
  ipcMain.handle('docker:stop', (event, id) => shellService.dockerStop(id));
  ipcMain.handle('docker:restart', (event, id) => shellService.dockerRestart(id));
  ipcMain.handle('docker:logs', (event, id, lines) => shellService.dockerLogs(id, lines));
  ipcMain.handle('docker:compose-up', (event, filePath) => shellService.dockerComposeUp(filePath));
  ipcMain.handle('docker:compose-down', (event, filePath) => shellService.dockerComposeDown(filePath));
  ipcMain.handle('docker:compose-logs', (event, filePath) => shellService.dockerComposeLogs(filePath));

  ipcMain.handle('ollama-list', async () => shellService.ollamaList());
  ipcMain.handle('ollama-pull', async (event, modelName) => shellService.ollamaPull(modelName));
  ipcMain.handle('ollama-delete', async (event, modelName) => shellService.ollamaDelete(modelName));
  ipcMain.handle('ollama-show', async (event, modelName) => shellService.ollamaShow(modelName));
  ipcMain.handle('ollama-ps', async () => shellService.ollamaPs());

  ipcMain.handle('mcp:start-server', (event, id, command, args, env) => shellService.mcpStartServer(id, command, args, env));
  ipcMain.handle('mcp:stop-server', (event, id) => shellService.mcpStopServer(id));

  ipcMain.handle('terminal:create', (event, opts) => shellService.terminalCreate(opts, event.sender));
  ipcMain.handle('terminal:resize', (event, opts) => shellService.terminalResize(opts));
  ipcMain.handle('terminal:write', (event, opts) => shellService.terminalWrite(opts));
  ipcMain.handle('terminal:kill', (event, opts) => shellService.terminalKill(opts));
}

module.exports = { registerShellIpc };