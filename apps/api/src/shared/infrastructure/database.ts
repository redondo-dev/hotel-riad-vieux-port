import { Sequelize } from 'sequelize';

/**
 * PostgreSQL connection through Sequelize.
 *
 * The schema is owned by the SQL migrations (db/migrations). `sequelize.sync()` must never be
 * called: it would try to create or alter tables from the models and could destroy data.
 */
export function createSequelize(databaseUrl: string): Sequelize {
  return new Sequelize(databaseUrl, {
    dialect: 'postgres',
    logging: false,
    define: {
      underscored: true,
      freezeTableName: true,
      timestamps: false,
    },
    pool: { max: 10, idle: 10_000 },
  });
}
