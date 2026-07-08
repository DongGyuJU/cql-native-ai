# CQL Native AI — Domain Demo Generator Prompt

> Copy everything below the line into a **fresh Claude conversation**
> (no prior context needed), fill in the bracketed fields at the top,
> and send it. This reliably produces a working, verified, runnable
> demo of the `cql-native-ai` npm library for any business/domain you
> describe — a static scenario, a live simulated dashboard, and
> step-by-step instructions to run it yourself.

---

## FILL THIS IN BEFORE SENDING

```
DOMAIN NAME: [e.g. "우리 병원 응급실", "물류창고", "제조 라인"]

SUB-DOMAINS (3-6 things that need monitoring, each fairly independent):
  1. [e.g. "환자 대기열"]
  2. [e.g. "병상 가용성"]
  3. [e.g. "의료진 배치"]
  4. [optional]
  5. [optional]

KEY RELATIONSHIP #1 (which sub-domain's state should influence another's analysis, and how):
  [e.g. "환자 대기열이 길어지면 → 병상 가용성 압박이 커진다"]

KEY RELATIONSHIP #2 (optional — pick a SPATIAL/SEQUENTIAL one if your
domain has physical or pipeline structure, e.g. adjacent locations or
pipeline stages feeding into each other; otherwise another causal one):
  [e.g. "응급실 대기열 ⇒ 다음 시간대 예상 대기열" OR
        "1층 병동 ⇒ 2층 병동 (환자 이송 흐름)"]

LANGUAGE FOR OUTPUT TEXT: [Korean / English / other]
```

---

## PROMPT (send everything below this line)

I want you to build me a working demo of the `cql-native-ai` npm
library (https://www.npmjs.com/package/cql-native-ai) — a Category
Theory-based multi-agent framework where domains are Categories, agents
are Functors, inter-agent communication is a Natural Transformation,
and a Meta Agent computes a Lax Colimit over all registered domains.

My domain: **[DOMAIN NAME]**

The sub-domains I want modeled as separate Domain Agents:
**[SUB-DOMAINS list]**

Relationships I want expressed as `NaturalTransformation`s (a source
agent's insight should be passed as `context` into the target agent's
analysis, and meaningfully change its output — not just be logged):
- **[KEY RELATIONSHIP #1]**
- **[KEY RELATIONSHIP #2]** (if my second relationship is spatial/sequential —
  e.g. adjacent locations, pipeline stages — model it as TWO instances of
  the SAME domain type connected by a Natural Transformation, the way you'd
  model traffic congestion propagating from one road segment to the next.
  If it's not spatial, treat it as a normal cross-domain relationship
  like the first one.)

Output text language: **[LANGUAGE]**

### What to build, in order

**Step 0 — Sanity check the library first.**
```bash
mkdir -p /tmp/cql-demo && cd /tmp/cql-demo
npm init -y
npm install cql-native-ai
npm view cql-native-ai version
```
Confirm a version prints. If installation fails, stop and tell me —
don't proceed on an assumption that it works.

**Step 1 — Static scenario file (`scenario.ts`).**
Using `createAgent`, `DomainRegistry`, `MetaAgent`, `NaturalTransformation`,
and `DomainDefinition` from `cql-native-ai`:

1. Define a `DomainDefinition` for each sub-domain (`id`, `name`,
   `description`, `keywords`, `schema`, `metaSummaryTemplate`). If a
   relationship is spatial/sequential, encode the adjacency in the
   `relations` field (e.g. `relations: [{ from: 'A', to: 'B', label: '...' }]`)
   — this field should reflect a REAL structural fact about my domain,
   not be decorative.
2. Write one `createAgent(...)` per sub-domain. **Rule-based, zero
   dependencies, zero API keys** — realistic thresholds and Korean/English
   business language in `headline`/`detail`/`recommendation`, not generic
   placeholder text. Each agent that receives `context` from a
   `NaturalTransformation` must actually read `opts.context` and change
   its output based on what it finds there (mirror the pattern: check
   `opts.context?.find(c => c.domain === '...')`, and if its status is
   `'warning'`, append an explanatory note to `detail`).
3. Register all agents into one `DomainRegistry`.
4. Build the `NaturalTransformation`(s) requested above, each with a
   real `translateInput` function that meaningfully derives the target
   agent's input from the source agent's input (not a no-op passthrough).
5. Write a `main()` that:
   - Applies each `NaturalTransformation` once and prints
     `sourceInsight.headline` and `targetInsight.headline` + `detail`,
     so I can see the translation actually happened.
   - Runs `MetaAgent.run({ inputs: {...} })` with realistic numbers for
     a single interesting scenario (pick numbers that make at least one
     domain `warning` and at least one `good`, not everything the same
     status — a flat scenario doesn't prove anything).
   - Prints `unified.insight`, `unified.warningDomains`, `unified.goodDomains`.
   - **Then demonstrates extensibility**: register ONE more domain that
     wasn't in the original set (your choice, plausible for my business),
     re-run `MetaAgent.run()` with it included, and print
     `unified.contributing.map(c => c.domain)` to show it was picked up
     automatically with zero changes to the earlier agents.

**Verification requirement — do not skip this.** Actually run
`scenario.ts` with `ts-node` and confirm it produces sensible, non-crashing
output before showing it to me. Paste the real terminal output in your
response — not a description of what it would print.

**Step 2 — Live dashboard (`dashboard-server.ts` + `dashboard.html`).**
1. A Fastify server that:
   - Holds an in-memory `state` object with plausible starting values
     for every raw metric your agents need.
   - Has a `tick()` function called via `setInterval(tick, 3000)` that
     evolves `state` realistically — some randomness, but driven by
     the same relationships as the `NaturalTransformation`s above (e.g.
     if domain A's metric is bad, domain B's metric should visibly
     trend worse a tick or two later — use a "previous tick" value to
     create a deliberate lag, the way congestion should visibly spread
     from one road segment to the next rather than jumping instantly).
   - Exposes `GET /snapshot` (raw current state) and `GET /insight`
     (builds fresh domain inputs from current state, runs
     `meta.run()`, returns the `UnifiedInsight`).
   - Serves a dashboard HTML page at `GET /`.
2. A single static `dashboard.html` (vanilla JS, no framework, dark
   theme) that polls `GET /insight` every 3 seconds and renders: the
   synthesized insight text prominently, and one card per domain with a
   colored status dot (green=good, blue=info, orange=warning) and its
   headline/detail. If my domain has a spatial/sequential relationship,
   render those specific domains as a connected horizontal strip
   (segment blocks with an arrow between them) instead of plain cards,
   so the propagation is visually obvious as it happens.

**Verification requirement.** Start the server, and using `curl`,
call `/snapshot` twice with several seconds between calls to prove the
numbers actually change over time. If there's an event with low random
probability (e.g. an incident/spike), temporarily force it to trigger
in your test (e.g. hardcode the initial state to the "event active"
condition), confirm the propagation/lag behavior looks right by sampling
`/snapshot` every few seconds across enough time to see it start and
resolve, THEN revert the hardcoded value back to the real random-trigger
logic before showing me the final code. Paste the real sampled values
you observed (not invented ones) as evidence in your response.

**Step 3 — Give me copy-paste instructions**, not just files: exact
`mkdir`/`npm init`/`npm install` commands, the full contents of each
file as a code block I can paste, and the exact command to run the
server, ending with what URL to open in my browser.

### Ground rules

- Do not claim something works, compiles, or produces a certain output
  unless you actually ran it and are reporting the real result.
- Keep the core demo dependency-free except `cql-native-ai` and
  `fastify`. No React, no build step, no framework for the HTML.
- Use realistic numbers and domain language for **[DOMAIN NAME]** —
  not generic "Domain A / Domain B" placeholders.
- If any instruction above is ambiguous or you have to invent a
  business detail I didn't specify, make a reasonable assumption, state
  it explicitly in one line, and keep going — don't stop to ask unless
  you're genuinely blocked.
