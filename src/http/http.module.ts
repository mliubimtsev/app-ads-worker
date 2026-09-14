import { Global, Module } from '@nestjs/common';
import { HostThrottler } from './host-throttler';
import { HTTP_TRANSPORT } from './http-transport';
import { UndiciHttpTransport } from './undici-http-transport';

@Global()
@Module({
  providers: [{ provide: HTTP_TRANSPORT, useClass: UndiciHttpTransport }, HostThrottler],
  exports: [HTTP_TRANSPORT, HostThrottler],
})
export class HttpModule {}
