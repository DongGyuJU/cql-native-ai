// city-infra/propagation.ts
// Semantic correctness at city scale: does the "previous-tick context"
// propagation mechanism proven correct on gangnam-road's 3-segment
// linear chain still produce geometrically correct delay (tick ==
// graph distance from the incident) on a real 2D grid with hundreds or
// thousands of nodes?
//
// SAME MECHANISM, SAME HONEST LIMITATION as gangnam-road's
// dashboard-server.ts: this uses a hand-rolled "previous tick" variable,
// not the library's formal HistoryEntry[] mechanism (still a documented
// open item, not silently upgraded here).
//
// Run:  npx ts-node city-infra/propagation.ts

interface GridNode { id: string; row: number; col: number }

function buildGrid(side: number): { nodes: GridNode[]; neighbors: Map<string, string[]> } {
  const nodes: GridNode[] = [];
  const neighbors = new Map<string, string[]>();
  const idAt = (r: number, c: number) => `n${r}_${c}`;

  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      nodes.push({ id: idAt(r, c), row: r, col: c });
    }
  }
  for (const n of nodes) {
    const nb: string[] = [];
    if (n.row > 0) nb.push(idAt(n.row - 1, n.col));
    if (n.row < side - 1) nb.push(idAt(n.row + 1, n.col));
    if (n.col > 0) nb.push(idAt(n.row, n.col - 1));
    if (n.col < side - 1) nb.push(idAt(n.row, n.col + 1));
    neighbors.set(n.id, nb);
  }
  return { nodes, neighbors };
}

/** BFS graph distance from `source` to every reachable node — the ground truth we check propagation delay against. */
function bfsDistances(neighbors: Map<string, string[]>, source: string): Map<string, number> {
  const dist = new Map<string, number>([[source, 0]]);
  const queue = [source];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of neighbors.get(cur) ?? []) {
      if (!dist.has(nb)) {
        dist.set(nb, dist.get(cur)! + 1);
        queue.push(nb);
      }
    }
  }
  return dist;
}

const FREE_FLOW = 28;
const INCIDENT_SPEED = 5;
const CONGESTION_THRESHOLD = FREE_FLOW * 0.75; // matches gangnam-road's "<15km/h-ish relative" congestion notion, scaled
const DECAY_PER_HOP = 3; // severity attenuates by this many km/h per hop outward, matching real wave physics direction

function simulate(side: number, incidentId: string, ticks: number) {
  const { nodes, neighbors } = buildGrid(side);
  let prevSpeed = new Map<string, number>(nodes.map((n) => [n.id, FREE_FLOW]));
  const firstCongestedTick = new Map<string, number>();

  for (let t = 0; t < ticks; t++) {
    const curSpeed = new Map<string, number>();
    for (const n of nodes) {
      if (n.id === incidentId) {
        curSpeed.set(n.id, INCIDENT_SPEED);
      } else {
        // propagation rule: pulled toward the worst PREVIOUS-tick
        // neighbor state, attenuated by one hop's worth of decay —
        // this is exactly the "reads the upstream agent's prior tick,
        // not its current one" pattern proven on gangnam-road's 3-node
        // chain, generalized to arbitrary-degree grid neighbors.
        const nbSpeeds = (neighbors.get(n.id) ?? []).map((nb) => prevSpeed.get(nb) ?? FREE_FLOW);
        const worstNeighbor = Math.min(...nbSpeeds, FREE_FLOW);
        const influenced = worstNeighbor < CONGESTION_THRESHOLD
          ? Math.min(FREE_FLOW, worstNeighbor + DECAY_PER_HOP)
          : FREE_FLOW;
        curSpeed.set(n.id, influenced);
      }
      if (!firstCongestedTick.has(n.id) && (curSpeed.get(n.id) ?? FREE_FLOW) < CONGESTION_THRESHOLD) {
        firstCongestedTick.set(n.id, t);
      }
    }
    prevSpeed = curSpeed;
  }
  return { nodes, neighbors, firstCongestedTick };
}

function runCheck(side: number, ticks: number) {
  const total = side * side;
  const incidentId = `n${Math.floor(side / 2)}_${Math.floor(side / 2)}`; // center of the grid

  const t0 = Date.now();
  const { neighbors, firstCongestedTick } = simulate(side, incidentId, ticks);
  const distances = bfsDistances(neighbors, incidentId);
  const elapsedMs = Date.now() - t0;

  let matched = 0, everCongested = 0, neverCongestedWithinReach = 0, maxDeviation = 0;
  const deviations: { id: string; expected: number; observed: number }[] = [];
  let maxCongestedDistance = 0;

  for (const [id, expectedDist] of distances) {
    if (expectedDist >= ticks) continue; // never had enough ticks to possibly reach it — exclude, not a failure
    const observed = firstCongestedTick.get(id);
    if (observed === undefined) {
      // decay (DECAY_PER_HOP) means congestion has a finite radius by
      // design — nodes beyond it never cross the threshold at all.
      // That's an expected consequence of the propagation rule, not a
      // timing failure, so we count it separately rather than as a
      // "miss" against graph-distance-== -tick.
      neverCongestedWithinReach++;
      continue;
    }
    everCongested++;
    maxCongestedDistance = Math.max(maxCongestedDistance, expectedDist);
    const dev = Math.abs(observed - expectedDist);
    if (dev === 0) matched++;
    else deviations.push({ id, expected: expectedDist, observed });
    maxDeviation = Math.max(maxDeviation, dev);
  }

  console.log(`\n=== side=${side} (${total}개 도로 구간), incident at center, ${ticks} ticks ===`);
  console.log(`시뮬레이션 시간: ${elapsedMs}ms`);
  console.log(`실제로 congested 상태에 도달한 노드: ${everCongested}개 (감쇠로 인한 영향 반경: 최대 그래프거리 ${maxCongestedDistance}홉)`);
  console.log(`감쇠로 인해 애초에 congested 미도달 노드: ${neverCongestedWithinReach}개 (설계상 정상 — 실패 아님)`);
  console.log(`도달한 노드 중 그래프거리 == 전파도달틱 정확히 일치: ${matched}/${everCongested} (${everCongested ? ((matched / everCongested) * 100).toFixed(1) : 'N/A'}%)`);
  console.log(`최대 편차: ${maxDeviation}틱`);
  if (deviations.length > 0 && deviations.length <= 5) {
    console.log('편차 사례:', deviations);
  } else if (deviations.length > 5) {
    console.log(`편차 사례(첫 5개):`, deviations.slice(0, 5));
  }
  return { side, total, matched, everCongested, maxDeviation, elapsedMs, maxCongestedDistance };
}

function main() {
  console.log('도시 규모 격자에서 사고 전파 지연이 그래프 거리와 정확히 일치하는지 검증');
  console.log('(강남대로 3구간 일렬 배치에서 증명한 "이전 틱 참조" 메커니즘의 일반화)');

  const results = [runCheck(10, 12), runCheck(32, 20), runCheck(50, 30)];

  console.log('\n=== 요약 ===');
  for (const r of results) {
    const pct = r.everCongested ? ((r.matched / r.everCongested) * 100).toFixed(1) : 'N/A';
    console.log(`${r.total}구간: 도달노드 중 정확도 ${pct}% (${r.matched}/${r.everCongested}), 영향반경 ${r.maxCongestedDistance}홉, 최대편차 ${r.maxDeviation}틱, ${r.elapsedMs}ms`);
  }
}

main();
