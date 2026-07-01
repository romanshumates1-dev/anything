export type MetricPoint = {
  name: string;
  value: number;
  ts: number;
  tags?: Record<string, string>;
};

const metrics: MetricPoint[] = [];

export function recordMetric(p: MetricPoint) {
  metrics.push(p);
}

export function getMetrics() {
  return metrics;
}

export function clearMetrics() {
  metrics.length = 0;
}