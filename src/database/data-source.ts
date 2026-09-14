import 'dotenv/config';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { loadConfig } from '../config/app-config';
import { ENTITIES } from './entities';
import { InitAppAds1740000000000 } from './migrations/1740000000000-InitAppAds';

export function buildDataSourceOptions(): DataSourceOptions {
  const cfg = loadConfig();
  return {
    type: 'postgres',
    host: cfg.db.host,
    port: cfg.db.port,
    username: cfg.db.user,
    password: cfg.db.password,
    database: cfg.db.name,
    entities: ENTITIES,
    migrations: [InitAppAds1740000000000],
    migrationsRun: false,
    synchronize: false,
    logging: cfg.nodeEnv === 'development' ? ['error', 'warn', 'migration'] : ['error'],
  };
}

/** Экспорт для TypeORM CLI (`-d src/database/data-source.ts`). */
export default new DataSource(buildDataSourceOptions());
