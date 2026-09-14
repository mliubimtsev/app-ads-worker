import { Global, Module } from '@nestjs/common';
import { RawFileStore } from './raw-file.store';

@Global()
@Module({
  providers: [RawFileStore],
  exports: [RawFileStore],
})
export class StorageModule {}
