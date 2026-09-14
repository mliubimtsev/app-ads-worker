import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_ADS_SCRAPE_QUEUE } from '../contracts/job.contract';
import { PersistModule } from '../persist/persist.module';
import { AppAdsConsumer } from './app-ads.consumer';
import { DomainPipelineService } from './domain-pipeline.service';

@Module({
  imports: [BullModule.registerQueue({ name: APP_ADS_SCRAPE_QUEUE }), PersistModule],
  providers: [AppAdsConsumer, DomainPipelineService],
  exports: [DomainPipelineService],
})
export class ScrapeModule {}
