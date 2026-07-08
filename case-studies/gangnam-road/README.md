# Case Study: 강남대로 (Gangnam-daero)
### Real-time road traffic — spatial propagation + a real government API

This case study is deliberately structured differently from
[bungae-mart](../bungae-mart) to prove `cql-native-ai` isn't specific to
"organizational" domains. Roads have **spatial topology**: congestion at
one intersection propagates to the physically adjacent one, with a
visible time lag — not an abstract cross-department relationship.

It also connects one segment to **live, real government open data**
(Seoul TOPIS), proving the framework holds up past a purely simulated
demo.

---

## Domains

| Domain | What it watches | Note |
|---|---|---|
| `traffic-gangnam` | Speed, vehicle flow, queue length at 강남역사거리 | **Connected to real Seoul Open Data API** |
| `traffic-sinnonhyeon` | Same, at 신논현역사거리 | Simulated, reacts to `traffic-gangnam` with a 1-tick lag |
| `traffic-nonhyeon` | Same, at 논현역사거리 | Simulated, reacts to `traffic-sinnonhyeon` with a 1-tick lag |
| `incident` | Accident / lane closures | Simulated |
| `signal` | Traffic light queue vs. capacity | Simulated |
| `weather` | Rain reduces capacity broadly | Simulated |

## The key structural difference from bungae-mart

In bungae-mart, every `NaturalTransformation` connected **different
kinds** of domains (`demand ⇒ inventory`). Here, the interesting
transformation connects **the same domain type at different spatial
nodes**:

```
traffic-gangnam ⇒ traffic-sinnonhyeon ⇒ traffic-nonhyeon
```

Each segment's `DomainDefinition.relations` field encodes the actual
road graph adjacency (`{ from: 'gangnam', to: 'sinnonhyeon' }`) — this
is a real Morphism of the road network's Category, not a metaphorical
one. `gangnam-road.ts` demonstrates this with `NaturalTransformation`
instances; the live dashboard demonstrates it with an actual propagation
delay (see below).

## Extensibility proof

`gangnam-road.ts` registers a 3rd segment (논현역) — a graph node, not a
new *kind* of domain — with zero changes to the first two segments'
agents, proving extensibility works for **growing a spatial graph**, a
different axis than bungae-mart's "add an unrelated department" proof.

---

## Files

| File | What it is |
|---|---|
| `gangnam-road.ts` | Static scenario: incident + rush hour, run once |
| `road-dashboard-server.ts` | Live simulator with a deliberate propagation lag + real Seoul API integration for one segment |
| `road-dashboard.html` | Dashboard rendering the 3 segments as a connected road strip (not generic cards) so propagation is visually obvious |

## Run the static scenario

```bash
mkdir gangnam-road-demo && cd gangnam-road-demo
npm init -y
npm install cql-native-ai fastify
npm install -D typescript ts-node @types/node
# copy the 3 files above into this folder

npx ts-node --compiler-options '{"esModuleInterop":true,"module":"commonjs","skipLibCheck":true}' gangnam-road.ts
```

Actual output:

```
--- η: 강남역 구간 ⇒ 신논현역 구간 (공간적 인접 전파) ---
강남역 구간: 강남역사거리: 평균 12km/h, 대기 380m
신논현역 구간: 신논현역사거리: 평균 18km/h, 대기 180m /
  분당 22대 통과. 상류(gangnam) 정체 유입 반영됨.

=== 확장: "논현역 구간" 추가 (기존 코드 0줄 수정) ===
analyzed domains: [
  'traffic-gangnam', 'traffic-sinnonhyeon', 'traffic-nonhyeon',
  'incident', 'signal', 'weather'
]
```

## Run the live dashboard (with real data)

### 1. Get a Seoul Open Data API key

1. Register at [data.seoul.go.kr](http://data.seoul.go.kr)
2. Find "서울시 실시간 도로 소통 정보" (infId `OA-13291`), apply for a key
3. Confirmed working endpoint pattern:
   ```
   http://openapi.seoul.go.kr:8088/{API_KEY}/xml/TrafficInfo/1/5/{link_id}
   ```
   Response fields: `link_id`, `prcs_spd` (speed, inferred km/h),
   `prcs_trv_time` (travel time, inferred seconds — units not explicitly
   documented in what we could find; inferred from example values).
   **Only XML is supported** — requesting `json` returns `ERROR-301`.

### 2. Find real `link_id`s for the segments you want

We were **not** able to reliably reverse-engineer nearby `link_id`s by
guessing sequential numbers (tested 20 IDs adjacent to a known-working
one; only the original worked — `link_id`s are not sequential by
location). The reliable path is the TOPIS map UI
(https://topis.seoul.go.kr) — click a road segment to see its `link_id`.
This repo ships with exactly **one confirmed working `link_id`**
(`1220003800`, near 강남역).

### 3. Run

```bash
SEOUL_API_KEY=your_key_here npx ts-node --compiler-options '{"esModuleInterop":true,"module":"commonjs","skipLibCheck":true}' road-dashboard-server.ts
# open http://localhost:3200
```

Verified real response during testing:
```
speedKmh: 8, travelTimeSec: 1350   (first call)
speedKmh: 6, travelTimeSec: 1799   (a minute later — genuinely live)
```

### 4. Adding more real segments later

`road-dashboard-server.ts` reads real vs. simulated segments from one map:

```ts
const REAL_LINK_IDS: Record<string, string> = {
  gangnam: '1220003800',
  // sinnonhyeon: 'xxxxxxxxxx',  // add here once you find it
  // nonhyeon: 'xxxxxxxxxx',
};
```

Adding a segment here is the **only** change required — `tick()`, the
agents, the `NaturalTransformation`s, and the HTML are untouched. This
mirrors the library's own "one `register()` call" extensibility story,
just at the data-source layer.

### Design notes on the live simulator

- The simulation ticks every 3s (for visual liveliness); the real API is
  polled every 15s on a separate timer, since the underlying government
  data almost certainly doesn't update every 3s, and this stays well
  within any reasonable daily call quota.
- `traffic-sinnonhyeon` reacts to `traffic-gangnam`'s value **from the
  previous tick**, and `traffic-nonhyeon` reacts to `traffic-sinnonhyeon`'s
  previous-tick value — this is what makes congestion visibly spread
  down the road strip with a delay instead of all three segments
  changing in lockstep.
- If the real API call fails or times out (4s timeout), the segment
  falls back to the simulator automatically — the server does not crash
  or freeze.
