/**
 * GET /api/optimization/research
 *
 * Returns all optimization strategies with their research basis,
 * distinguishing between PROVEN (implemented) and HYPOTHESIS (needs A/B testing).
 */

import {
  getAllOptimizations,
  getProvenOptimizations,
  getHypotheses,
  getOptimizationsByCategory,
  type OptimizationResearch,
} from '@/app/api/utils/optimization-research';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  const status = url.searchParams.get('status');

  let optimizations: OptimizationResearch[];

  if (status === 'proven') {
    optimizations = getProvenOptimizations();
  } else if (status === 'hypothesis') {
    optimizations = getHypotheses();
  } else if (category) {
    optimizations = getOptimizationsByCategory(category as OptimizationResearch['category']);
  } else {
    optimizations = getAllOptimizations();
  }

  const proven = optimizations.filter(o => o.status === 'PROVEN');
  const hypotheses = optimizations.filter(o => o.status === 'HYPOTHESIS');

  return Response.json({
    summary: {
      total: optimizations.length,
      proven: proven.length,
      hypotheses: hypotheses.length,
      categories: [...new Set(optimizations.map(o => o.category))],
    },
    proven,
    hypotheses,
    recommendations: {
      immediate: proven.slice(0, 3).map(o => ({
        id: o.id,
        title: o.title,
        impact: o.expectedImpact,
        topCitation: o.citations[0]?.source,
      })),
      toTest: hypotheses.slice(0, 3).map(o => ({
        id: o.id,
        title: o.title,
        betaFlag: o.betaFlag,
        risk: o.caveats?.[0],
      })),
    },
    generatedAt: new Date().toISOString(),
  });
}
