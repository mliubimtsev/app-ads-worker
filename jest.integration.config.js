/**
 * Отдельный прогон для тестов, которым нужен настоящий Postgres (testcontainers + Docker).
 * Живёт отдельно от основного jest-конфига в package.json, чтобы `npm test`
 * оставался быстрым и не требовал Docker. Запуск: `npm run test:integration`.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.integration\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testTimeout: 60_000,
};
