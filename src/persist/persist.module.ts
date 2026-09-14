import { Module } from '@nestjs/common';
import { PersistService } from './persist.service';

@Module({
  providers: [PersistService],
  exports: [PersistService],
})
export class PersistModule {}
