// bungae-mart.ts
// 번개마트 (Bungae Mart) — 15-minute instant grocery delivery, Seoul.
// A realistic "customer" test of the published cql-native-ai package:
// installed fresh via `npm install cql-native-ai`, not the local source.
//
// Domains: demand (주문), inventory (재고), delivery (배달), cs (고객센터)
// Natural Transformations: demand ⇒ inventory ⇒ delivery
// (an order surge drains stock; stockouts slow riders down)

import {
  createAgent,
  DomainRegistry,
  MetaAgent,
  NaturalTransformation,
  DomainDefinition,
} from 'cql-native-ai';

// ── 1. Domain Categories ─────────────────────────────────────────

const demandDomain: DomainDefinition = {
  id: 'demand',
  name: '주문/수요',
  description: 'Order volume and surge detection per dark store',
  keywords: ['주문', '수요', '급증', 'surge'],
  schema: { OrderRate: 'ordersLastHour, baseline, topSku' },
  metaSummaryTemplate: 'Demand health: order surge vs baseline capacity',
};

const inventoryDomain: DomainDefinition = {
  id: 'inventory',
  name: '다크스토어 재고',
  description: 'Per-store SKU stock levels and spoilage risk',
  keywords: ['재고', '품절', '유통기한'],
  schema: { SKU: 'name, quantity, reorderPoint, expiryHours' },
  metaSummaryTemplate: 'Inventory health: stockout and spoilage risk',
};

const deliveryDomain: DomainDefinition = {
  id: 'delivery',
  name: '배달',
  description: 'Rider fleet status against the 15-minute SLA',
  keywords: ['배달', '라이더', 'SLA', 'ETA'],
  schema: { Rider: 'activeCount, avgEtaMinutes, lateDeliveries' },
  metaSummaryTemplate: 'Delivery health: SLA compliance and fleet load',
};

const csDomain: DomainDefinition = {
  id: 'cs',
  name: '고객센터',
  description: 'Complaint and refund volume',
  keywords: ['불만', '환불', 'CS'],
  schema: { Ticket: 'complaintsLastHour, refundsLastHour' },
  metaSummaryTemplate: 'Customer health: complaint and refund pressure',
};

// ── 2. Domain Agents (Functors) — rule-based, zero API key ──────

interface DemandInput { storeId: string; ordersLastHour: number; baseline: number; topSku: string }
const demandAgent = createAgent<DemandInput>(demandDomain, (i) => {
  const surge = i.ordersLastHour / i.baseline;
  return {
    domain: 'demand',
    status: surge > 1.8 ? 'warning' : surge > 1.3 ? 'info' : 'good',
    headline: `${i.storeId}: 평시 대비 ${surge.toFixed(1)}배 주문`,
    detail: `최근 1시간 주문 ${i.ordersLastHour}건 (평시 ${i.baseline}건). 인기 품목: ${i.topSku}.`,
    recommendation: surge > 1.8 ? `${i.topSku} 긴급 발주 검토` : '정상 운영 유지',
    confidence: 0.9,
    rawData: { surge },
  };
});

interface InventoryInput { storeId: string; lowStockSkus: { name: string; quantity: number; reorderPoint: number }[]; expiringSkus: { name: string; hoursLeft: number }[] }
const inventoryAgent = createAgent<InventoryInput>(inventoryDomain, (i, _h, opts) => {
  const critical = i.lowStockSkus.filter((s) => s.quantity < s.reorderPoint * 0.3);
  const spoiling = i.expiringSkus.filter((s) => s.hoursLeft < 4);
  const demandCtx = opts.context?.find((c) => c.domain === 'demand');
  const surgeNote = demandCtx?.status === 'warning'
    ? ` 수요 도메인이 주문 급증을 보고함 — 재고 소진 속도가 이 예측보다 빠를 수 있음.`
    : '';
  return {
    domain: 'inventory',
    status: critical.length > 0 ? 'warning' : spoiling.length > 0 ? 'info' : 'good',
    headline: `${i.storeId}: 품절위기 ${critical.length}종, 폐기임박 ${spoiling.length}종`,
    detail: (critical.length
      ? `품절 임박: ${critical.map((s) => s.name).join(', ')}.`
      : '재고 정상.') + (spoiling.length ? ` 4시간 내 폐기: ${spoiling.map((s) => s.name).join(', ')}.` : '') + surgeNote,
    recommendation: critical.length ? `${critical[0].name} 긴급 재배치 또는 발주` : '모니터링 유지',
    confidence: 0.92,
    rawData: { criticalCount: critical.length, spoilingCount: spoiling.length },
  };
});

interface DeliveryInput { storeId: string; activeRiders: number; avgEtaMinutes: number; lateDeliveriesLastHour: number }
const deliveryAgent = createAgent<DeliveryInput>(deliveryDomain, (i, _h, opts) => {
  const SLA = 15;
  const invCtx = opts.context?.find((c) => c.domain === 'inventory');
  const stockoutNote = invCtx?.status === 'warning'
    ? ' 재고 품절로 대체상품 안내/재선택이 발생해 라이더 대기시간이 늘고 있음.'
    : '';
  return {
    domain: 'delivery',
    status: i.avgEtaMinutes > SLA || i.lateDeliveriesLastHour > 5 ? 'warning' : 'good',
    headline: `${i.storeId}: 평균 ETA ${i.avgEtaMinutes}분 (SLA ${SLA}분)`,
    detail: `활성 라이더 ${i.activeRiders}명, 최근 1시간 지연 ${i.lateDeliveriesLastHour}건.` + stockoutNote,
    recommendation: i.avgEtaMinutes > SLA ? '인근 매장에서 라이더 긴급 지원' : '정상 운영',
    confidence: 0.88,
    rawData: { activeRiders: i.activeRiders },
  };
});

interface CsInput { storeId: string; complaintsLastHour: number; refundsLastHour: number }
const csAgent = createAgent<CsInput>(csDomain, (i) => ({
  domain: 'cs',
  status: i.complaintsLastHour > 8 ? 'warning' : i.complaintsLastHour > 3 ? 'info' : 'good',
  headline: `${i.storeId}: 불만 ${i.complaintsLastHour}건, 환불 ${i.refundsLastHour}건`,
  detail: `최근 1시간 CS 접수 현황.`,
  recommendation: i.complaintsLastHour > 8 ? 'CS 인력 증원 및 원인(재고/배달) 확인' : '평시 대응',
  confidence: 0.85,
  rawData: i,
}));

// ── 3. Registry ───────────────────────────────────────────────

const registry = new DomainRegistry()
  .register(demandAgent)
  .register(inventoryAgent)
  .register(deliveryAgent)
  .register(csAgent);

// ── 4. Natural Transformations: demand ⇒ inventory ⇒ delivery ──

const demandToInventory = new NaturalTransformation(demandAgent, inventoryAgent, {
  translateInput: (d: DemandInput): InventoryInput => ({
    storeId: d.storeId,
    lowStockSkus: [{ name: d.topSku, quantity: Math.max(0, 40 - d.ordersLastHour), reorderPoint: 20 }],
    expiringSkus: [],
  }),
});

const inventoryToDelivery = new NaturalTransformation(inventoryAgent, deliveryAgent, {
  translateInput: (inv: InventoryInput): DeliveryInput => {
    const criticalCount = inv.lowStockSkus.filter((s) => s.quantity < s.reorderPoint * 0.3).length;
    return {
      storeId: inv.storeId,
      activeRiders: 12,
      avgEtaMinutes: 13 + criticalCount * 4, // stockouts slow riders down
      lateDeliveriesLastHour: criticalCount * 3,
    };
  },
});

// ── 5. Run the scenario: 성수점, 저녁 피크타임 ──────────────────

async function main() {
  console.log('=== 오늘 저녁 피크타임 스냅샷: 성수점 ===\n');

  console.log('--- η: 수요 ⇒ 재고 ---');
  const nt1 = await demandToInventory.apply({
    storeId: '성수점', ordersLastHour: 86, baseline: 38, topSku: '생수 2L',
  });
  console.log('수요:', nt1.sourceInsight.headline);
  console.log('재고:', nt1.targetInsight.headline, '/', nt1.targetInsight.detail);

  console.log('\n--- η: 재고 ⇒ 배달 ---');
  const nt2 = await inventoryToDelivery.apply({
    storeId: '성수점',
    lowStockSkus: [{ name: '생수 2L', quantity: 3, reorderPoint: 20 }, { name: '샐러드팩', quantity: 5, reorderPoint: 15 }],
    expiringSkus: [{ name: '샐러드팩', hoursLeft: 2 }],
  });
  console.log('재고:', nt2.sourceInsight.headline);
  console.log('배달:', nt2.targetInsight.headline, '/', nt2.targetInsight.detail);

  console.log('\n=== F_meta: 성수점 운영 대시보드 ===\n');
  const meta = new MetaAgent(registry);
  const unified = await meta.run({
    inputs: {
      demand: { storeId: '성수점', ordersLastHour: 86, baseline: 38, topSku: '생수 2L' },
      inventory: {
        storeId: '성수점',
        lowStockSkus: [{ name: '생수 2L', quantity: 3, reorderPoint: 20 }, { name: '샐러드팩', quantity: 5, reorderPoint: 15 }],
        expiringSkus: [{ name: '샐러드팩', hoursLeft: 2 }],
      },
      delivery: { storeId: '성수점', activeRiders: 12, avgEtaMinutes: 21, lateDeliveriesLastHour: 6 },
      cs: { storeId: '성수점', complaintsLastHour: 11, refundsLastHour: 4 },
    },
  });
  console.log(unified.insight);
  console.log('\nwarning domains:', unified.warningDomains);
  console.log('good domains:', unified.goodDomains);

  // ── 6. 확장성 증명: 5번째 도메인(프로모션) 추가, 다른 코드 수정 0줄 ──
  console.log('\n=== 확장: "marketing" 도메인 추가 (다른 파일 수정 없음) ===\n');

  const marketingAgent = createAgent<{ activeCampaign: string; discountPercent: number }>(
    { id: 'marketing', name: '프로모션', description: '진행 중인 할인 캠페인', metaSummaryTemplate: '마케팅: 활성 캠페인이 수요에 미치는 영향' },
    (i) => ({
      domain: 'marketing',
      status: i.discountPercent > 20 ? 'warning' : 'info',
      headline: `${i.activeCampaign} 진행중 (${i.discountPercent}% 할인)`,
      detail: `할인율이 높을수록 주문 급증 가능성 상승.`,
      recommendation: i.discountPercent > 20 ? '재고팀에 사전 공유 필요' : '모니터링',
      confidence: 0.8,
      rawData: i,
    }),
  );
  registry.register(marketingAgent);

  const unified2 = await meta.run({
    inputs: {
      demand: { storeId: '성수점', ordersLastHour: 86, baseline: 38, topSku: '생수 2L' },
      inventory: {
        storeId: '성수점',
        lowStockSkus: [{ name: '생수 2L', quantity: 3, reorderPoint: 20 }],
        expiringSkus: [{ name: '샐러드팩', hoursLeft: 2 }],
      },
      delivery: { storeId: '성수점', activeRiders: 12, avgEtaMinutes: 21, lateDeliveriesLastHour: 6 },
      cs: { storeId: '성수점', complaintsLastHour: 11, refundsLastHour: 4 },
      marketing: { activeCampaign: '여름 생수 특가', discountPercent: 25 },
    },
  });
  console.log(unified2.insight);
  console.log('analyzed domains:', unified2.contributing.map((c) => c.domain));
}

main().catch(console.error);
