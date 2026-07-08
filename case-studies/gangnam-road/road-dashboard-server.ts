// road-dashboard-server.ts
// 강남대로 실시간 상황판. Key difference from bungae-mart's simulator:
// congestion propagates downstream with a VISIBLE LAG — each segment
// reacts to what its upstream neighbor looked like one tick ago. That
// lag is what makes the spatial Natural Transformation pattern visible
// on a live dashboard instead of only in a single static snapshot.

import Fastify from 'fastify';
import fs from 'fs';
import path from 'path';
import {
  createAgent,
  DomainRegistry,
  MetaAgent,
  DomainDefinition,
} from 'cql-native-ai';

// ── Domains + Agents ─────────────────────────────────────────────

interface TrafficInput { vehiclesPerMin: number; avgSpeedKmh: number; queueMeters: number }

function makeTrafficAgent(segmentId: string, name: string) {
  const domain: DomainDefinition = {
    id: `traffic-${segmentId}`, name: `교통흐름: ${name}`,
    metaSummaryTemplate: `Traffic health at ${name}`,
  };
  return createAgent<TrafficInput>(domain, (i, _h, opts) => {
    const upstreamCtx = opts.context?.find((c) => c.domain.startsWith('traffic-') && c.domain !== `traffic-${segmentId}`);
    const note = upstreamCtx?.status === 'warning' ? ` 상류(${upstreamCtx.domain.replace('traffic-', '')}) 정체 유입중.` : '';
    return {
      domain: `traffic-${segmentId}`,
      status: i.avgSpeedKmh < 15 || i.queueMeters > 300 ? 'warning' : i.avgSpeedKmh < 22 ? 'info' : 'good',
      headline: `${name}: ${i.avgSpeedKmh}km/h, 대기 ${i.queueMeters}m`,
      detail: `분당 ${i.vehiclesPerMin}대 통과.` + note,
      recommendation: i.avgSpeedKmh < 15 ? '우회 경로 안내 활성화' : '정상 흐름',
      confidence: 0.9, rawData: i,
    };
  });
}

const trafficGangnam = makeTrafficAgent('gangnam', '강남역사거리');
const trafficSinnonhyeon = makeTrafficAgent('sinnonhyeon', '신논현역사거리');
const trafficNonhyeon = makeTrafficAgent('nonhyeon', '논현역사거리');

interface IncidentInput { lanesClosed: number; totalLanes: number; etaMinutes: number }
const incidentAgent = createAgent<IncidentInput>(
  { id: 'incident', name: '사고/공사', metaSummaryTemplate: 'Incident impact' },
  (i) => ({
    domain: 'incident',
    status: i.lanesClosed > 0 ? 'warning' : 'good',
    headline: i.lanesClosed > 0 ? `차선 ${i.lanesClosed}/${i.totalLanes} 통제중` : '사고 없음',
    detail: i.lanesClosed > 0 ? `처리 예상 ${i.etaMinutes}분.` : '정상.',
    recommendation: i.lanesClosed > 0 ? '서행 안내' : '조치 불필요',
    confidence: 0.95, rawData: i,
  }),
);

interface SignalInput { cycleSeconds: number; queuedVehicles: number; capacity: number }
const signalAgent = createAgent<SignalInput>(
  { id: 'signal', name: '신호체계', metaSummaryTemplate: 'Signal timing pressure' },
  (i) => {
    const ratio = i.queuedVehicles / i.capacity;
    return {
      domain: 'signal', status: ratio > 0.9 ? 'warning' : ratio > 0.6 ? 'info' : 'good',
      headline: `대기 ${i.queuedVehicles}/${i.capacity}대 (${(ratio * 100).toFixed(0)}%)`,
      detail: `신호 주기 ${i.cycleSeconds}초.`,
      recommendation: ratio > 0.9 ? '신호 주기 연장 검토' : '현행 유지',
      confidence: 0.87, rawData: { ratio },
    };
  },
);

interface WeatherInput { condition: 'clear' | 'rain'; visibilityM: number }
const weatherAgent = createAgent<WeatherInput>(
  { id: 'weather', name: '날씨', metaSummaryTemplate: 'Weather impact' },
  (i) => ({
    domain: 'weather', status: i.condition === 'rain' ? 'info' : 'good',
    headline: i.condition === 'clear' ? '맑음' : '비',
    detail: `가시거리 ${i.visibilityM}m.`,
    recommendation: i.condition === 'rain' ? '전 구간 감속 권고' : '해당 없음',
    confidence: 0.93, rawData: i,
  }),
);

const registry = new DomainRegistry()
  .register(trafficGangnam).register(trafficSinnonhyeon).register(trafficNonhyeon)
  .register(incidentAgent).register(signalAgent).register(weatherAgent);
const meta = new MetaAgent(registry);

// ── Live simulator: congestion propagates with a 1-tick lag ─────

// ── Live data: any segment listed in REAL_LINK_IDS uses the REAL Seoul
// TrafficInfo API; segments not listed stay simulated. Adding a new real
// segment later = adding ONE entry here — same "register() and done"
// extensibility story as the library itself, just at the data layer.

const API_KEY = process.env.SEOUL_API_KEY ?? '';

const REAL_LINK_IDS: Record<string, string> = {
  gangnam: '1220003800', // confirmed working
  // sinnonhyeon: 'xxxxxxxxxx',  // ← add here once you find the real link_id
  // nonhyeon: 'xxxxxxxxxx',     // ← same
};

function parseTrafficRows(xml: string) {
  const rows = [...xml.matchAll(/<row>([\s\S]*?)<\/row>/g)];
  return rows.map((r) => {
    const block = r[1];
    const get = (tag: string) => block.match(new RegExp(`<${tag}>(.*?)</${tag}>`))?.[1];
    return { linkId: get('link_id'), speedKmh: Number(get('prcs_spd')), travelTimeSec: Number(get('prcs_trv_time')) };
  });
}

async function fetchRealSpeed(linkId: string): Promise<number | null> {
  if (!API_KEY) return null;
  try {
    const url = `http://openapi.seoul.go.kr:8088/${API_KEY}/xml/TrafficInfo/1/5/${linkId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const text = await res.text();
    const code = text.match(/<CODE>(.*?)<\/CODE>/)?.[1];
    if (code !== 'INFO-000') {
      console.warn(`[Seoul API] ${linkId} -> ${code}: ${text.match(/<MESSAGE>(.*?)<\/MESSAGE>/)?.[1]}`);
      return null;
    }
    return parseTrafficRows(text)[0]?.speedKmh ?? null;
  } catch (err) {
    console.warn(`[Seoul API] ${linkId} fetch failed, falling back to simulation:`, err);
    return null;
  }
}

// segmentId -> last known real speed (undefined = not real / not fetched yet)
const realSpeeds: Record<string, number | null> = {};

async function pollRealData() {
  for (const [segmentId, linkId] of Object.entries(REAL_LINK_IDS)) {
    realSpeeds[segmentId] = await fetchRealSpeed(linkId);
  }
}

const state = {
  tick: 0,
  realSegments: [] as string[],
  incidentActive: false,
  incidentTicksLeft: 0,
  weather: 'clear' as 'clear' | 'rain',
  gangnamSpeed: 28, sinnonhyeonSpeed: 29, nonhyeonSpeed: 29,
  prevGangnamSpeed: 28, prevSinnonhyeonSpeed: 29,
  signalQueued: 15,
};

function smooth(current: number, target: number, rate = 0.45) {
  return current + (target - current) * rate + (Math.random() - 0.5) * 1.5;
}

function tick() {
  state.tick++;

  if (!state.incidentActive && Math.random() < 0.06) {
    state.incidentActive = true;
    state.incidentTicksLeft = 5 + Math.floor(Math.random() * 4);
  } else if (state.incidentActive) {
    state.incidentTicksLeft--;
    if (state.incidentTicksLeft <= 0) state.incidentActive = false;
  }

  if (Math.random() < 0.03) state.weather = state.weather === 'clear' ? 'rain' : 'clear';

  state.prevGangnamSpeed = state.gangnamSpeed;
  state.prevSinnonhyeonSpeed = state.sinnonhyeonSpeed;

  const rainPenalty = state.weather === 'rain' ? 4 : 0;
  const realNow: string[] = [];

  if (realSpeeds.gangnam !== null && realSpeeds.gangnam !== undefined) {
    state.gangnamSpeed = realSpeeds.gangnam;
    realNow.push('gangnam');
  } else {
    const gangnamTarget = (state.incidentActive ? 12 : 28) - rainPenalty;
    state.gangnamSpeed = Math.max(6, Math.min(30, smooth(state.gangnamSpeed, gangnamTarget)));
  }

  if (realSpeeds.sinnonhyeon !== null && realSpeeds.sinnonhyeon !== undefined) {
    state.sinnonhyeonSpeed = realSpeeds.sinnonhyeon;
    realNow.push('sinnonhyeon');
  } else {
    const sinnonhyeonTarget = (state.prevGangnamSpeed < 15 ? 18 : 29) - rainPenalty;
    state.sinnonhyeonSpeed = Math.max(6, Math.min(31, smooth(state.sinnonhyeonSpeed, sinnonhyeonTarget)));
  }

  if (realSpeeds.nonhyeon !== null && realSpeeds.nonhyeon !== undefined) {
    state.nonhyeonSpeed = realSpeeds.nonhyeon;
    realNow.push('nonhyeon');
  } else {
    const nonhyeonTarget = (state.prevSinnonhyeonSpeed < 20 ? 21 : 30) - rainPenalty;
    state.nonhyeonSpeed = Math.max(6, Math.min(32, smooth(state.nonhyeonSpeed, nonhyeonTarget)));
  }

  state.realSegments = realNow;

  const signalTarget = state.gangnamSpeed < 15 ? 52 : 18;
  state.signalQueued = Math.max(0, Math.min(55, Math.round(smooth(state.signalQueued, signalTarget))));
}

// simulation ticks every 3s (visual liveliness); real API polled every 15s
// (unlikely the underlying data changes every 3s anyway, and this stays
// well within any reasonable daily call quota)
setInterval(tick, 3000);
setInterval(() => { pollRealData().catch((e) => console.error('[pollRealData] error:', e)); }, 15000);
pollRealData();

function queueFromSpeed(speed: number) {
  return Math.max(20, Math.round(420 - speed * 13));
}

function buildInputs() {
  return {
    'traffic-gangnam': { vehiclesPerMin: Math.round(45 - state.gangnamSpeed * 0.5), avgSpeedKmh: Math.round(state.gangnamSpeed), queueMeters: queueFromSpeed(state.gangnamSpeed) },
    'traffic-sinnonhyeon': { vehiclesPerMin: Math.round(40 - state.sinnonhyeonSpeed * 0.4), avgSpeedKmh: Math.round(state.sinnonhyeonSpeed), queueMeters: queueFromSpeed(state.sinnonhyeonSpeed) },
    'traffic-nonhyeon': { vehiclesPerMin: Math.round(38 - state.nonhyeonSpeed * 0.4), avgSpeedKmh: Math.round(state.nonhyeonSpeed), queueMeters: queueFromSpeed(state.nonhyeonSpeed) },
    incident: state.incidentActive
      ? { lanesClosed: 1, totalLanes: 3, etaMinutes: state.incidentTicksLeft * 3 }
      : { lanesClosed: 0, totalLanes: 3, etaMinutes: 0 },
    signal: { cycleSeconds: 120, queuedVehicles: state.signalQueued, capacity: 55 },
    weather: { condition: state.weather, visibilityM: state.weather === 'rain' ? 800 : 2000 },
  };
}

// (setInterval calls moved above, right after tick()/pollRealData definitions)

// ── HTTP layer ────────────────────────────────────────────────

const app = Fastify({ logger: false });

app.get('/snapshot', async () => ({ ...state }));

app.get('/insight', async () => {
  const inputs = buildInputs();
  const unified = await meta.run({ inputs });
  return { tick: state.tick, generatedAt: new Date().toISOString(), unified, raw: inputs };
});

app.get('/', async (_req, reply) => {
  const html = fs.readFileSync(path.join(__dirname, 'road-dashboard.html'), 'utf-8');
  reply.type('text/html').send(html);
});

const PORT = Number(process.env.PORT ?? 3200);
app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  console.log(`강남대로 실시간 상황판: http://localhost:${PORT}`);
});
