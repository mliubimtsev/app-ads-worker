import { UnrecoverableError, type Job } from 'bullmq';
import { AppAdsConsumer } from './app-ads.consumer';
import type { DomainPipelineService } from './domain-pipeline.service';
import type { AppAdsScrapeJob } from '../contracts/job.contract';

function validJobData(): AppAdsScrapeJob {
  return {
    batchId: 'batch-1',
    items: [
      {
        domainId: 1,
        url: 'https://example.com/app-ads.txt',
        etag: null,
        lastModified: null,
        contentHash: null,
      },
    ],
  };
}

function makeSut() {
  const pipeline = {
    runBatch: jest.fn().mockResolvedValue({ batchId: 'batch-1', total: 1, byOutcome: {} }),
  };
  const sut = new AppAdsConsumer(pipeline as unknown as DomainPipelineService);
  return { sut, pipeline };
}

describe('AppAdsConsumer.process', () => {
  it('невалидный payload → UnrecoverableError, pipeline не вызывается', async () => {
    const { sut, pipeline } = makeSut();
    const job = { id: 'j1', data: { batchId: 'b1', items: [] } } as unknown as Job;

    await expect(sut.process(job)).rejects.toThrow(UnrecoverableError);
    expect(pipeline.runBatch).not.toHaveBeenCalled();
  });

  it('валидный payload → делегирует в pipeline.runBatch и возвращает его результат', async () => {
    const { sut, pipeline } = makeSut();
    const job = { id: 'j2', data: validJobData(), attemptsMade: 0 } as unknown as Job;

    const result = await sut.process(job);

    expect(pipeline.runBatch).toHaveBeenCalledWith(validJobData(), 1);
    expect(result).toEqual({ batchId: 'batch-1', total: 1, byOutcome: {} });
  });

  it('attemptsMade прокидывается как attempt = attemptsMade + 1', async () => {
    const { sut, pipeline } = makeSut();
    const job = { id: 'j3', data: validJobData(), attemptsMade: 3 } as unknown as Job;

    await sut.process(job);

    expect(pipeline.runBatch).toHaveBeenCalledWith(expect.anything(), 4);
  });
});
