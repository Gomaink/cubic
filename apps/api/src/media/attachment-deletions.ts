import { randomUUID } from 'node:crypto';
import type { Database } from '@cubic/database';
import type { AttachmentStore } from './attachments.js';

type DeletionLogger = {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
};

export type AttachmentDeletionJob = {
  id: string;
  storageKey: string;
  attemptCount: number;
  leaseToken: string;
};

export type AttachmentDeletionBatchResult = {
  claimed: number;
  deleted: number;
  retried: number;
  stale: number;
};

export function sanitizeDeletionErrorCode(error: unknown): string {
  const raw = String((error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN');
  const sanitized = raw.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64);
  return sanitized || 'UNKNOWN';
}

export function deletionBackoffMs(
  attemptCount: number,
  baseMs: number,
  maximumMs: number
): number {
  const exponent = Math.min(Math.max(attemptCount, 0), 30);
  return Math.min(maximumMs, baseMs * (2 ** exponent));
}

export async function claimAttachmentDeletionJobs(options: {
  database: Database;
  batchSize: number;
  leaseMs: number;
  now?: Date;
  leaseToken?: string;
}): Promise<AttachmentDeletionJob[]> {
  const client = await options.database.pool.connect();
  const now = options.now ?? new Date();
  const leaseToken = options.leaseToken ?? randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + options.leaseMs);

  try {
    await client.query('begin');
    const result = await client.query<{
      id: string;
      storage_key: string;
      attempt_count: number;
      lease_token: string;
    }>(
      `with candidates as (
         select id
           from attachment_file_deletions
          where (
              state = 'pending'
              and next_attempt_at <= $1
            ) or (
              state = 'leased'
              and lease_expires_at <= $1
            )
          order by
            case when state = 'leased' then lease_expires_at else next_attempt_at end asc,
            created_at asc,
            id asc
          limit $2
          for update skip locked
       )
       update attachment_file_deletions deletion
          set state = 'leased',
              lease_token = $3,
              lease_expires_at = $4,
              updated_at = $1
         from candidates
        where deletion.id = candidates.id
      returning deletion.id,
                deletion.storage_key,
                deletion.attempt_count,
                deletion.lease_token`,
      [now, options.batchSize, leaseToken, leaseExpiresAt]
    );
    await client.query('commit');
    return result.rows.map((row) => ({
      id: row.id,
      storageKey: row.storage_key,
      attemptCount: row.attempt_count,
      leaseToken: row.lease_token
    }));
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function acknowledgeAttachmentDeletion(
  database: Database,
  job: Pick<AttachmentDeletionJob, 'id' | 'leaseToken'>
): Promise<boolean> {
  const result = await database.pool.query(
    `delete from attachment_file_deletions
      where id = $1
        and state = 'leased'
        and lease_token = $2`,
    [job.id, job.leaseToken]
  );
  return Boolean(result.rowCount);
}

export async function retryAttachmentDeletion(options: {
  database: Database;
  job: AttachmentDeletionJob;
  error: unknown;
  baseBackoffMs: number;
  maximumBackoffMs: number;
  now?: Date;
}): Promise<boolean> {
  const now = options.now ?? new Date();
  const nextAttemptAt = new Date(
    now.getTime() + deletionBackoffMs(
      options.job.attemptCount,
      options.baseBackoffMs,
      options.maximumBackoffMs
    )
  );
  const result = await options.database.pool.query(
    `update attachment_file_deletions
        set state = 'pending',
            attempt_count = attempt_count + 1,
            next_attempt_at = $3,
            lease_token = null,
            lease_expires_at = null,
            last_error_code = $4,
            updated_at = $5
      where id = $1
        and state = 'leased'
        and lease_token = $2`,
    [
      options.job.id,
      options.job.leaseToken,
      nextAttemptAt,
      sanitizeDeletionErrorCode(options.error),
      now
    ]
  );
  return Boolean(result.rowCount);
}

export async function runAttachmentDeletionBatch(options: {
  database: Database;
  attachmentStore: AttachmentStore;
  batchSize: number;
  leaseMs: number;
  baseBackoffMs: number;
  maximumBackoffMs: number;
  logger: DeletionLogger;
  now?: Date;
}): Promise<AttachmentDeletionBatchResult> {
  const jobs = await claimAttachmentDeletionJobs({
    database: options.database,
    batchSize: options.batchSize,
    leaseMs: options.leaseMs,
    ...(options.now ? { now: options.now } : {})
  });
  const result: AttachmentDeletionBatchResult = {
    claimed: jobs.length,
    deleted: 0,
    retried: 0,
    stale: 0
  };

  for (const job of jobs) {
    try {
      await options.attachmentStore.delete(job.storageKey);
      if (await acknowledgeAttachmentDeletion(options.database, job)) {
        result.deleted += 1;
      } else {
        result.stale += 1;
      }
    } catch (error) {
      const retried = await retryAttachmentDeletion({
        database: options.database,
        job,
        error,
        baseBackoffMs: options.baseBackoffMs,
        maximumBackoffMs: options.maximumBackoffMs,
        ...(options.now ? { now: options.now } : {})
      });
      if (retried) {
        result.retried += 1;
        options.logger.warn(
          {
            deletionId: job.id,
            errorCode: sanitizeDeletionErrorCode(error)
          },
          'Attachment file deletion failed; durable work was rescheduled'
        );
      } else {
        result.stale += 1;
      }
    }
  }

  if (result.claimed > 0) {
    options.logger.info(result, 'Attachment file deletion batch completed');
  }
  return result;
}

export class AttachmentDeletionScheduler {
  private timer: NodeJS.Timeout | null = null;
  private currentRun: Promise<void> | null = null;

  constructor(
    private readonly options: {
      intervalMs: number;
      run: () => Promise<unknown>;
      logger: Pick<DeletionLogger, 'error'>;
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
    const run = this.options.run().then(
      () => {},
      (error) => this.options.logger.error(
        { errorCode: sanitizeDeletionErrorCode(error) },
        'Attachment deletion worker failed; durable work will be retried'
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
  }
}
