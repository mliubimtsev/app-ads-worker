import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loadConfig } from '../config/app-config';

const cfg = loadConfig();
const isDev = cfg.nodeEnv !== 'production';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: isDev ? 'debug' : 'info',
        transport: isDev
          ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:standard' } }
          : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        autoLogging: false,
      },
    }),
  ],
})
export class ObservabilityModule {}
