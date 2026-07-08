// gangnam-road.ts
// 강남대로 실시간 교통 상황판 — a SPATIAL domain, not an organizational one.
// Key structural difference from bungae-mart.ts: here a Natural
// Transformation connects two agents of the SAME domain TYPE
// (traffic ⇒ traffic) across physically adjacent road segments —
// congestion literally propagates along the graph edges declared in
// each domain's `relations` field.

import {
  createAgent,
  DomainRegistry,
  MetaAgent,
  NaturalTransformation,
  DomainDefinition,
} from 'cql-native-ai';

// ── 1. Domain Categories ─────────────────────────────────────────
// Two segments of 강남대로, southbound: 강남역 → 신논현역.
// The `relations` field IS the road graph's adjacency — a real Morphism,
// not a metaphorical one.

function trafficDomain(segmentId: string, name: string, downstream?: string): DomainDefinition {
  return {
    id: `traffic-${segmentId}`,
    name: `교통흐름: ${name}`,
    description: 'Vehicle flow, speed, queue length on this road segment',
    keywords: ['정체', '교통량', '서행'],
    schema: { Segment: 'vehiclesPerMin, avgSpeedKmh, queueMeters' },
    relations: downstream ? [{ from: segmentId, to: downstream, label: 'flows into' }] : [],
    metaSummaryTemplate: `Traffic health at ${name}`,
  };
}

const incidentDomain: DomainDefinition = {
  id: 'incident',
  name: '사고/공사',
  description: 'Accident or lane-closure reports',
  keywords: ['사고', '공사', '차선통제'],
  schema: { Incident: 'lanesClosed, totalLanes, etaMinutes' },
  metaSummaryTemplate: 'Incident impact on capacity',
};

const signalDomain: DomainDefinition = {
  id: 'signal',
  name: '신호체계: 강남역사거리',
  description: 'Traffic light cycle and queue vs capacity',
  keywords: ['신호', '대기행렬'],
  schema: { Signal: 'cycleSeconds, queuedVehicles, capacity' },
  metaSummaryTemplate: 'Signal timing pressure',
};

const weatherDomain: DomainDefinition = {
  id: 'weather',
  name: '날씨',
  description: 'Weather conditions affecting road capacity broadly',
  keywords: ['비', '시정'],
  schema: { Weather: 'condition, visibilityM' },
  metaSummaryTemplate: 'Weather impact on driving conditions',
};

// ── 2. Domain Agents (Functors) ─────────────────────────────────

interface TrafficInput { vehiclesPerMin: number; avgSpeedKmh: number; queueMeters: number }
function makeTrafficAgent(segmentId: string, name: string, downstream?: string) {
  return createAgent<TrafficInput>(trafficDomain(segmentId, name, downstream), (i, _h, opts) => {
    const incidentCtx = opts.context?.find((c) => c.domain === 'incident');
    const upstreamCtx = opts.context?.find((c) => c.domain.startsWith('traffic-') && c.domain !== `traffic-${segmentId}`);
    let note = '';
    if (incidentCtx?.status === 'warning') note += ' 인근 사고로 용량 감소 반영됨.';
    if (upstreamCtx?.status === 'warning') note += ` 상류(${upstreamCtx.domain.replace('traffic-', '')}) 정체 유입 반영됨.`;
    return {
      domain: `traffic-${segmentId}`,
      status: i.avgSpeedKmh < 15 || i.queueMeters > 300 ? 'warning' : i.avgSpeedKmh < 22 ? 'info' : 'good',
      headline: `${name}: 평균 ${i.avgSpeedKmh}km/h, 대기 ${i.queueMeters}m`,
      detail: `분당 ${i.vehiclesPerMin}대 통과.` + note,
      recommendation: i.avgSpeedKmh < 15 ? '우회 경로 안내 활성화' : '정상 흐름',
      confidence: 0.9,
      rawData: { avgSpeedKmh: i.avgSpeedKmh, queueMeters: i.queueMeters },
    };
  });
}

const trafficGangnam = makeTrafficAgent('gangnam', '강남역사거리', 'sinnonhyeon');
const trafficSinnonhyeon = makeTrafficAgent('sinnonhyeon', '신논현역사거리');

interface IncidentInput { lanesClosed: number; totalLanes: number; etaMinutes: number }
const incidentAgent = createAgent<IncidentInput>(incidentDomain, (i) => ({
  domain: 'incident',
  status: i.lanesClosed > 0 ? 'warning' : 'good',
  headline: i.lanesClosed > 0 ? `차선 ${i.lanesClosed}/${i.totalLanes} 통제중` : '사고 없음',
  detail: i.lanesClosed > 0 ? `처리 예상 ${i.etaMinutes}분 소요.` : '정상.',
  recommendation: i.lanesClosed > 0 ? '해당 구간 서행 안내' : '조치 불필요',
  confidence: 0.95,
  rawData: i,
}));

interface SignalInput { cycleSeconds: number; queuedVehicles: number; capacity: number }
const signalAgent = createAgent<SignalInput>(signalDomain, (i) => {
  const ratio = i.queuedVehicles / i.capacity;
  return {
    domain: 'signal',
    status: ratio > 0.9 ? 'warning' : ratio > 0.6 ? 'info' : 'good',
    headline: `대기 ${i.queuedVehicles}/${i.capacity}대 (${(ratio * 100).toFixed(0)}%)`,
    detail: `신호 주기 ${i.cycleSeconds}초.`,
    recommendation: ratio > 0.9 ? '신호 주기 연장 검토' : '현행 유지',
    confidence: 0.87,
    rawData: { ratio },
  };
});

interface WeatherInput { condition: 'clear' | 'rain' | 'heavy_rain'; visibilityM: number }
const weatherAgent = createAgent<WeatherInput>(weatherDomain, (i) => ({
  domain: 'weather',
  status: i.condition === 'heavy_rain' ? 'warning' : i.condition === 'rain' ? 'info' : 'good',
  headline: i.condition === 'clear' ? '맑음' : i.condition === 'rain' ? '비' : '폭우',
  detail: `가시거리 ${i.visibilityM}m.`,
  recommendation: i.condition !== 'clear' ? '전 구간 감속 운행 권고' : '해당 없음',
  confidence: 0.93,
  rawData: i,
}));

// ── 3. Registry ───────────────────────────────────────────────

const registry = new DomainRegistry()
  .register(trafficGangnam)
  .register(trafficSinnonhyeon)
  .register(incidentAgent)
  .register(signalAgent)
  .register(weatherAgent);

// ── 4. Natural Transformations ──────────────────────────────────

// (a) incident ⇒ traffic-gangnam : cross-domain, same location
const incidentToTraffic = new NaturalTransformation(incidentAgent, trafficGangnam, {
  translateInput: (inc: IncidentInput): TrafficInput => {
    const capacityLoss = inc.lanesClosed / inc.totalLanes;
    return {
      vehiclesPerMin: Math.round(45 * (1 - capacityLoss)),
      avgSpeedKmh: Math.round(28 * (1 - capacityLoss * 0.7)),
      queueMeters: Math.round(150 + capacityLoss * 400),
    };
  },
});

// (b) traffic-gangnam ⇒ traffic-sinnonhyeon : SAME domain type,
// different spatial node — congestion propagates along the graph edge
// declared in trafficDomain('gangnam', ..., 'sinnonhyeon').relations
const gangnamToSinnonhyeon = new NaturalTransformation(trafficGangnam, trafficSinnonhyeon, {
  translateInput: (up: TrafficInput): TrafficInput => {
    const congested = up.avgSpeedKmh < 15;
    return {
      vehiclesPerMin: congested ? 22 : 35, // fewer cars get through when upstream is jammed
      avgSpeedKmh: congested ? 18 : 27,
      queueMeters: congested ? 180 : 60,
    };
  },
});

// ── 5. Run the scenario: 강남대로 아침 출근 정체 + 사고 ─────────

async function main() {
  console.log('=== 오늘 아침 8:20, 강남대로 남행 ===\n');

  console.log('--- η: 사고 ⇒ 강남역 구간 교통 ---');
  const nt1 = await incidentToTraffic.apply({ lanesClosed: 1, totalLanes: 3, etaMinutes: 20 });
  console.log('사고:', nt1.sourceInsight.headline);
  console.log('강남역 구간:', nt1.targetInsight.headline, '/', nt1.targetInsight.detail);

  console.log('\n--- η: 강남역 구간 ⇒ 신논현역 구간 (공간적 인접 전파) ---');
  const nt2 = await gangnamToSinnonhyeon.apply({ vehiclesPerMin: 25, avgSpeedKmh: 12, queueMeters: 380 });
  console.log('강남역 구간:', nt2.sourceInsight.headline);
  console.log('신논현역 구간:', nt2.targetInsight.headline, '/', nt2.targetInsight.detail);

  console.log('\n=== F_meta: 강남대로 실시간 상황판 ===\n');
  const meta = new MetaAgent(registry);
  const unified = await meta.run({
    inputs: {
      'traffic-gangnam': { vehiclesPerMin: 25, avgSpeedKmh: 12, queueMeters: 380 },
      'traffic-sinnonhyeon': { vehiclesPerMin: 22, avgSpeedKmh: 18, queueMeters: 180 },
      incident: { lanesClosed: 1, totalLanes: 3, etaMinutes: 20 },
      signal: { cycleSeconds: 120, queuedVehicles: 52, capacity: 55 },
      weather: { condition: 'rain', visibilityM: 800 },
    },
  });
  console.log(unified.insight);
  console.log('\nwarning domains:', unified.warningDomains);
  console.log('good domains:', unified.goodDomains);

  // ── 6. 확장성 증명: 세 번째 구간(논현역) 추가 — 그래프가 자라남 ──
  console.log('\n=== 확장: "논현역 구간" 추가, 신논현⇒논현 NT 배선 (기존 코드 0줄 수정) ===\n');

  const trafficNonhyeon = makeTrafficAgent('nonhyeon', '논현역사거리');
  registry.register(trafficNonhyeon);

  const sinnonhyeonToNonhyeon = new NaturalTransformation(trafficSinnonhyeon, trafficNonhyeon, {
    translateInput: (up: TrafficInput): TrafficInput => {
      const congested = up.avgSpeedKmh < 20;
      return {
        vehiclesPerMin: congested ? 26 : 33,
        avgSpeedKmh: congested ? 21 : 29,
        queueMeters: congested ? 90 : 40,
      };
    },
  });
  const nt3 = await sinnonhyeonToNonhyeon.apply({ vehiclesPerMin: 22, avgSpeedKmh: 18, queueMeters: 180 });
  console.log('신논현역 구간:', nt3.sourceInsight.headline);
  console.log('논현역 구간:', nt3.targetInsight.headline, '/', nt3.targetInsight.detail);

  const unified2 = await meta.run({
    inputs: {
      'traffic-gangnam': { vehiclesPerMin: 25, avgSpeedKmh: 12, queueMeters: 380 },
      'traffic-sinnonhyeon': { vehiclesPerMin: 22, avgSpeedKmh: 18, queueMeters: 180 },
      'traffic-nonhyeon': { vehiclesPerMin: 26, avgSpeedKmh: 21, queueMeters: 90 },
      incident: { lanesClosed: 1, totalLanes: 3, etaMinutes: 20 },
      signal: { cycleSeconds: 120, queuedVehicles: 52, capacity: 55 },
      weather: { condition: 'rain', visibilityM: 800 },
    },
  });
  console.log('\n' + unified2.insight);
  console.log('analyzed domains (그래프가 3개 구간으로 자람):', unified2.contributing.map((c) => c.domain));
}

main().catch(console.error);
