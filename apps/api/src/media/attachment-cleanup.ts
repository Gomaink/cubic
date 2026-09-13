import type { Database } from '@cubic/database';

const CLEANUP_LOCK_NAME = 'cubic:stale-pending-attachment-cleanup';

type CleanupLogger = {
  error(bindings: Record<string, unknown>, message: string): void;
};

export type AttachmentCleanupResult = {
  lockAcquired: boolean;
  selected: number;
  deleted: number;
  failed: number;
};

export async function cleanupStalePendingBatch(options: {
  database: Database;
  staleAgeMs: number;
  batchSize: number;
  logger: CleanupLogger;
  now?: Date;
}): Promise<AttachmentCleanupResult> {
  const client = await options.database.pool.connect();
  const cutoff = new Date((options.now?.getTime() ?? Date.now()) - options.staleAgeMs);

  try {
    await client.query('begin');
    const lockResult = await client.query<{ acquired: boolean }>(
      'select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired',
      [CLEANUP_LOCK_NAME]
    );

    if (!lockResult.rows[0]?.acquired) {
      await client.query('rollback');
      return { lockAcquired: false, selected: 0, deleted: 0, failed: 0 };
    }

    const staleResult = await client.query<{ id: string }>(
      `select id
         from attachments
        where message_id is null
          and created_at < $1
        order by created_at asc
        limit $2
        for update skip locked`,
      [cutoff, options.batchSize]
    );

    let deleted = 0;
    if (staleResult.rows.length > 0) {
      const deleteResult = await client.query(
        `delete from attachments
          where id = any($1::uuid[])
            and message_id is null`,
        [staleResult.rows.map((row) => row.id)]
      );
      deleted = deleteResult.rowCount ?? 0;
    }

    await client.query('commit');
    return {
      lockAcquired: true,
      selected: staleResult.rowCount ?? staleResult.rows.length,
      deleted,
      failed: 0
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export class AttachmentCleanupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private currentRun: Promise<void> | null = null;

  constructor(
    private readonly options: {
      intervalMs: number;
      cleanup: () => Promise<unknown>;
      logger: Pick<CleanupLogger, 'error'>;
    }
  ) {}

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      void this.runNow();
    }, this.options.intervalMs);
    this.timer.unref();
    void this.runNow();
  }

  async runNow(): Promise<boolean> {
    if (this.currentRun) return false;

    const run = this.options.cleanup().then(
      () => {},
      (error) => {
        this.options.logger.error(
          { errorCode: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' },
          'Stale pending attachment cleanup failed; it will be retried'
        );
      }
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
  }
}

export const attachmentCleanupInternals = {
  lockName: CLEANUP_LOCK_NAME
};
