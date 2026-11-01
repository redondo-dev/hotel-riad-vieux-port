import { createMigrator } from '../../db/migrate.ts';
import { createSequelize } from '../../src/shared/infrastructure/database.ts';
import { assertDedicatedTestDatabase, hasTestDatabase, testDatabaseUrl } from './test-database.ts';

/**
 * Runs once before all the tests: rebuilds the schema of the TEST database by reverting every
 * migration then applying them again, so that each run starts from empty tables. Uses the same
 * migrations as production (never `sync()`). Does nothing without TEST_DATABASE_URL.
 */
export default async function setup(): Promise<void> {
  if (!hasTestDatabase) {
    return;
  }
  assertDedicatedTestDatabase();
  const sequelize = createSequelize(testDatabaseUrl);
  try {
    const migrator = createMigrator(sequelize);
    await migrator.down({ to: 0 });
    await migrator.up();
  } finally {
    await sequelize.close();
  }
}
