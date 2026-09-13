import type { Dir } from 'node:fs';
import { lstat, opendir } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import type { Database } from '@cubic/database';
import { lockAttachmentStorageKey } from './attachment-locks.js';
import {
  isManagedAttachmentKey,
  stagingUploadKeyFromName,
  type AttachmentStore
} from './attachments.js';
import { sanitizeDeletionErrorCode } from './attachment-deletions.js';

const RECONCILIATION_LOCK_NAME = 'cubic:attachment-reconciliation';

type ReconciliationLogger = {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
};

export type AttachmentReconciliationResult = {
  lockAcquired: boolean;
  inspectedEntries: number;
  queuedOrphans: number;
  preservedRecent: number;
  preservedUnexpected: number;
  databaseUncertain: number;
  restoredStaging: number;
  deletedStaging: number;
  missingFiles: number;
  sweepCompleted: boolean;
};

export class AttachmentReconciler {
  private sweepClient: PoolClient | null = null;
  private directory: Dir | null = null;
  private phase: 'final' | 'staging' = 'final';
  private databaseCursor: string | null = null;

  constructor(
    private readonly options: {
      database: Database;
      attachmentStore: AttachmentStore;
      gracePeriodMs: number;
      scanBatchSize: number;
      missingBatchSize: number;
      logger: ReconciliationLogger;
    }
  ) {}

  async runBatch(now = new Date()): Promise<AttachmentReconciliationResult> {
    const result: AttachmentReconciliationResult = {
      lockAcquired: false,
      inspectedEntries: 0,
      queuedOrphans: 0,
      preservedRecent: 0,
      preservedUnexpected: 0,
      databaseUncertain: 0,
      restoredStaging: 0,
      deletedStaging: 0,
      missingFiles: 0,
      sweepCompleted: false
    };

    if (!(await this.ensureSweep())) return result;
    result.lockAcquired = true;

    try {
      while (result.inspectedEntries < this.options.scanBatchSize) {
        const entry = await this.directory!.read();
        if (!entry) {
          await this.directory!.close();
          this.directory = null;
          if (this.phase === 'final') {
            this.phase = 'staging';
            this.directory = await openManagedDirectory(
              this.options.attachmentStore.stagingRoot
            );
            continue;
          }

          result.sweepCompleted = true;
          await this.releaseSweep();
          break;
        }

        result.inspectedEntries += 1;
        if (!entry.isFile() || entry.isSymbolicLink()) {
          result.preservedUnexpected += 1;
          continue;
        }

        const location = this.phase;
        const stagingUploadKey = location === 'staging'
          ? stagingUploadKeyFromName(entry.name)
          : null;
        if (location === 'staging' && !stagingUploadKey && !isManagedAttachmentKey(entry.name)) {
          result.preservedUnexpected += 1;
          continue;
        }
        if (location === 'final' && !isManagedAttachmentKey(entry.name)) {
          result.preservedUnexpected += 1;
          continue;
        }

        const storageKey = stagingUploadKey ?? entry.name;
        const inspection = stagingUploadKey
          ? await this.options.attachmentStore.inspectStagingUpload(stagingUploadKey)
          : await this.options.attachmentStore.inspect(storageKey, location);
        if (!inspection.exists || !inspection.regular) {
          result.preservedUnexpected += 1;
          continue;
        }
        if (inspection.modifiedAtMs > now.getTime() - this.options.gracePeriodMs) {
          result.preservedRecent += 1;
          continue;
        }

        if (location === 'final') {
          const outcome = await this.reconcileFinal(storageKey);
          if (outcome === 'queued') result.queuedOrphans += 1;
          if (outcome === 'uncertain') result.databaseUncertain += 1;
        } else if (stagingUploadKey) {
          const outcome = await this.cleanupStagingUpload(stagingUploadKey);
          if (outcome === 'deleted') result.deletedStaging += 1;
          if (outcome === 'uncertain') result.databaseUncertain += 1;
        } else {
          const outcome = await this.reconcileStaging(storageKey);
          if (outcome === 'restored') result.restoredStaging += 1;
          if (outcome === 'deleted') result.deletedStaging += 1;
          if (outcome === 'uncertain') result.databaseUncertain += 1;
        }
      }

      result.missingFiles = await this.detectMissingFiles();
      this.options.logger.info(
        { ...result },
        'Attachment reconciliation batch completed'
      );
      return result;
    } catch (error) {
      await this.releaseSweep();
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.releaseSweep();
  }

  private async ensureSweep(): Promise<boolean> {
    if (this.sweepClient && this.directory) return true;

    const client = await this.options.database.pool.connect();
    try {
      const lock = await client.query<{ acquired: boolean }>(
        'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
        [RECONCILIATION_LOCK_NAME]
      );
      if (!lock.rows[0]?.acquired) {
        client.release();
        return false;
      }

      this.sweepClient = client;
      this.phase = 'final';
      this.directory = await openManagedDirectory(this.options.attachmentStore.root);
      return true;
    } catch (error) {
      client.release();
      throw error;
    }
  }

  private async releaseSweep(): Promise<void> {
    const directory = this.directory;
    const client = this.sweepClient;
    this.directory = null;
    this.sweepClient = null;
    this.phase = 'final';

    if (directory) await directory.close().catch(() => {});
    if (client) {
      await client.query(
        'select pg_advisory_unlock(hashtextextended($1, 0))',
        [RECONCILIATION_LOCK_NAME]
      ).catch(() => {});
      client.release();
    }
  }

  private async reconcileFinal(
    storageKey: string
  ): Promise<'kept' | 'queued' | 'uncertain'> {
    const client = this.sweepClient!;
    try {
      await client.query('begin');
      await lockAttachmentStorageKey(client, storageKey);
      const metadata = await client.query(
        'select 1 from attachments where storage_key = $1 limit 1',
        [storageKey]
      );
      if (metadata.rowCount) {
        await client.query('commit');
        return 'kept';
      }

      const queued = await client.query(
        `insert into attachment_file_deletions (storage_key, reason)
         values ($1, 'orphan')
         on conflict (storage_key) do nothing
         returning id`,
        [storageKey]
      );
      await client.query('commit');
      return queued.rowCount ? 'queued' : 'kept';
    } catch (error) {
      await client.query('rollback').catch(() => {});
      this.options.logger.warn(
        { errorCode: sanitizeDeletionErrorCode(error) },
        'Could not authoritatively classify an attachment filesystem entry; it was preserved'
      );
      return 'uncertain';
    }
  }

  private async reconcileStaging(
    storageKey: string
  ): Promise<'restored' | 'deleted' | 'uncertain'> {
    const client = this.sweepClient!;
    try {
      await client.query('begin');
      await lockAttachmentStorageKey(client, storageKey);
      const metadata = await client.query(
        'select 1 from attachments where storage_key = $1 limit 1',
        [storageKey]
      );
      if (metadata.rowCount) {
        const final = await this.options.attachmentStore.inspect(storageKey, 'final');
        if (!final.exists) {
          await this.options.attachmentStore.publish(storageKey);
          await client.query('commit');
          return 'restored';
        }
      }

      await this.options.attachmentStore.discardStaged(storageKey);
      await client.query('commit');
      return 'deleted';
    } catch (error) {
      await client.query('rollback').catch(() => {});
      this.options.logger.warn(
        { errorCode: sanitizeDeletionErrorCode(error) },
        'Could not reconcile a staged attachment file; it was preserved for retry'
      );
      return 'uncertain';
    }
  }

  private async cleanupStagingUpload(
    storageKey: string
  ): Promise<'deleted' | 'kept' | 'uncertain'> {
    const client = this.sweepClient!;
    try {
      await client.query('begin');
      await lockAttachmentStorageKey(client, storageKey);
      const metadata = await client.query(
        'select 1 from attachments where storage_key = $1 limit 1',
        [storageKey]
      );
      if (metadata.rowCount) {
        await client.query('commit');
        return 'kept';
      }

      await this.options.attachmentStore.discardStagingUpload(storageKey);
      await client.query('commit');
      return 'deleted';
    } catch (error) {
      await client.query('rollback').catch(() => {});
      this.options.logger.warn(
        { errorCode: sanitizeDeletionErrorCode(error) },
        'Could not remove a stale staged upload; it was preserved for retry'
      );
      return 'uncertain';
    }
  }

  private async detectMissingFiles(): Promise<number> {
    const params: unknown[] = [];
    let where = '';
    if (this.databaseCursor) {
      params.push(this.databaseCursor);
      where = 'where id > $1';
    }
    params.push(this.options.missingBatchSize);
    const result = await this.options.database.pool.query<{
      id: string;
      storage_key: string;
    }>(
      `select id, storage_key
         from attachments
         ${where}
        order by id asc
        limit $${params.length}`,
      params
    );

    let missing = 0;
    for (const row of result.rows) {
      this.databaseCursor = row.id;
      try {
        const inspection = await this.options.attachmentStore.inspect(row.storage_key);
        if (!inspection.exists) {
          missing += 1;
          this.options.logger.warn(
            { attachmentId: row.id, errorCode: 'ENOENT' },
            'Attachment metadata references missing storage bytes; metadata was preserved'
          );
        } else if (!inspection.regular) {
          this.options.logger.warn(
            { attachmentId: row.id, errorCode: 'CUBIC_ATTACHMENT_UNSAFE_ENTRY' },
            'Attachment metadata references an unsafe storage entry; metadata was preserved'
          );
        }
      } catch (error) {
        this.options.logger.warn(
          {
            attachmentId: row.id,
            errorCode: sanitizeDeletionErrorCode(error)
          },
          'Could not inspect attachment storage bytes; metadata was preserved'
        );
      }
    }

    if (result.rows.length < this.options.missingBatchSize) {
      this.databaseCursor = null;
    }
    return missing;
  }
}

async function openManagedDirectory(path: string): Promise<Dir> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    const error = new Error('Unsafe attachment directory.') as NodeJS.ErrnoException;
    error.code = 'CUBIC_ATTACHMENT_UNSAFE_ENTRY';
    throw error;
  }
  return opendir(path);
}

export class AttachmentReconciliationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private currentRun: Promise<void> | null = null;

  constructor(
    private readonly options: {
      intervalMs: number;
      reconciler: AttachmentReconciler;
      logger: Pick<ReconciliationLogger, 'error'>;
    }
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runNow(), this.options.intervalMs);
    this.timer.unref();
    void this.runNow();
  }

  async runNow(): Promise<boolean> {
    if (this.currentRun) return false;
    const run = this.options.reconciler.runBatch().then(
      () => {},
      (error) => this.options.logger.error(
        { errorCode: sanitizeDeletionErrorCode(error) },
        'Attachment reconciliation failed; it will retry later'
      )
    );
    this.currentRun = run;
    try {
      await run;
      return true;
    } finally {
      if (this.currentRun === run) this.currentRun = null;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.currentRun;
    await this.options.reconciler.stop();
  }
}

export const attachmentReconciliationInternals = {
  lockName: RECONCILIATION_LOCK_NAME
};
