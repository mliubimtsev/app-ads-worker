# app-ads-worker

Воркер, для скрапинга файлов `app-ads.txt`. По списку доменов разработчиков приложений он периодически ходит на `https://<domain>/app-ads.txt`, смотрит, изменился ли файл (условный GET + сверка MD5-хэша содержимого), и если да - разбирает его построчно и сливает строки авторизации в PostgreSQL, ведя историю изменений.

## Стек

- **Node.js 20 + TypeScript 5 (strict) + NestJS 10** - каркас приложения и DI.
- **BullMQ поверх Redis** - очередь `app-ads-scrape`, батч доменов на джобу,
  5 попыток с экспоненциальным backoff.
- **PostgreSQL 16 + TypeORM** - но только как `DataSource`/`QueryRunner` и
  сырые SQL-запросы для DML; `synchronize` отключена, только миграции.
- **`pg-copy-streams`** - массовая загрузка распарсенных строк в staging-таблицу
  через `COPY ... FROM STDIN`.
- **`undici`** - HTTP-клиент с общим dispatcher (`Agent`/`EnvHttpProxyAgent`),
  таймаутами на уровне соединения/заголовков/тела и общим дедлайном
  через `AbortSignal.timeout`.
- **`bottleneck`** - троттлинг запросов по хосту, чтобы не забанили за
  параллельные обращения к одному и тому же домену.
- **`@aws-sdk/client-s3`** - выгрузка (только `PUT`) сырых файлов в S3/MinIO,
  gzip, ключ по хэшу содержимого.
- **`nestjs-pino`** - структурные JSON-логи вместо `console.*`.
- **`zod`** - валидация всего окружения при старте (`src/config/env.schema.ts`);
  если конфиг невалиден, приложение падает сразу.

## Как это устроено

Каждый публичный метод сервиса персиста - это одна транзакция, так что упасть
может только целиком и откатиться целиком.

```
scrape-cron (cron, @Interval):
  SELECT domain WHERE next_scrape_at <= now() ... FOR UPDATE SKIP LOCKED
  → нарезает на батчи по APP_ADS_BATCH_SIZE → кладет в очередь app-ads-scrape

AppAdsConsumer (BullMQ, @Processor) → DomainPipelineService.runBatch:
  по каждому домену в батче (с ограничением параллелизма по HTTP):
    GET (If-None-Match / If-Modified-Since, троттлинг по хосту, дедлайн)
     |- 304 .............. пишет domain.next_scrape_at, статус не трогает
     |- 404 .............. domain.status = no_file, строки НЕ удалает
     |- 200, хэш совпал .. domain_content_version.last_seen_at, без мержа
     |- 200, новый хэш:
          парсит содержимое (app-ads-parser.ts)
          gzip → PUT в S3/MinIO (ДО транзакции с БД)
          ОДНА транзакция:
            COPY распарсенных строк в UNLOGGED stage_app_ads
            → merge.sql: FULL OUTER JOIN стейджа с активными app_ads_entries
            → INSERT ... ON CONFLICT (added / reactivated / cert_changed)
            → UPDATE removed_at для пропавших строк
            → запись переходов в app_ads_change
            → обновление domain (hash, etag, last_modified, next_scrape_at)
```

Модель истории строк авторизации - SCD2-lite: строка `app_ads_entries` не
удаляется и не перезаписывается заново, а живёт с `first_seen_at` /
`removed_at`; `is_active` - генерируемая колонка `removed_at IS NULL`. Если
строка пропала, а потом снова появилась в файле - это реактивация того же
ряда, а не новая запись. Полная лента переходов (`removed`/
`reactivated`/`cert_changed`) пишется в отдельный append-only `app_ads_change`.

`app_ads_entries` партиционирована `PARTITION BY HASH (domain_id)` на
8 партиций, `app_ads_change` - `PARTITION BY RANGE (changed_at)` помесячно
(миграция создаёт окно на 5 месяцев вокруг текущего момента плюс `DEFAULT`
партицию-заглушку). Staging-таблица `stage_app_ads` - `UNLOGGED`, под неё занижен `autovacuum_vacuum_scale_factor`, потому что она постоянно
наполняется и чистится.

## Структура

```
src/
├── main.ts                    # bootstrap: грузит конфиг, проверяет инфраструктуру, поднимает Nest
├── app.module.ts               # сборка модулей
├── config/                     # zod-схема окружения + типизированный AppConfig
├── contracts/                  # имена очередей/джоб, enum'ы статусов и исходов
├── database/
│   ├── entities/                # TypeORM-сущности - только отображение для DML
│   ├── migrations/               # единственная миграция: все таблицы и партиции
│   └── data-source.ts / database.module.ts
├── http/                        # HttpTransport поверх undici, троттлер по хосту,
│                                 #   парсинг тела с лимитом байт, классификация ошибок
├── scrape/
│   ├── app-ads.consumer.ts       # BullMQ-процессор очереди app-ads-scrape
│   ├── domain-pipeline.service.ts# обработка одного домена/батча целиком
│   └── app-ads-parser.ts         # чистый парсер строк app-ads.txt
├── persist/                     # PersisterService, SQL для merge/стейджа/домена, COPY
├── storage/                     # выгрузка сырых файлов в S3 (только PUT)
├── schedule/                    # ScrapeCronService - cron-планировщик очереди app-ads-scrape
├── observability/                # логгер (nestjs-pino)
└── common/concurrency.ts        # Semaphore и mapSettled для ограничения параллелизма
```

## Быстрый старт

Самый простой способ всё увидеть в работе:

```bash
docker compose up --build
```

Поднимутся PostgreSQL, Redis, MinIO (плюс pgAdmin и разовая инициализация
бакета) и сам воркер. У воркера в этом compose-файле выставлены
`APP_ADS_AUTO_MIGRATE=true`, `APP_ADS_ENABLE_DEV_SCHEDULER=true`,
`APP_ADS_DEV_SEED=true` - то есть он сам прогонит миграцию, засеет `domain`
небольшим набором доменов из `src/schedule/seed-domains.ts` и раз в 2 минуты
(`APP_ADS_DEV_SCHEDULER_INTERVAL_MS`) будет подбирать «созревшие» домены и
ставить их в очередь на скрапинг.

Логи: `docker compose logs -f worker`. Консоль MinIO: `http://localhost:9001`
(`minioadmin` / `minioadmin`). pgAdmin: `http://localhost:5050`.

## Локальная разработка без контейнера воркера

```bash
npm install
npm run infra:up
cp .env.example .env
npm run migration:run
npm run start:dev
```

## Команды

```bash
npm run build
npm run start
npm run start:dev
npm run start:debug
npm run start:prod
npm run lint
npm run format

npm run migration:run
npm run migration:revert
npm run migration:create -- <путь>
npm run migration:generate -- <путь>

npm run infra:up | infra:down | infra:reset
```

Тесты - Jest, лежат рядом с кодом (`*.spec.ts`). Юнит-тесты гоняются
`npm run test`, для интеграционных (`persist.service.integration.spec.ts`,
поднимает реальный Postgres через testcontainers) отдельная команда
`npm run test:integration`, чтобы не требовать Docker при обычном запуске тестов.
Покрыто в первую очередь то, где легко словить баг молча: парсер app-ads.txt,
классификация ошибок, конфиг-валидация, сам merge SCD2-lite.

## Конфигурация

Всё окружение описано и провалидировано схемой `zod` в
[`src/config/env.schema.ts`](src/config/env.schema.ts), дефолты для локального
запуска лежат в [`.env.example`](.env.example). Если что-то не проходит
валидацию - приложение просто не стартует. Основные группы переменных:

- `DB_*`, `APP_ADS_AUTO_MIGRATE` - PostgreSQL и прогон миграций при старте.
- `REDIS_*` - подключение BullMQ.
- `S3_*` - endpoint/креды/бакет MinIO для выгрузки сырых файлов.
- `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` - если заданы, `undici`
  автоматически переключается на `EnvHttpProxyAgent`; если нет - обычный
  прямой `Agent`. Отдельного SOCKS5-клиента пока нет.
- `APP_ADS_HTTP_*`, `APP_ADS_MAX_BYTES`, `APP_ADS_MAX_REDIRECTS`,
  `APP_ADS_HTTP_CONNECTIONS`, `APP_ADS_PER_HOST_RPS` - таймауты, лимит размера
  тела и троттлинг HTTP-слоя.
- `APP_ADS_QUEUE_CONCURRENCY`, `APP_ADS_HTTP_CONCURRENCY`,
  `APP_ADS_DB_WRITE_CONCURRENCY` - три независимых лимита параллелизма:
  сколько батчей забирает воркер BullMQ, сколько доменов внутри батча качаются
  одновременно, сколько транзакций одновременно пишут в БД.
- `APP_ADS_ENABLE_DEV_SCHEDULER`, `APP_ADS_DEV_SEED`,
  `APP_ADS_DEV_SCHEDULER_*`, `APP_ADS_BATCH_SIZE` - настройки `ScrapeCronService`:
  сидирует домены и сам ставит батчи в очередь по таймеру. Однопроцессный,
  без advisory lock - см. раздел "Чего пока нет".
- `APP_ADS_REFRESH_INTERVAL_HOURS`, `APP_ADS_STRETCH_AFTER`,
  `APP_ADS_MAX_INTERVAL_HOURS`, `APP_ADS_NO_FILE_DAYS`, `APP_ADS_FAIL_THRESHOLD`,
  `APP_ADS_PARTITION_MAINTENANCE`, `APP_ADS_PARTITION_RETENTION_MONTHS` -
  зарезервированы под адаптивную политику перескрапа и автоматическое
  обслуживание партиций. Сейчас в коде фактически работает только простое
  правило `computeNextScrape` - фиксированные 24 часа плюс случайный джиттер
  (`src/persist/next-scrape.ts`).

## Обработка ошибок

Каждый исход попытки скрапинга - это явный `ScrapeOutcome` (`created`,
`updated`, `unchanged_304`, `unchanged_hash`, `no_file`, `http_error`,
`network_error`, `timeout`, `empty_body`, `parse_error`, `too_large`), и все
они, кроме системных, не роняют джобу целиком. Ошибка одного домена не
ломает весь батч: `DomainPipelineService` перехватывает её, классифицирует
(`src/http/errors.ts`) и просто пишет статус/`next_scrape_at` у этого домена
в БД. Batch считается упавшим и уходит в retry BullMQ только если исключение
не распознано как доменная/сетевая ошибка - то есть при по-настоящему
неожиданном сбое.

Невалидный payload задачи (`AppAdsConsumer`) - это `UnrecoverableError`.

## Чего пока нет

- **Полноценного продюсера.** Батчи в очередь `app-ads-scrape` сейчас ставит
  `ScrapeCronService` - рабочий, но однопроцессный: если поднять несколько
  реплик воркера, один и тот же тик может сработать дважды. Для продакшена
  нужен advisory lock (`pg_try_advisory_lock`) или отдельный сервис-планировщик.
- **`sellers.json`.** В контрактах (`FileType`) место под него заложено, но
  парсер и мердж не написаны - там другой масштаб (файл на 100+ МБ целиком,
  а не построчный diff).
- **Метрик.** Structured-логов через `nestjs-pino` хватает, чтобы разбираться
  руками, но `/metrics` для Prometheus нет - для прод-мониторинга понадобится.
