export type NumberPoolEntry = {
  number: string;
  numberType: '10dlc' | 'toll-free' | 'short-code';
  dailySent: number;
  dailyLimit: number;
};

export function computeThroughputCeiling(numberType: NumberPoolEntry['numberType']): number {
  switch (numberType) {
    case '10dlc':
      return 1; // msg/sec unless carrier-increased
    case 'toll-free':
      return 10; // higher ceiling
    case 'short-code':
      return 100;
    default:
      return 1;
  }
}

export function canFitDailyVolume(
  dailyVolume: number,
  windowHours: number,
  numberType: NumberPoolEntry['numberType']
): boolean {
  const ceiling = computeThroughputCeiling(numberType);
  const windowSec = windowHours * 3600;
  const maxPossible = Math.floor(ceiling * windowSec);
  return dailyVolume <= maxPossible;
}

export function requiredNumbersForVolume(
  dailyVolume: number,
  windowHours: number,
  numberType: NumberPoolEntry['numberType']
): number {
  const ceiling = computeThroughputCeiling(numberType);
  const windowSec = windowHours * 3600;
  const maxPerNumber = Math.floor(ceiling * windowSec);
  return Math.ceil(dailyVolume / maxPerNumber);
}