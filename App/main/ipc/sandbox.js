function registerSandboxIpc({ ipcMain, sandboxService }) {
  ipcMain.handle('get-sandbox-dir', () => sandboxService.getSandboxDir());

  ipcMain.handle('sandbox-list-files', (event, sandboxPath) => sandboxService.listSandboxFiles(sandboxPath));
  ipcMain.handle('sandbox-read-file', (event, sandboxPath, filePath) => sandboxService.readSandboxFile(sandboxPath, filePath));
  ipcMain.handle('sandbox-write-file', (event, sandboxPath, filePath, content) => sandboxService.writeSandboxFile(sandboxPath, filePath, content));
  ipcMain.handle('sandbox-delete-file', (event, sandboxPath, filePath) => sandboxService.deleteSandboxFile(sandboxPath, filePath));
  ipcMain.handle('sandbox-exec', (event, sandboxPath, command) => sandboxService.execSandboxCommand(sandboxPath, command));

  ipcMain.handle('sandbox:exec', async (event, command, options) => sandboxService.exec(command, options));
  ipcMain.handle('sandbox:read-file', async (event, filePath) => sandboxService.readFile(filePath));
  ipcMain.handle('sandbox:write-file', async (event, filePath, content) => sandboxService.writeFile(filePath, content));
  ipcMain.handle('sandbox:list-files', async (event, dirPath) => sandboxService.listFiles(dirPath));
  ipcMain.handle('sandbox:delete-file', async (event, filePath) => sandboxService.deleteFile(filePath));
  ipcMain.handle('sandbox:switch', async (event, type) => sandboxService.switchBackend(type));
  ipcMain.handle('sandbox:detect', async () => sandboxService.detect());
  ipcMain.handle('sandbox:recommend', async (event, spec) => sandboxService.recommend(spec));
  ipcMain.handle('sandbox:status', async () => sandboxService.status());

  ipcMain.handle('sandbox:vm-screenshot', async () => sandboxService.screenshot());
  ipcMain.handle('sandbox:vm-snapshot', async (event, name) => sandboxService.createSnapshot(name));
  ipcMain.handle('sandbox:vm-mouse', async (event, x, y, button) => sandboxService.sendMouse(x, y, button));
  ipcMain.handle('sandbox:vm-key', async (event, key) => sandboxService.sendKey(key));

  ipcMain.handle('sandbox:get-config', () => sandboxService.getConfig());
  ipcMain.handle('sandbox:set-config', (event, cfg) => sandboxService.setConfig(cfg));
  ipcMain.handle('sandbox:set-network', async (event, network) => sandboxService.setNetwork(network));

  ipcMain.handle('sandbox:list-templates', () => sandboxService.listTemplates());
  ipcMain.handle('sandbox:download-image', async (event, templateKey) => sandboxService.downloadImage(templateKey));

  ipcMain.handle('sandbox:vm-stream-start', async (event, opts) => sandboxService.vmStreamStart(opts));
  ipcMain.handle('sandbox:vm-stream-stop', () => sandboxService.vmStreamStop());

  ipcMain.handle('download-sandbox-file', async (event, sourcePath) => sandboxService.downloadFile(sourcePath));

  ipcMain.handle('sandbox:get-permission-rules', (event, project) => sandboxService.getPermissionRules(project));
  ipcMain.handle('sandbox:set-permission-rule', (event, rule) => sandboxService.addPermissionRule(rule));
  ipcMain.handle('sandbox:remove-permission-rule', (event, rule) => sandboxService.removePermissionRule(rule));
}

module.exports = { registerSandboxIpc };