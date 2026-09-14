import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { buildDataSourceOptions } from './data-source';
import { ENTITIES } from './entities';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({
        ...buildDataSourceOptions(),
        migrationsRun: cfg.db.autoMigrate,
        extra: { max: Math.max(10, cfg.scrape.dbWriteConcurrency + 4) },
      }),
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  providers: [],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
