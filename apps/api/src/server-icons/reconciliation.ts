import type { Dir } from 'node:fs';
import { lstat, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '@cubic/database';
import { isServerIconKey, isServerIconTempName, ServerIconStore } from './storage.js';

export const SERVER_ICON_ORPHAN_GRACE_MS = 60 * 60 * 1000;
export const SERVER_ICON_RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;
export const SERVER_ICON_RECONCILIATION_BATCH_SIZE = 100;

type Logger = {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
};

export class ServerIconReconciler {
  private directory: Dir | null = null;
  private phase: 'canonical' | 'temporary' = 'canonical';
  private running = false;

  constructor(private readonly options: {
    database: Database;
    store: ServerIconStore;
    logger: Logger;
    graceMs?: number;
    batchSize?: number;
    now?: () => number;
  }) {}

  async runBatch(): Promise<{ inspected: number; deleted: number; referenced: number; recent: number; unexpected: number }> {
    const result = { inspected: 0, deleted: 0, referenced: 0, recent: 0, unexpected: 0 };
    if (this.running) return result;
    this.running = true;
    try {
      await this.options.store.prepare();
      const limit = this.options.batchSize ?? SERVER_ICON_RECONCILIATION_BATCH_SIZE;
      const cutoff = (this.options.now?.() ?? Date.now()) - (this.options.graceMs ?? SERVER_ICON_ORPHAN_GRACE_MS);
      while (result.inspected < limit) {
        this.directory ??= await opendir(this.phase === 'canonical' ? this.options.store.root : this.options.store.tempRoot);
        const entry = await this.directory.read();
        if (!entry) {
          await this.directory.close();
          this.directory = null;
          if (this.phase === 'canonical') { this.phase = 'temporary'; continue; }
          this.phase = 'canonical';
          break;
        }
        result.inspected += 1;
        const isCanonical = this.phase === 'canonical';
        if (!entry.isFile() || !(isCanonical ? isServerIconKey(entry.name) : isServerIconTempName(entry.name))) {
          result.unexpected += 1;
          continue;
        }
        const location = join(isCanonical ? this.options.store.root : this.options.store.tempRoot, entry.name);
        let stat;
        try { stat = await lstat(location); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        if (!stat.isFile() || stat.isSymbolicLink()) { result.unexpected += 1; continue; }
        if (stat.mtimeMs > cutoff) { result.recent += 1; continue; }

        if (isCanonical) {
          // The DB is authoritative. This lookup must be immediately before deletion,
          // not an old page-level snapshot. Keys are immutable and never reassigned.
          const reference = await this.options.database.pool.query(
            'select 1 from servers where icon_key = $1 limit 1', [entry.name]
          );
          if (reference.rowCount) { result.referenced += 1; continue; }
          try { await this.options.store.deleteCanonical(entry.name); result.deleted += 1; }
          catch (error) { this.options.logger.warn({ code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' }, 'Server icon orphan deletion failed; retrying on a later sweep'); }
        } else {
          try { await this.options.store.deleteTemp(entry.name); result.deleted += 1; }
          catch (error) { this.options.logger.warn({ code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' }, 'Server icon temporary deletion failed; retrying on a later sweep'); }
        }
      }
      if (result.inspected > 0) this.options.logger.info(result, 'Server icon reconciliation pass completed');
      return result;
    } finally { this.running = false; }
  }

  async stop(): Promise<void> {
    if (this.directory) await this.directory.close().catch(() => {});
    this.directory = null;
  }
}

export class ServerIconReconciliationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<unknown> | null = null;

  constructor(private readonly reconciler: ServerIconReconciler, private readonly logger: Logger,
    private readonly intervalMs = SERVER_ICON_RECONCILIATION_INTERVAL_MS) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.run(), this.intervalMs);
    this.timer.unref();
    this.run(); // One bounded pass, without blocking API startup.
  }

  private run(): void {
    if (this.current) return;
    this.current = this.reconciler.runBatch().catch((error) => {
      this.logger.warn({ code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' }, 'Server icon reconciliation pass failed');
    }).finally(() => { this.current = null; });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.current;
    await this.reconciler.stop();
  }
}
