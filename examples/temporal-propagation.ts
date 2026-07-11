// examples/temporal-propagation.ts
//
// The formal-feature version of the pattern that gangnam-road, both
// control-room demos, and the city propagation benchmark each hand-rolled
// with a manual "previous tick" variable (paper Limitation 4).
//
// A 5-segment road chain. Each segment reacts to its upstream neighbor's
// PREVIOUS-tick insight via options.temporal — the snapshot the
// TemporalRunner freezes for every agent identically. Expected output:
// the incident at seg0 reaches seg_i exactly at tick i (1 tick per hop).
//
// Run:
//   TS_NODE_COMPILER_OPTIONS='{"esModuleInterop":true,"module":"commonjs","skipLibCheck":true}' \
//     npx ts-node examples/temporal-propagation.ts

import {
  createAgent, DomainRegistry, MetaAgent, TemporalRunner, AnalyzeOptions,
} from '../src';

const N = 5;
const registry = new DomainRegistry();

for (let i = 0; i < N; i++) {
  const upstream = i > 0 ? `seg${i - 1}` : undefined;
  registry.register(createAgent<{ speed: number }>(
    { id: `seg${i}`, name: `구간 ${i}` },
    (input, _history, options?: AnalyzeOptions) => {
      let speed = input.speed;
      if (upstream && options?.temporal) {
        const prev = options.temporal.previousInsight(upstream);
        if (prev?.status === 'warning') speed = Math.min(speed, 12); // 상류 정체가 한 틱 늦게 도달
      }
      return {
        domain: `seg${i}`,
        status: speed < 20 ? 'warning' : 'good',
        headline: `${speed}km/h`,
        detail: speed < 20 ? '정체' : '원활',
        recommendation: speed < 20 ? '우회 유도' : '유지',
        confidence: 1,
        rawData: { speed },
      };
    },
  ));
}

async function main() {
  const runner = new TemporalRunner(new MetaAgent(registry));

  const inputs: Record<string, unknown> = {};
  for (let i = 0; i < N; i++) inputs[`seg${i}`] = { speed: 60 };
  (inputs.seg0 as { speed: number }).speed = 8; // 지속 사고 @ seg0

  console.log('tick | 각 구간 상태 (■=정체, ·=원활)');
  const firstWarn: Record<string, number> = {};
  for (let t = 0; t < N + 1; t++) {
    const r = await runner.step(inputs);
    const row = Array.from({ length: N }, (_, i) =>
      r.warningDomains.includes(`seg${i}`) ? '■' : '·').join(' ');
    console.log(`  t${t}  | ${row}`);
    for (const d of r.warningDomains) if (firstWarn[d] === undefined) firstWarn[d] = t;
  }

  console.log('\n첫 정체 도달 틱 == 그래프 거리 검증:');
  for (let i = 0; i < N; i++) {
    const ok = firstWarn[`seg${i}`] === i ? '✅' : '❌';
    console.log(`  seg${i}: 거리 ${i} → 도달 t${firstWarn[`seg${i}`]} ${ok}`);
  }
}

main();
