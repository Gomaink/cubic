import { desktopCapturer, Menu, type BrowserWindow, type DesktopCapturerSource } from 'electron';
import { allowsDisplayRequest, CUBIC_ORIGIN } from './security.js';

function sourceLabel(name: string, fallback: string): string {
  // Window titles are untrusted text shown only in a native main-process menu.
  const label = name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '').trim().slice(0, 80);
  return (label || fallback).replaceAll('&', '&&');
}

/** Keeps source IDs, titles, and desktopCapturer entirely in the main process. */
export function installDisplayCapture(window: BrowserWindow): void {
  const contents = window.webContents;
  let pendingCancel: (() => void) | null = null;

  contents.session.setDisplayMediaRequestHandler((request, callback) => {
    // Electron 44's runtime/docs accept null to reject capture; its generated
    // callback type incorrectly lists only Streams. Keep the assertion here.
    const deny = () => (callback as (streams: Electron.Streams | null) => void)(null);

    if (pendingCancel) {
      deny();
      return;
    }
    if (process.platform !== 'win32') {
      deny();
      return;
    }

    const eligible = () => {
      const frame = request.frame;
      return !window.isDestroyed() && !contents.isDestroyed() && frame !== null &&
        !frame.isDestroyed() && frame === contents.mainFrame && frame.top === frame &&
        frame.origin === CUBIC_ORIGIN &&
        allowsDisplayRequest(request.securityOrigin, frame.url, true,
          request.userGesture, request.videoRequested);
    };
    if (!eligible()) {
      deny();
      return;
    }

    let settled = false;
    let menu: Menu | null = null;
    let enumerationTimeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (source: DesktopCapturerSource | null) => {
      if (settled) return;
      settled = true;
      if (pendingCancel === cancel) pendingCancel = null;
      if (enumerationTimeout) clearTimeout(enumerationTimeout);
      try {
        if (source && eligible()) callback({ video: { id: source.id, name: source.name } });
        else deny();
      } catch {
        // A frame can disappear between validation and the Electron callback.
        console.warn('Display capture request could not be completed');
      }
    };
    const cancel = () => {
      if (settled) return;
      finish(null);
      if (menu && !window.isDestroyed()) menu.closePopup(window);
    };
    pendingCancel = cancel;
    // Bound source enumeration; the visible picker itself waits for user action.
    enumerationTimeout = setTimeout(cancel, 15_000);

    void desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false
    }).then((sources) => {
      if (settled) return;
      if (enumerationTimeout) clearTimeout(enumerationTimeout);
      enumerationTimeout = null;
      if (!eligible()) return cancel();

      const screens = sources.filter((source) => source.id.startsWith('screen:'));
      const windows = sources.filter((source) => source.id.startsWith('window:'));
      if (screens.length + windows.length === 0) return cancel();

      const choose = (source: DesktopCapturerSource) => () => finish(source);
      menu = Menu.buildFromTemplate([
        { label: 'Share your screen', enabled: false },
        { type: 'separator' },
        ...(screens.length ? [{ label: 'Screens', submenu: screens.map((source, index) => ({
          label: sourceLabel(source.name, `Screen ${index + 1}`), click: choose(source)
        })) }] : []),
        ...(windows.length ? [{ label: 'Windows', submenu: windows.map((source, index) => ({
          label: sourceLabel(source.name, `Window ${index + 1}`), click: choose(source)
        })) }] : []),
        { type: 'separator' },
        { label: 'Cancel', click: cancel }
      ]);
      try {
        menu.popup({ window, callback: cancel });
      } catch {
        cancel();
      }
    }).catch(cancel);
  });

  contents.on('did-start-navigation', (event) => {
    if (event.isMainFrame && !event.isSameDocument) pendingCancel?.();
  });
  contents.on('render-process-gone', () => pendingCancel?.());
  contents.on('destroyed', () => pendingCancel?.());
  window.on('closed', () => pendingCancel?.());
}
