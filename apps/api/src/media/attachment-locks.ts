import type { PoolClient } from 'pg';

const ATTACHMENT_STORAGE_LOCK_NAMESPACE = 'cubic:attachment-storage:';

export async function lockAttachmentStorageKey(
  client: Pick<PoolClient, 'query'>,
  storageKey: string
): Promise<void> {
  await client.query(
    'select pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`${ATTACHMENT_STORAGE_LOCK_NAMESPACE}${storageKey}`]
  );
}

export const attachmentLockInternals = {
  namespace: ATTACHMENT_STORAGE_LOCK_NAMESPACE
};
