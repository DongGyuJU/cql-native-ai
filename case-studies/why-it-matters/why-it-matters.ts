// why-it-matters.ts
// Two production-shaped bugs, each built twice: the way ad-hoc
// multi-agent aggregation code is commonly written, and with
// cql-native-ai. The ad-hoc versions are deliberately realistic
// (last-write-wins context, hardcoded summarizer) — not strawmen.
//
// Run: npx ts-node --compiler-options '{"esModuleInterop":true,"module":"commonjs","skipLibCheck":true}' why-it-matters.ts

import { createAgent, DomainRegistry, MetaAgent, DomainInsight } from 'cql-native-ai';

// ════════════════════════════════════════════════════════════════
// BUG #1 — Order-dependence (naturality violation)
// Two store branches report order surges to a shared warehouse
// planning service. Which store's report arrives first is a network
// accident — the reorder decision should not depend on it.
// ════════════════════════════════════════════════════════════════

interface StoreEvent { store: string; sku: string; surgeRatio: number; stockLeft: number }

// 성수점: 생수 급증(2.4배), 재고 6개 남음
const seongsuEvent: StoreEvent = { store: '성수점', sku: '생수 2L', surgeRatio: 2.4, stockLeft: 6 };
// 강남점: 라면 급증(1.9배), 재고 4개 남음
const gangnamEvent: StoreEvent = { store: '강남점', sku: '컵라면', surgeRatio: 1.9, stockLeft: 4 };

// ── Version A: ad-hoc shared mutable context ────────────────────
// The very common "keep a rolling context, trust the freshest signal"
// pattern (equivalently: a shared-state graph where the last writer
// sets the headline fields).

function runAdHocVersion(events: StoreEvent[]): string {
  const sharedContext = { recentEvents: [] as StoreEvent[] };

  function processStoreEvent(event: StoreEvent): string {
    sharedContext.recentEvents.push(event);
    // "most recent signal is the most urgent" — last-write-wins
    const latest = sharedContext.recentEvents[sharedContext.recentEvents.length - 1];
    const qty = Math.round(latest.surgeRatio * 30 - latest.stockLeft);
    return `긴급 발주: ${latest.sku} ${qty}개 (신호: ${latest.store})`;
  }

  let recommendation = '';
  for (const e of events) recommendation = processStoreEvent(e);
  return recommendation;
}

// ── Version B: cql-native-ai ────────────────────────────────────
// One parameterized store agent (pure function of its own input),
// Meta Agent combines both symmetrically via the registry.

function makeStoreAgent(storeId: string) {
  return createAgent<StoreEvent>(
    {
      id: `store-${storeId}`,
      name: `매장 수요: ${storeId}`,
      metaSummaryTemplate: `${storeId} order surge and stock pressure`,
    },
    (e) => {
      const urgency = e.surgeRatio * 10 - e.stockLeft; // higher = more urgent
      return {
        domain: `store-${storeId}`,
        status: urgency > 12 ? 'warning' : 'info',
        headline: `${e.sku} 급증 ${e.surgeRatio}배, 재고 ${e.stockLeft}개`,
        detail: `긴급도 점수 ${urgency.toFixed(1)}.`,
        recommendation: `${e.sku} ${Math.round(e.surgeRatio * 30 - e.stockLeft)}개 발주`,
        confidence: 0.9,
        rawData: { urgency, sku: e.sku },
      };
    },
  );
}

const registry1 = new DomainRegistry()
  .register(makeStoreAgent('seongsu'))
  .register(makeStoreAgent('gangnam'));
const meta1 = new MetaAgent(registry1);

// token-level jaccard, same measure the library's checkNaturality uses
function jaccard(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

async function bug1() {
  console.log('════════════════════════════════════════════════════');
  console.log('BUG #1 — 도착 순서 의존성 (naturality violation)');
  console.log('════════════════════════════════════════════════════\n');

  console.log('=== Version A (ad-hoc, shared mutable state) ===');
  const a1 = runAdHocVersion([seongsuEvent, gangnamEvent]);
  const a2 = runAdHocVersion([gangnamEvent, seongsuEvent]);
  console.log(`Order 1 (성수점 → 강남점): ${a1}`);
  console.log(`Order 2 (강남점 → 성수점): ${a2}`);
  console.log(
    a1 === a2
      ? '✅ MATCH (예상 밖 — 보고 필요)'
      : `⚠️  MISMATCH: 어느 매장 신호가 늦게 도착했느냐에 따라 발주 품목 자체가 바뀜 (similarity: ${jaccard(a1, a2).toFixed(2)})`,
  );

  console.log('\n=== Version B (cql-native-ai) ===');
  // "arrival order" = the order keys appear in the inputs object
  const b1 = await meta1.run({
    inputs: {
      'store-seongsu': seongsuEvent,
      'store-gangnam': gangnamEvent,
    },
  });
  const b2 = await meta1.run({
    inputs: {
      'store-gangnam': gangnamEvent,
      'store-seongsu': seongsuEvent,
    },
  });
  console.log(`Order 1: ${b1.insight}`);
  console.log(`Order 2: ${b2.insight}`);
  const sim = jaccard(b1.insight, b2.insight);
  console.log(
    b1.insight === b2.insight
      ? `✅ MATCH: 도착 순서와 무관하게 동일한 결론 (similarity: ${sim.toFixed(2)})`
      : `⚠️  MISMATCH (예상 밖 — 보고 필요, similarity: ${sim.toFixed(2)})`,
  );
}

// ════════════════════════════════════════════════════════════════
// BUG #2 — Silent domain drop (colimit completeness)
// A security domain is added later. Its agent works correctly, but
// the hand-written summarizer predates it — so its warning never
// reaches anyone.
// ════════════════════════════════════════════════════════════════

// The three agents themselves are IDENTICAL in both versions —
// the bug is purely in how their outputs are aggregated.

const demandInsight: DomainInsight = {
  domain: 'demand', status: 'good',
  headline: '평시 수준 주문', detail: '', recommendation: '유지', confidence: 0.9,
};
const inventoryInsight: DomainInsight = {
  domain: 'inventory', status: 'good',
  headline: '재고 정상', detail: '', recommendation: '유지', confidence: 0.9,
};
const securityInsight: DomainInsight = {
  domain: 'security', status: 'warning',
  headline: 'POS 단말 3대에서 비정상 로그인 시도 감지',
  detail: '지난 1시간 내 실패한 관리자 로그인 47회.',
  recommendation: '해당 단말 즉시 격리 및 비밀번호 재설정',
  confidence: 0.95,
};

// ── Version A: hand-written summarizer, hardcoded field access ──
// Written back when there were only two domains. Nobody updated it.

function summarize(insights: Record<string, DomainInsight>): string {
  const parts: string[] = [];
  if (insights.demand) {
    parts.push(insights.demand.status === 'warning'
      ? `수요 경고: ${insights.demand.headline}` : '수요 정상');
  }
  if (insights.inventory) {
    parts.push(insights.inventory.status === 'warning'
      ? `재고 경고: ${insights.inventory.headline}` : '재고 정상');
  }
  return parts.join(' / ');
}

// ── Version B: same three insights via Registry + MetaAgent ─────

async function bug2() {
  console.log('\n════════════════════════════════════════════════════');
  console.log('BUG #2 — 조용한 도메인 누락 (colimit completeness)');
  console.log('════════════════════════════════════════════════════\n');

  console.log('security 에이전트가 계산한 것:');
  console.log(`  { status: '${securityInsight.status}', headline: '${securityInsight.headline}' }\n`);

  console.log('=== Version A (ad-hoc summarize()) ===');
  const adhocSummary = summarize({
    demand: demandInsight,
    inventory: inventoryInsight,
    security: securityInsight, // ← passed in, correctly computed...
  });
  console.log(`summarize() 출력: "${adhocSummary}"`);
  console.log(
    adhocSummary.includes('보안') || adhocSummary.toLowerCase().includes('security') || adhocSummary.includes('로그인')
      ? '✅ 보안 경고 포함됨 (예상 밖 — 보고 필요)'
      : '⚠️  보안 경고가 출력 어디에도 없음 — 에이전트는 정확히 감지했지만 아무도 못 봄',
  );

  console.log('\n=== Version B (cql-native-ai) ===');
  const registry2 = new DomainRegistry()
    .register(createAgent<{}>(
      { id: 'demand', name: '수요', metaSummaryTemplate: 'order volume' },
      () => demandInsight,
    ))
    .register(createAgent<{}>(
      { id: 'inventory', name: '재고', metaSummaryTemplate: 'stock levels' },
      () => inventoryInsight,
    ))
    .register(createAgent<{}>(
      { id: 'security', name: '보안', metaSummaryTemplate: 'POS security alerts' },
      () => securityInsight,
    ));
  const meta2 = new MetaAgent(registry2);

  const unified = await meta2.run({ inputs: { demand: {}, inventory: {}, security: {} } });
  console.log(`unified.warningDomains: [ ${unified.warningDomains.join(', ')} ]`);
  console.log(`unified.insight: "${unified.insight}"`);
  console.log(
    unified.warningDomains.includes('security')
      ? '✅ 보안 경고가 구조적으로 포함됨 — 요약 코드는 도메인 추가 시 0줄 수정'
      : '⚠️  보안 경고 누락 (예상 밖 — 보고 필요)',
  );
}

async function main() {
  await bug1();
  await bug2();
}

main().catch(console.error);
