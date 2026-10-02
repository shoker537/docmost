import { type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // A subject must never resolve to two users within the same provider.
  await db.schema
    .createIndex('auth_accounts_provider_subject_unique')
    .unique()
    .on('auth_accounts')
    .columns(['auth_provider_id', 'provider_user_id'])
    .where('auth_provider_id', 'is not', null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('auth_accounts_provider_subject_unique').execute();
}
