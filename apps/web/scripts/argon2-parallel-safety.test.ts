import { describe, expect, it } from 'vitest';
import {
  assertLoadtestOrigin,
  readExperimentConfig,
} from './_argon2-parallel.mjs';

describe('argon2 parallel probe safety contract', () => {
  it('uses the documented bounded defaults', () => {
    expect(readExperimentConfig({})).toEqual({ concurrency: 12, rounds: 3 });
  });

  it('permits the next single bounded tier but refuses a larger burst', () => {
    expect(readExperimentConfig({ CONCURRENCY: '16', ROUNDS: '1' })).toEqual({
      concurrency: 16,
      rounds: 1,
    });
    expect(() => readExperimentConfig({ CONCURRENCY: '17' })).toThrow(/1 and 16/);
  });

  it('refuses invalid experiment sizes rather than silently coercing them', () => {
    expect(() => readExperimentConfig({ CONCURRENCY: '0' })).toThrow(/integer/);
    expect(() => readExperimentConfig({ CONCURRENCY: '1.5' })).toThrow(/integer/);
    expect(() => readExperimentConfig({ ROUNDS: '4' })).toThrow(/1 and 3/);
  });

  it('accepts only the disposable Worker origin', () => {
    expect(assertLoadtestOrigin('https://dealswift-loadtest.romanshumates1.workers.dev')).toBe(
      'https://dealswift-loadtest.romanshumates1.workers.dev'
    );
    expect(() => assertLoadtestOrigin('https://dealswiftautomation.com')).toThrow(/REFUSING/);
    expect(() => assertLoadtestOrigin('https://dealswiftautomation.com/?loadtest=1')).toThrow(
      /REFUSING/
    );
  });
});