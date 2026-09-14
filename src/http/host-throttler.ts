import { Inject, Injectable } from '@nestjs/common';
import Bottleneck from 'bottleneck';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

/**
 * Xостовый троттлер. Ограничивает кол-во одновременных запросов на один домен
 * Без ограничения по хосту легко словить бан.
 */
@Injectable()
export class HostThrottler {
  private readonly group: Bottleneck.Group;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    const minTime = Math.ceil(1000 / cfg.http.perHostRps);
    this.group = new Bottleneck.Group({ maxConcurrent: 2, minTime });
  }

  run<T>(host: string, fn: () => Promise<T>): Promise<T> {
    return this.group.key(host).schedule(fn);
  }
}
