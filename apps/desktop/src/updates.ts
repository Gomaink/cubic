import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import updaterPackage from 'electron-updater';
import type { AppUpdater } from 'electron-updater';
import yaml from 'js-yaml';
import { canStartUpdateCheck, isEligiblePreviewUpdate, isTrustedUpdateConfig, type UpdateState, UPDATE_CHECK_INTERVAL_MS } from './update-policy.js';

/** Main-process only. The remote renderer cannot configure or trigger updates. */
export function createUpdateController(onStateChange: (state: UpdateState, active: boolean) => void) {
  let state: UpdateState = 'idle';
  let active = false;
  let pendingCheck: Promise<void> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let installRequested = false;
  let autoUpdater: AppUpdater | null = null;

  const setState = (next: UpdateState) => {
    state = next;
    onStateChange(state, active);
  };
  const getState = () => state;

  const check = () => {
    if (!autoUpdater || !canStartUpdateCheck(active, state, pendingCheck !== null, installRequested)) return;
    const updater = autoUpdater;
    setState('checking');
    pendingCheck = (async () => {
      try {
        const result = await updater.checkForUpdates();
        if (!result?.isUpdateAvailable ||
            !isEligiblePreviewUpdate(app.getVersion(), result.updateInfo.version)) {
          setState('idle');
          return;
        }
        setState('downloading');
        await updater.downloadUpdate();
      } catch {
        setState('idle');
        console.warn('Desktop update check or download failed');
      } finally {
        pendingCheck = null;
        // Only the verified update-downloaded event can expose install.
        if (getState() === 'downloading') setState('idle');
      }
    })();
  };

  const restartToUpdate = () => {
    if (!active || !autoUpdater || state !== 'ready' || installRequested) return;
    installRequested = true;
    if (startupTimer) clearTimeout(startupTimer);
    if (interval) clearInterval(interval);
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch {
      installRequested = false;
      console.warn('Desktop update could not be installed');
    }
  };

  const start = () => {
    if (active || !app.isReady() || !app.isPackaged || process.platform !== 'win32') return;
    try {
      const config = yaml.load(readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8'));
      if (!isTrustedUpdateConfig(config)) throw new Error('Untrusted update configuration');
      autoUpdater = updaterPackage.autoUpdater;
      autoUpdater.logger = null; // Library logs can include provider URLs or local paths.
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.allowPrerelease = true;
      autoUpdater.allowDowngrade = false; // Prerelease/channel setters can enable downgrade.
      autoUpdater.disableWebInstaller = true;
      autoUpdater.on('update-downloaded', () => {
        if (state === 'downloading') setState('ready');
      });
      autoUpdater.on('error', () => {
        if (state !== 'idle') setState('idle');
        installRequested = false;
        console.warn('Desktop update failed');
      });
      active = true;
      onStateChange(state, active);
      startupTimer = setTimeout(check, 30_000);
      interval = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    } catch {
      autoUpdater = null;
      active = false;
      onStateChange(state, active);
      console.warn('Desktop updater is unavailable');
    }
  };

  const dispose = () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (interval) clearInterval(interval);
    startupTimer = null;
    interval = null;
  };

  return { start, check, restartToUpdate, dispose };
}
