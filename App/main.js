const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('save-file', async (event, content, defaultName) => {
  const { filePath: selectedPath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'Code Files', extensions: ['py', 'js', 'ts', 'html', 'css', 'json', 'txt'] }],
  });
  if (selectedPath) {
    fs.writeFileSync(selectedPath, content, 'utf-8');
    return selectedPath;
  }
  return null;
});

ipcMain.handle('open-file', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
  });
  if (filePaths && filePaths[0]) {
    const data = fs.readFileSync(filePaths[0], 'utf-8');
    return { content: data, fileName: path.basename(filePaths[0]) };
  }
  return null;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
