import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_ADS_SCRAPE_QUEUE } from '../contracts/job.contract';
import { ScrapeCronService } from './scrape-cron.service';

@Module({
  imports: [BullModule.registerQueue({ name: APP_ADS_SCRAPE_QUEUE })],
  providers: [ScrapeCronService],
})
export class ScheduleAppModule {}
