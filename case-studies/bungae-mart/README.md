# Case Study: 번개마트 (Bungae Mart)
### 15-minute instant grocery delivery — a fictional Seoul dark-store startup

This case study proves `cql-native-ai` works on a genuinely different
domain than the framework's own `examples/`: a multi-department
operations problem where departments (order demand, inventory, delivery,
customer support) have real causal relationships — a stock shortage
doesn't just look bad on an inventory dashboard, it actually slows down
delivery and spikes complaints.

Everything in this folder was installed and run against the **published
npm package** (`npm install cql-native-ai`), not the framework's own
local source — this is what an actual outside adopter's experience looks
like.

---

## Domains

| Domain | What it watches | Category Theory role |
|---|---|---|
| `demand` | Order volume surge vs. baseline | Object of `C_demand` |
| `inventory` | Per-SKU stock level, spoilage risk | Object of `C_inventory` |
| `delivery` | Rider fleet, ETA vs. 15-min SLA | Object of `C_delivery` |
| `cs` | Complaint / refund volume | Object of `C_cs` |

## Natural Transformations

```
demand ⇒ inventory ⇒ delivery
```

An order surge (`demand`) is translated into expected stock drain
(`inventory`'s input), and a stockout (`inventory`) is translated into
rider slowdown (`delivery`'s input) — each `NaturalTransformation`'s
`translateInput` function encodes a real operational relationship, not a
no-op passthrough. The target agent also reads the source agent's
`DomainInsight` from `opts.context` and appends a causal explanation
(e.g. "수요 도메인이 주문 급증을 보고함 — 재고 소진 속도가 이 예측보다
빠를 수 있음") — this is the Natural Transformation actually doing
something, not just being logged.

## Extensibility proof

After the initial 4-domain scenario runs, the script registers a 5th
domain — `marketing` (an active discount campaign) — with **zero changes
to the four existing agents**, and re-runs `MetaAgent.run()`. The new
domain is picked up automatically (Proposition 2: extensibility).

---

## Files

| File | What it is |
|---|---|
| `bungae-mart.ts` | Static scenario: one snapshot (저녁 피크타임), run once, prints results |
| `dashboard-server.ts` | Same 4 domains, but a `tick()` simulator evolves the numbers every 3s; Fastify serves `GET /insight` (re-runs `MetaAgent` on current state) and `GET /snapshot` |
| `dashboard.html` | Vanilla-JS page polling `/insight` every 3s, rendering colored status cards |

## Run it

```bash
mkdir bungae-mart-demo && cd bungae-mart-demo
npm init -y
npm install cql-native-ai fastify
npm install -D typescript ts-node @types/node

# copy bungae-mart.ts, dashboard-server.ts, dashboard.html into this folder

npx ts-node --compiler-options '{"esModuleInterop":true,"module":"commonjs","skipLibCheck":true}' bungae-mart.ts
```

Expected output (abridged, actual run):

```
--- η: 수요 ⇒ 재고 ---
수요: 성수점: 평시 대비 2.3배 주문
재고: 성수점: 품절위기 1종, 폐기임박 0종 / 품절 임박: 생수 2L.
      수요 도메인이 주문 급증을 보고함 — 재고 소진 속도가 이 예측보다 빠를 수 있음.

=== F_meta: 성수점 운영 대시보드 ===
Attention needed: demand (...), inventory (...), delivery (...), cs (...).
Recommended action: 생수 2L 긴급 재배치 또는 발주
warning domains: [ 'demand', 'inventory', 'delivery', 'cs' ]

=== 확장: "marketing" 도메인 추가 (다른 파일 수정 없음) ===
analyzed domains: [ 'demand', 'inventory', 'delivery', 'cs', 'marketing' ]
```

For the live dashboard:

```bash
npx ts-node --compiler-options '{"esModuleInterop":true,"module":"commonjs","skipLibCheck":true}' dashboard-server.ts
# open http://localhost:3100
```

Watch for a few minutes — the numbers evolve on their own (a random-walk
simulator standing in for a real POS feed), and when inventory drops low
enough, the delivery and CS cards visibly react.

## What would make this fully "production"

Replace the `tick()` function's random-walk logic with real calls to
your POS / inventory / delivery-tracking APIs. Nothing else in this
file — the agents, the `NaturalTransformation`s, the `MetaAgent` — needs
to change. See the [gangnam-road](../gangnam-road) case study for a
worked example of exactly this swap, using a real government API.
