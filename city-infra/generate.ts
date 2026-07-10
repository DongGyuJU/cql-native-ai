// city-infra/generate.ts
// Generates a synthetic city-scale topology: N road segments laid out
// on a sqrt(N) x sqrt(N) grid (realistic city block structure, not a
// flat list), with intersections at ~1-per-5-segments and air quality
// stations at ~1-per-20-segments — sparser sensor coverage, matching
// how real cities actually instrument roads vs. air quality.

import { createAgent, DomainAgent } from '../src';
import { InstanceBuilder, Instance } from '../src/schema';
import { RoadSegmentInput, IntersectionInput, AirQualityInput } from './schema';

export interface CityTopology {
  segmentIds: string[];
  intersectionIds: string[];
  airQualityIds: string[];
  segmentInputs: Record<string, RoadSegmentInput>;
  intersectionInputs: Record<string, IntersectionInput>;
  airQualityInputs: Record<string, AirQualityInput>;
  /** segmentId -> adjacent segmentId (grid adjacency, for connectsTo) */
  adjacency: Record<string, string>;
  /** intersectionId -> segmentId it controls */
  controls: Record<string, string>;
  /** stationId -> segmentId it monitors */
  monitors: Record<string, string>;
}

// deterministic pseudo-random so benchmark runs are reproducible
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateCityTopology(nSegments: number, seed = 42): CityTopology {
  const rand = mulberry32(seed);
  const side = Math.ceil(Math.sqrt(nSegments));
  const segmentIds: string[] = [];
  const segmentInputs: Record<string, RoadSegmentInput> = {};
  const adjacency: Record<string, string> = {};

  for (let i = 0; i < nSegments; i++) {
    const id = `seg${i}`;
    segmentIds.push(id);
    segmentInputs[id] = {
      segmentId: id,
      vehiclesPerMin: 15 + rand() * 30,
      avgSpeedKmh: 8 + rand() * 30,
      queueMeters: rand() * 400,
    };
    // grid adjacency, wrapped (toroidal): every segment connects to
    // exactly one "next" segment, with no boundary — this keeps
    // connectsTo a genuinely total morphism, matching what Phase A
    // requires. (A first version left the grid's right-edge nodes
    // disconnected to represent city boundaries; checkInstanceIsFunctor
    // correctly caught that as a not-total violation — a real instance
    // of the checker finding a schema-design mistake, not a data bug.
    // Modeling actual dead-ends/boundaries honestly would need
    // connectsTo to be declared as a partial relation, which is a
    // deliberately different, larger modeling decision than this
    // benchmark's scope.)
    const next = (i + 1) % nSegments;
    adjacency[id] = `seg${next}`;
  }

  const nIntersections = Math.max(1, Math.floor(nSegments / 5));
  const intersectionIds: string[] = [];
  const intersectionInputs: Record<string, IntersectionInput> = {};
  const controls: Record<string, string> = {};
  for (let i = 0; i < nIntersections; i++) {
    const id = `int${i}`;
    intersectionIds.push(id);
    const phases: IntersectionInput['signalPhase'][] = ['red', 'yellow', 'green'];
    intersectionInputs[id] = {
      intersectionId: id,
      signalPhase: phases[Math.floor(rand() * 3)],
      queuedVehicles: Math.floor(rand() * 40),
    };
    controls[id] = segmentIds[Math.floor(rand() * segmentIds.length)];
  }

  const nAirQuality = Math.max(1, Math.floor(nSegments / 20));
  const airQualityIds: string[] = [];
  const airQualityInputs: Record<string, AirQualityInput> = {};
  const monitors: Record<string, string> = {};
  for (let i = 0; i < nAirQuality; i++) {
    const id = `aq${i}`;
    airQualityIds.push(id);
    airQualityInputs[id] = { stationId: id, pm25: rand() * 80, no2: rand() * 60 };
    monitors[id] = segmentIds[Math.floor(rand() * segmentIds.length)];
  }

  return { segmentIds, intersectionIds, airQualityIds, segmentInputs, intersectionInputs, airQualityInputs, adjacency, controls, monitors };
}

// ── Agent factories (Phase 1 layer: registry + MetaAgent runtime) ──

export function makeRoadSegmentAgent(id: string): DomainAgent<RoadSegmentInput> {
  return createAgent<RoadSegmentInput>(
    { id: `road-${id}`, name: `Road ${id}`, metaSummaryTemplate: 'traffic flow and congestion' },
    (input) => {
      const congested = input.avgSpeedKmh < 15 || input.queueMeters > 300;
      return {
        domain: `road-${id}`,
        status: congested ? 'warning' : 'good',
        headline: `${input.avgSpeedKmh.toFixed(1)}km/h, queue ${input.queueMeters.toFixed(0)}m`,
        detail: congested ? '구간 정체' : '정상 흐름',
        recommendation: congested ? '신호 주기 조정 검토' : '조치 불필요',
        confidence: 0.9,
        rawData: input,
      };
    },
  );
}

export function makeIntersectionAgent(id: string): DomainAgent<IntersectionInput> {
  return createAgent<IntersectionInput>(
    { id: `int-${id}`, name: `Intersection ${id}`, metaSummaryTemplate: 'signal backup' },
    (input) => {
      const backup = input.queuedVehicles > 25;
      return {
        domain: `int-${id}`,
        status: backup ? 'warning' : 'good',
        headline: `${input.signalPhase}, ${input.queuedVehicles}대 대기`,
        detail: backup ? '교차로 정체' : '정상',
        recommendation: backup ? '신호 시간 재배분' : '조치 불필요',
        confidence: 0.9,
        rawData: input,
      };
    },
  );
}

export function makeAirQualityAgent(id: string): DomainAgent<AirQualityInput> {
  return createAgent<AirQualityInput>(
    { id: `aq-${id}`, name: `Air Quality ${id}`, metaSummaryTemplate: 'air pollution level' },
    (input) => {
      const unhealthy = input.pm25 > 35;
      return {
        domain: `aq-${id}`,
        status: unhealthy ? 'warning' : 'good',
        headline: `PM2.5 ${input.pm25.toFixed(1)}, NO2 ${input.no2.toFixed(1)}`,
        detail: unhealthy ? '대기질 나쁨' : '정상',
        recommendation: unhealthy ? '교통 유입 제한 검토' : '조치 불필요',
        confidence: 0.85,
        rawData: input,
      };
    },
  );
}

// ── Instance builder (Phase A-D layer) ──────────────────────────

export function buildCityInstance(topo: CityTopology): Instance {
  const b = new InstanceBuilder();
  for (const id of topo.segmentIds) {
    const s = topo.segmentInputs[id];
    b.addRow('RoadSegment', { id, name: id, avgSpeedKmh: s.avgSpeedKmh, vehiclesPerMin: s.vehiclesPerMin, queueMeters: s.queueMeters });
  }
  for (const [from, to] of Object.entries(topo.adjacency)) b.setFk('connectsTo', from, to);

  for (const id of topo.intersectionIds) {
    const x = topo.intersectionInputs[id];
    b.addRow('Intersection', { id, signalPhase: x.signalPhase, queuedVehicles: x.queuedVehicles });
  }
  for (const [from, to] of Object.entries(topo.controls)) b.setFk('controls', from, to);

  for (const id of topo.airQualityIds) {
    const a = topo.airQualityInputs[id];
    b.addRow('AirQualityStation', { id, pm25: a.pm25, no2: a.no2 });
  }
  for (const [from, to] of Object.entries(topo.monitors)) b.setFk('monitors', from, to);

  return b.build();
}
