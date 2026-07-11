// verify-ecosystem.ts — 실제 라이브러리(TemporalRunner)로 생태계 메커니즘 검증
import { createAgent, DomainRegistry, MetaAgent, TemporalRunner, AnalyzeOptions, DomainInsight } from './src';

const UPSTREAMS: Record<string, string[]> = {
  employment: ['smallbiz', 'publichealth', 'education'],
  income: ['employment', 'energy'],
  consumption: ['income'],
  smallbiz: ['consumption', 'energy', 'trust', 'transport'],
  publichealth: ['air'],
  hospital: ['publichealth'],
  mental: ['housing', 'employment'],
  air: ['climate'],
  energy: ['climate'],
  climate: [],
  housing: [],
  transport: [],
  education: [],
  safety: ['employment'],
  trust: ['safety'],
};
const IDS = Object.keys(UPSTREAMS);
const TH = 85, PROP = 1.0;

function classify(v: number) { return v < 45 ? 'crit' : v < TH ? 'warn' : 'good'; }

const registry = new DomainRegistry();
for (const id of IDS) {
  registry.register(createAgent<{ level: number }>(
    { id, name: id },
    (input, _h, options?: AnalyzeOptions) => {
      let eff = input.level;
      const ups = UPSTREAMS[id];
      if (ups.length && options?.temporal) {
        const prevEffs = ups
          .map(u => (options.temporal!.previousInsight(u)?.rawData as { effLevel?: number } | undefined)?.effLevel)
          .filter((x): x is number => typeof x === 'number');
        if (prevEffs.length) {
          const worst = Math.min(...prevEffs);
          if (worst < TH) eff = Math.min(eff, 100 - (TH - worst) * PROP);
        }
      }
      const cls = classify(eff);
      return {
        domain: id,
        status: cls === 'good' ? 'good' : 'warning',
        headline: `${Math.round(eff)}`,
        detail: cls, recommendation: 'n/a', confidence: 1,
        rawData: { effLevel: eff, severity: cls },
      } as DomainInsight;
    },
  ));
}

async function main() {
  const runner = new TemporalRunner(new MetaAgent(registry));
  const level: Record<string, number> = {};
  for (const id of IDS) level[id] = 100;

  const RECOVER = 0.04;
  const track = ['employment', 'income', 'consumption', 'smallbiz', 'safety', 'trust'];
  const firstWarn: Record<string, number> = {};

  console.log('=== 시나리오: t0에 금융위기(고용 -60), 단발 ===');
  console.log('tick | ' + track.map(t => t.padEnd(11)).join(''));
  for (let t = 0; t <= 20; t++) {
    if (t === 0) level.employment -= 85;                    // 단발 충격
    for (const id of IDS) level[id] += (100 - level[id]) * RECOVER;
    const inputs: Record<string, unknown> = {};
    for (const id of IDS) inputs[id] = { level: level[id] };
    const r = await runner.step(inputs);
    const effs: Record<string, number> = {};
    for (const c of r.contributing) effs[c.domain] = (c.rawData as { effLevel: number }).effLevel;
    for (const d of r.warningDomains) if (firstWarn[d] === undefined) firstWarn[d] = t;
    if (t <= 8 || t === 12 || t === 20) {
      console.log(`  t${String(t).padEnd(2)} | ` + track.map(id => String(Math.round(effs[id])).padEnd(11)).join(''));
    }
  }
  console.log('\n첫 경보 도달 틱 (전파 경로 추적):');
  console.log(Object.entries(firstWarn).map(([k, v]) => `${k}:t${v}`).join('  '));

  // 루프 감쇠 확인: t20에 전부 회복됐는가
  console.log('\n루프 감쇠 검증: 경제 순환(고용→소득→소비→소상공인→고용)이 영구 붕괴하지 않고 회복하는가?');
}
main();
