import { gzipSync } from 'node:zlib';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { rawAppAdsKey } from './s3-key';

export interface RawUploadResult {
  bucket: string;
  key: string;
  gzipSize: number;
}

/**
 * Выгрузка сырых файлов app-ads.txt в S3 (gzip). Только запись -
 * отдача/скачивание вне скоупа. PUT выполняется ДО открытия транзакции БД;
 * ключ по хэшу делает повторную заливку безопасной
 */
@Injectable()
export class RawFileStore implements OnModuleInit {
  private readonly logger = new Logger(RawFileStore.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.bucket = cfg.s3.bucketRaw;
    this.client = new S3Client({
      endpoint: cfg.s3.endpoint,
      region: cfg.s3.region,
      forcePathStyle: cfg.s3.forcePathStyle,
      credentials: {
        accessKeyId: cfg.s3.accessKey,
        secretAccessKey: cfg.s3.secretKey,
      },
    });
  }

  /** Создаёт бакет, если его нет (на случай запуска без docker-compose init) */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Создан бакет ${this.bucket}`);
      } catch (err) {
        this.logger.warn({ err }, `Не удалось создать бакет ${this.bucket} (возможно, уже есть)`);
      }
    }
  }

  async putRawAppAds(
    domainId: number,
    contentHashHex: string,
    raw: Buffer,
  ): Promise<RawUploadResult> {
    const key = rawAppAdsKey(domainId, contentHashHex);
    const gz = gzipSync(raw);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: gz,
        ContentType: 'text/plain',
        ContentEncoding: 'gzip',
        Metadata: { 'content-md5-hex': contentHashHex, 'domain-id': String(domainId) },
      }),
    );
    return { bucket: this.bucket, key, gzipSize: gz.length };
  }
}
