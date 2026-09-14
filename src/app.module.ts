import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HttpModule } from './http/http.module';
import { ObservabilityModule } from './observability/logger.module';
import { PersistModule } from './persist/persist.module';
import { ScheduleAppModule } from './schedule/schedule.module';
import { ScrapeModule } from './scrape/scrape.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({
        connection: { host: cfg.redis.host, port: cfg.redis.port },
      }),
    }),
    DatabaseModule,
    HttpModule,
    StorageModule,
    PersistModule,
    ScrapeModule,
    ScheduleAppModule,
  ],
})
export class AppModule {}
