// city-infra/bench-fdm.ts
// Benchmark 2: the Functorial Data Migration layer (Phase A-D) at city
// scale — checkInstanceIsFunctor, deltaF, sigmaF over an Instance built
// from the same topology as bench-agents.ts. Also demonstrates that
// piF's DoS guard (from the security patch) is exactly what's needed
// once you actually try to join road segments × intersections at city
// scale — a join that IS inherently combinatorial by mathematical
// nature, unlike everything else benchmarked here.
//
// Run:  node --expose-gc -r ts-node/register city-infra/bench-fdm.ts

import { checkInstanceIsFunctor } from '../src/schema';
import { deltaF } from '../src/schemaMapping';
import { sigmaF, piF } from '../src/kanExtensions';
import { SchemaMapping } from '../src/schemaMapping';
import { generateCityTopology, buildCityInstance } from './generate';
import { combinedCitySchema, roadSegmentTypedSchema, intersectionTypedSchema, unifiedCitySchema } from './schema';

function trimmedMean(xs: number[], dropFraction = 0.3): number {
  const s = [...xs].sort((a, b) => a - b);
  const keep = Math.max(1, Math.ceil(s.length * (1 - dropFraction)));
  return s.slice(0, keep).reduce((a, b) => a + b, 0) / keep;
}

async function timeAndMem<T>(fn: () => T, repeats = 10, warmup = 3): Promise<{ result: T; timeMs: number; memDeltaMB: number }> {
  for (let i = 0; i < warmup; i++) fn();
  const times: number[] = [];
  let memDeltaMB = 0;
  let result!: T;
  for (let i = 0; i < repeats; i++) {
    if (global.gc) global.gc();
    const memBefore = process.memoryUsage().heapUsed;
    const t0 = process.hrtime.bigint();
    result = fn();
    const t1 = process.hrtime.bigint();
    const memAfter = process.memoryUsage().heapUsed;
    times.push(Number(t1 - t0) / 1e6);
    if (i === repeats - 1) memDeltaMB = (memAfter - memBefore) / (1024 * 1024);
  }
  return { result, timeMs: trimmedMean(times), memDeltaMB };
}

async function main() {
  console.log(`Node ${process.version}, --expose-gc: ${global.gc ? 'enabled' : 'DISABLED'}\n`);

  console.log('=== checkInstanceIsFunctor 규모 확장 (참조무결성 + 방정식 검증) ===');
  console.log('N(segments) | total rows | trimmed time(ms) | isFunctor');
  for (const n of [10, 100, 1000, 5000]) {
    const topo = generateCityTopology(n);
    const instance = buildCityInstance(topo);
    const totalRows = topo.segmentIds.length + topo.intersectionIds.length + topo.airQualityIds.length;
    const { result, timeMs } = await timeAndMem(() => checkInstanceIsFunctor(combinedCitySchema, instance));
    console.log(`${String(n).padStart(11)} | ${String(totalRows).padStart(10)} | ${timeMs.toFixed(3).padStart(16)} | ${result.isFunctor}`);
  }

  console.log('\n=== deltaF 규모 확장 (RoadSegment 서브스키마로 재색인) ===');
  const roadOnlyMapping: SchemaMapping = { onObjects: { RoadSegment: 'RoadSegment' }, onMorphisms: { connectsTo: ['connectsTo'] } };
  console.log('N(segments) | trimmed time(ms)');
  for (const n of [10, 100, 1000, 5000]) {
    const topo = generateCityTopology(n);
    const instance = buildCityInstance(topo);
    const { timeMs } = await timeAndMem(() => deltaF(roadOnlyMapping, instance, roadSegmentTypedSchema));
    console.log(`${String(n).padStart(11)} | ${timeMs.toFixed(3).padStart(16)}`);
  }

  console.log('\n=== sigmaF 규모 확장 (RoadSegment+Intersection+AirQuality → 통합 Asset) ===');
  const toAssetMapping: SchemaMapping = {
    onObjects: { RoadSegment: 'Asset', Intersection: 'Asset', AirQualityStation: 'Asset' },
    onMorphisms: {},
  };
  const assetSchema = { objects: { RoadSegment: combinedCitySchema.objects.RoadSegment, Intersection: combinedCitySchema.objects.Intersection, AirQualityStation: combinedCitySchema.objects.AirQualityStation }, morphisms: [] };
  console.log('N(segments) | total source rows | union rows | trimmed time(ms)');
  for (const n of [10, 100, 1000, 5000]) {
    const topo = generateCityTopology(n);
    const instance = buildCityInstance(topo);
    const totalRows = topo.segmentIds.length + topo.intersectionIds.length + topo.airQualityIds.length;
    const { result, timeMs } = await timeAndMem(() => sigmaF(toAssetMapping, assetSchema, unifiedCitySchema, instance));
    console.log(`${String(n).padStart(11)} | ${String(totalRows).padStart(17)} | ${String(result.rows.Asset.length).padStart(10)} | ${timeMs.toFixed(3).padStart(16)}`);
  }

  console.log('\n=== piF의 DoS 가드가 실제로 필요해지는 지점 (도시 규모 조인) ===');
  console.log('road segment × intersection 을 그대로 조인하면 도시 규모에서 무슨 일이 나는가:');
  const joinSchema = {
    objects: { RoadSegment: combinedCitySchema.objects.RoadSegment, Intersection: combinedCitySchema.objects.Intersection, Pair: { attributes: [] } },
    morphisms: [
      { name: 'pairRoad', from: 'Pair', to: 'RoadSegment' },
      { name: 'pairInt', from: 'Pair', to: 'Intersection' },
    ],
  };
  const joinMapping: SchemaMapping = { onObjects: { RoadSegment: 'RoadSegment', Intersection: 'Intersection' }, onMorphisms: {} };
  for (const n of [10, 100, 1000]) {
    const topo = generateCityTopology(n);
    const instance = buildCityInstance(topo);
    const nSeg = topo.segmentIds.length, nInt = topo.intersectionIds.length;
    const projectedSize = nSeg * nInt;
    try {
      piF(joinMapping, joinSchema as any, joinSchema as any, instance, { name: 'Pair', projections: ['pairRoad', 'pairInt'] });
      console.log(`  N=${n} (${nSeg}×${nInt}=${projectedSize} 예상 행): ✅ 허용됨`);
    } catch (e) {
      console.log(`  N=${n} (${nSeg}×${nInt}=${projectedSize} 예상 행): ⛔ 거부됨 — "${(e as Error).message.slice(0, 70)}..."`);
    }
  }
  console.log('\n이게 지난 세션 보안 패치의 실질적 근거임: 도시 규모(N=1000)에서 도로×교차로를');
  console.log('무심코 조인하면 25만 행이 시도되고, 가드 없이는 이게 그대로 메모리를 잡아먹음.');
}

main();
