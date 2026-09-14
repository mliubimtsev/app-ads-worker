import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import pino from 'pino';
import { AppModule } from './app.module';
import { loadConfig } from './config/app-config';
import { checkReadiness } from './bootstrap/check-readiness';

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();

  try {
    await checkReadiness(cfg);
  } catch (err) {
    pino().fatal({ err }, 'ошибка при запуске инфраструктуры');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  app.get(Logger).log('app-ads-worker запущен');
}

void bootstrap();
