const { app, BrowserWindow, shell, screen } = require('electron');
const path = require('node:path');

const isMac = process.platform === 'darwin';

let win = null;

function createWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const availW = workAreaSize.width;
  const availH = workAreaSize.height;

  // The game renders at a fixed 1280x720 and scales via CSS, so pick the
  // largest 16:9 box that fits the display with a little breathing room.
  const margin = 0;
  let width = Math.min(1280, availW - margin);
  let height = Math.round(width * 9 / 16);
  if (height > availH - margin) {
    height = availH - margin;
    width = Math.round(height * 16 / 9);
  }

  win = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 450,
    backgroundColor: '#0a0c12',
    autoHideMenuBar: true,
    // Start maximized only when the display is too small for the 16:9 box.
    fullscreen: false,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
  });

  // Fullscreen toggle: F11 on Win/Linux, also used for the Steam Deck big picture.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.key === 'f' && input.control))) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  win.on('closed', () => {
    win = null;
  });

  // Never navigate away from the bundled game; open real links externally.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

// F11 / fullscreen is handled in-renderer via the same key as the game, so make
// sure the game canvas is told about window size changes.
app.on('browser-window-focus', () => {
  if (win && !win.isDestroyed()) win.webContents.send('window-focus');
});
