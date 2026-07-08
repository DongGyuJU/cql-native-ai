// dashboard-server.ts
// 번개마트 실시간 대시보드.
// A tick() runs every 3s and evolves "telemetry" (as if a POS/inventory/
// delivery system were streaming live numbers). GET /insight re-runs the
// Meta AI on whatever the CURRENT telemetry is at request time — this is
// the actual difference between a snapshot and a live system.

import Fastify from 'fastify';
import fs from 'fs';
import path from 'path';
import {
  createAgent,
  DomainRegistry,
  MetaAgent,
  DomainDefinition,
} from 'cql-native-ai';

// ── Domains + Agents (same as bungae-mart.ts) ───────────────────

const demandDomain: DomainDefinition = { id: 'demand', name: '주문/수요', metaSummaryTemplate: 'Order surge' };
const inventoryDomain: DomainDefinition = { id: 'inventory', name: '재고', metaSummaryTemplate: 'Stockout risk' };
const deliveryDomain: DomainDefinition = { id: 'delivery', name: '배달', metaSummaryTemplate: 'SLA compliance' };
const csDomain: DomainDefinition = { id: 'cs', name: '고객센터', metaSummaryTemplate: 'Complaint pressure' };

interface DemandInput { storeId: string; ordersLastHour: number; baseline: number; topSku: string }
const demandAgent = createAgent<DemandInput>(demandDomain, (i) => {
  const surge = i.ordersLastHour / i.baseline;
  return {
    domain: 'demand', status: surge > 1.8 ? 'warning' : surge > 1.3 ? 'info' : 'good',
    headline: `평시 대비 ${surge.toFixed(1)}배 주문`,
    detail: `최근 1시간 주문 ${i.ordersLastHour}건 (평시 ${i.baseline}건).`,
    recommendation: surge > 1.8 ? `${i.topSku} 긴급 발주 검토` : '정상 운영',
    confidence: 0.9, rawData: { surge, ordersLastHour: i.ordersLastHour },
  };
});

interface InventoryInput { storeId: string; lowStockSkus: { name: string; quantity: number; reorderPoint: number }[]; expiringSkus: { name: string; hoursLeft: number }[] }
const inventoryAgent = createAgent<InventoryInput>(inventoryDomain, (i, _h, opts) => {
  const critical = i.lowStockSkus.filter((s) => s.quantity < s.reorderPoint * 0.3);
  const demandCtx = opts.context?.find((c) => c.domain === 'demand');
  const note = demandCtx?.status === 'warning' ? ' (수요 급증 반영됨)' : '';
  return {
    domain: 'inventory', status: critical.length > 0 ? 'warning' : 'good',
    headline: `${i.lowStockSkus[0]?.name ?? 'SKU'} 재고 ${i.lowStockSkus[0]?.quantity ?? 0}개` + note,
    detail: critical.length ? `품절 임박: ${critical.map((s) => s.name).join(', ')}.` : '재고 정상.',
    recommendation: critical.length ? '긴급 재배치 또는 발주' : '모니터링',
    confidence: 0.92, rawData: { quantity: i.lowStockSkus[0]?.quantity },
  };
});

interface DeliveryInput { storeId: string; activeRiders: number; avgEtaMinutes: number; lateDeliveriesLastHour: number }
const deliveryAgent = createAgent<DeliveryInput>(deliveryDomain, (i, _h, opts) => {
  const SLA = 15;
  const invCtx = opts.context?.find((c) => c.domain === 'inventory');
  const note = invCtx?.status === 'warning' ? ' (재고 이슈로 지연 가중)' : '';
  return {
    domain: 'delivery', status: i.avgEtaMinutes > SLA ? 'warning' : 'good',
    headline: `평균 ETA ${i.avgEtaMinutes}분 (SLA ${SLA}분)` + note,
    detail: `활성 라이더 ${i.activeRiders}명, 지연 ${i.lateDeliveriesLastHour}건.`,
    recommendation: i.avgEtaMinutes > SLA ? '라이더 긴급 지원' : '정상',
    confidence: 0.88, rawData: { avgEtaMinutes: i.avgEtaMinutes },
  };
});

interface CsInput { storeId: string; complaintsLastHour: number; refundsLastHour: number }
const csAgent = createAgent<CsInput>(csDomain, (i) => ({
  domain: 'cs', status: i.complaintsLastHour > 8 ? 'warning' : i.complaintsLastHour > 3 ? 'info' : 'good',
  headline: `불만 ${i.complaintsLastHour}건, 환불 ${i.refundsLastHour}건`,
  detail: `최근 1시간 CS 접수 현황.`,
  recommendation: i.complaintsLastHour > 8 ? 'CS 인력 증원' : '평시 대응',
  confidence: 0.85, rawData: i,
}));

const registry = new DomainRegistry()
  .register(demandAgent).register(inventoryAgent).register(deliveryAgent).register(csAgent);
const meta = new MetaAgent(registry);

// ── Live telemetry simulator ─────────────────────────────────────
// This is the part that would be replaced by real POS/inventory/delivery
// API calls in production. Everything below this line is fake data.

const state = {
  tick: 0,
  ordersLastHour: 40,
  baseline: 40,
  topSku: '생수 2L',
  waterQty: 25,
  reorderPoint: 20,
  activeRiders: 12,
  lateDeliveriesLastHour: 0,
  complaintsLastHour: 1,
  refundsLastHour: 0,
};

function tick() {
  state.tick++;
  const surge = Math.random() > 0.85 ? 1.6 : 1;
  const drift = (Math.random() - 0.4) * 8;
  state.ordersLastHour = Math.max(15, Math.min(120, Math.round((state.ordersLastHour + drift) * surge * 0.3 + state.ordersLastHour * 0.7)));

  const depletion = Math.round(state.ordersLastHour / 15);
  state.waterQty = Math.max(0, state.waterQty - depletion);
  if (state.waterQty < 5 && Math.random() > 0.65) state.waterQty += 22; // restock truck arrives

  state.activeRiders = Math.max(6, Math.min(16, state.activeRiders + Math.round((Math.random() - 0.5) * 3)));

  const critical = state.waterQty < state.reorderPoint * 0.3;
  if (critical && Math.random() > 0.5) state.lateDeliveriesLastHour++;
  else if (!critical && state.lateDeliveriesLastHour > 0 && Math.random() > 0.6) state.lateDeliveriesLastHour--;

  if (state.lateDeliveriesLastHour > 4 && Math.random() > 0.4) state.complaintsLastHour++;
  else if (state.complaintsLastHour > 0 && Math.random() > 0.7) state.complaintsLastHour--;
  if (state.complaintsLastHour > 6 && Math.random() > 0.6) state.refundsLastHour++;
}

function buildInputs() {
  const critical = state.waterQty < state.reorderPoint * 0.3;
  return {
    demand: { storeId: '성수점', ordersLastHour: state.ordersLastHour, baseline: state.baseline, topSku: state.topSku } satisfies DemandInput,
    inventory: {
      storeId: '성수점',
      lowStockSkus: [{ name: state.topSku, quantity: state.waterQty, reorderPoint: state.reorderPoint }],
      expiringSkus: [],
    } satisfies InventoryInput,
    delivery: {
      storeId: '성수점',
      activeRiders: state.activeRiders,
      avgEtaMinutes: 13 + (critical ? 4 : 0) + Math.round(Math.random() * 2),
      lateDeliveriesLastHour: state.lateDeliveriesLastHour,
    } satisfies DeliveryInput,
    cs: { storeId: '성수점', complaintsLastHour: state.complaintsLastHour, refundsLastHour: state.refundsLastHour } satisfies CsInput,
  };
}

setInterval(tick, 3000);

// ── HTTP layer ────────────────────────────────────────────────

const app = Fastify({ logger: false });

app.get('/snapshot', async () => ({ ...state }));

app.get('/insight', async () => {
  const inputs = buildInputs();
  const unified = await meta.run({ inputs });
  return { tick: state.tick, generatedAt: new Date().toISOString(), unified, raw: inputs };
});

app.get('/', async (_req, reply) => {
  const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf-8');
  reply.type('text/html').send(html);
});

const PORT = Number(process.env.PORT ?? 3100);
app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  console.log(`번개마트 실시간 대시보드: http://localhost:${PORT}`);
});
