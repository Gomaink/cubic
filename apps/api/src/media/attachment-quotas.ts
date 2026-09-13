import type { Database } from '@cubic/database';
import type { StoredAttachment } from './attachments.js';

const QUOTA_LOCK_NAMESPACE = 'cubic:pending-attachment-quota:';

export type PendingAttachmentQuota = {
  maxCount: number;
  maxBytes: number;
};

export type PendingAttachmentInsert = StoredAttachment & {
  conversationId: string;
  uploaderId: string;
};

export type PendingAttachmentQuotaReason = 'count' | 'bytes';

export class PendingAttachmentQuotaError extends Error {
  readonly code = 'CUBIC_PENDING_ATTACHMENT_QUOTA';

  constructor(readonly reason: PendingAttachmentQuotaReason) {
    super(`Pending attachment ${reason} quota exceeded.`);
  }
}

export async function insertPendingAttachmentWithinQuota(
  database: Database,
  attachment: PendingAttachmentInsert,
  quota: PendingAttachmentQuota
): Promise<any> {
  const client = await database.pool.connect();

  try {
    await client.query('begin');
    await client.query(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`${QUOTA_LOCK_NAMESPACE}${attachment.uploaderId}`]
    );

    const usageResult = await client.query<{
      pending_count: number;
      pending_bytes: string;
    }>(
      `select count(*)::integer as pending_count,
              coalesce(sum(size_bytes), 0)::bigint as pending_bytes
         from attachments
        where uploader_id = $1
          and message_id is null`,
      [attachment.uploaderId]
    );

    const usage = usageResult.rows[0] ?? {
      pending_count: 0,
      pending_bytes: '0'
    };

    if (usage.pending_count + 1 > quota.maxCount) {
      throw new PendingAttachmentQuotaError('count');
    }

    if (BigInt(usage.pending_bytes) + BigInt(attachment.sizeBytes) > BigInt(quota.maxBytes)) {
      throw new PendingAttachmentQuotaError('bytes');
    }

    const result = await client.query(
      `insert into attachments (
         conversation_id,
         uploader_id,
         storage_key,
         original_name,
         content_type,
         kind,
         size_bytes,
         width,
         height
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning *`,
      [
        attachment.conversationId,
        attachment.uploaderId,
        attachment.key,
        attachment.originalName,
        attachment.contentType,
        attachment.kind,
        attachment.sizeBytes,
        attachment.width,
        attachment.height
      ]
    );

    await client.query('commit');
    return result.rows[0];
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const attachmentQuotaInternals = {
  lockNamespace: QUOTA_LOCK_NAMESPACE
};
