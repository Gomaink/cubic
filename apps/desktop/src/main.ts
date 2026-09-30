import { app, BrowserWindow, Menu, shell, Tray } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDisplayCapture } from './display-capture.js';
import { allowsDisplayCapture, allowsNotifications, allowsPermission, classifyNavigation, CUBIC_ORIGIN } from './security.js';
import { updateMenuAction, type UpdateState } from './update-policy.js';
import { createUpdateController } from './updates.js';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const trayIcon = app.isPackaged
  ? join(process.resourcesPath, 'icons', 'favicon.ico')
  : fileURLToPath(new URL('../../web/static/favicon.ico', import.meta.url));
let updateState: UpdateState = 'idle';
let updaterActive = false;

const updates = createUpdateController((state, active) => {
  updateState = state;
  updaterActive = active;
  refreshTrayMenu();
});

function openCubic(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (app.isReady()) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  if (tray) return;
  tray = new Tray(trayIcon);
  tray.setToolTip('Cubic');
  refreshTrayMenu();
  tray.on('click', openCubic);
}

function refreshTrayMenu(): void {
  if (!tray) return;
  const updateAction = updateMenuAction(updateState, updaterActive);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Cubic', click: openCubic },
    { label: updateAction.label, enabled: updateAction.enabled,
      click: () => {
        if (updateAction.action === 'check') updates.check();
        if (updateAction.action === 'install') updates.restartToUpdate();
      } },
    { type: 'separator' },
    { label: 'Quit Cubic', click: () => app.quit() }
  ]));
}

function openExternal(url: string): void {
  if (classifyNavigation(url) !== 'external') return;
  void shell.openExternal(new URL(url).href).catch(() => {
    // Keep URLs (which may contain user data) out of logs.
    console.warn('Could not open link in the system browser');
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'Cubic',
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#090a11',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  });
  mainWindow = window;

  const contents = window.webContents;
  const browserSession = contents.session; // Default persistent Chromium profile; no cookie copy or custom auth.

  browserSession.setPermissionCheckHandler((requester, permission, origin, details) => {
    if (requester !== contents || !details.isMainFrame) return false;
    if (details.securityOrigin && classifyNavigation(details.securityOrigin) !== 'internal') return false;
    if (permission === 'display-capture') {
      return process.platform === 'win32' &&
        (!details.securityOrigin || details.securityOrigin === CUBIC_ORIGIN) &&
        allowsDisplayCapture(origin, details.requestingUrl, true);
    }
    if (permission === 'notifications') {
      return allowsNotifications(origin, details.requestingUrl, true);
    }
    if (details.requestingUrl && classifyNavigation(details.requestingUrl) !== 'internal') return false;
    return allowsPermission(permission, origin, true, details.mediaType ? [details.mediaType] : undefined);
  });
  browserSession.setPermissionRequestHandler((requester, permission, callback, details) => {
    // PermissionRequest has no securityOrigin in Electron 44; derive it from
    // the document URL only after the exact-origin classifier accepts it.
    const requestOrigin = 'securityOrigin' in details && details.securityOrigin
      ? details.securityOrigin
      : classifyNavigation(details.requestingUrl) === 'internal' ? CUBIC_ORIGIN : undefined;
    let allowed = requester === contents && (permission === 'display-capture'
      ? process.platform === 'win32' &&
        allowsDisplayCapture(requestOrigin, details.requestingUrl, details.isMainFrame)
      : permission === 'notifications'
        ? allowsNotifications(requestOrigin, details.requestingUrl, details.isMainFrame)
        : allowsPermission(permission, details.requestingUrl, details.isMainFrame,
            'mediaTypes' in details ? details.mediaTypes : undefined));
    if ('securityOrigin' in details && details.securityOrigin &&
        classifyNavigation(details.securityOrigin) !== 'internal') allowed = false;
    callback(allowed);
  });
  installDisplayCapture(window);

  const handleNavigation = (url: string, isMainFrame: boolean, preventDefault: () => void) => {
    if (classifyNavigation(url) === 'internal') return;
    preventDefault();
    if (isMainFrame) openExternal(url);
  };
  contents.on('will-frame-navigate', (event) => {
    handleNavigation(event.url, event.isMainFrame, () => event.preventDefault());
  });
  contents.on('will-redirect', (event) => {
    handleNavigation(event.url, event.isMainFrame, () => event.preventDefault());
  });
  contents.setWindowOpenHandler(({ url }) => {
    const kind = classifyNavigation(url);
    if (kind === 'internal') {
      void window.loadURL(new URL(url).href).catch(() => {
        console.warn('Cubic page could not be loaded');
      });
    } else if (kind === 'external') {
      openExternal(url);
    }
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());

  window.once('ready-to-show', () => window.show());
  contents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) window.show();
  });
  window.on('closed', () => { mainWindow = null; });

  void window.loadURL(CUBIC_ORIGIN).catch(() => {
    // TLS/network failure stays failed; never retry over HTTP or bypass certificates.
    window.show();
    console.warn('Cubic page could not be loaded');
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName('Cubic');
  app.on('second-instance', () => {
    openCubic();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => {
    updates.dispose();
    tray?.destroy();
    tray = null;
  });
  void app.whenReady().then(() => {
    createWindow();
    createTray();
    updates.start();
  }).catch(() => app.quit());
}
