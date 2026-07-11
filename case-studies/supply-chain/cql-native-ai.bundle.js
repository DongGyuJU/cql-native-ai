// src/validate.ts
var STATUSES = ["good", "warning", "info", "error"];
var InsightValidationError = class extends Error {
  constructor(message, value) {
    super(`[cql-native-ai] invalid DomainInsight: ${message}`);
    this.value = value;
  }
};
function validateInsight(value, expectedDomain) {
  if (typeof value !== "object" || value === null) {
    throw new InsightValidationError("not an object", value);
  }
  const v = value;
  if (typeof v.domain !== "string" || v.domain.length === 0) {
    throw new InsightValidationError('missing "domain"', value);
  }
  if (expectedDomain && v.domain !== expectedDomain) {
    throw new InsightValidationError(
      `domain mismatch: expected "${expectedDomain}", got "${v.domain}"`,
      value
    );
  }
  if (!STATUSES.includes(v.status)) {
    throw new InsightValidationError(
      `"status" must be one of ${STATUSES.join("|")}`,
      value
    );
  }
  for (const key of ["headline", "detail", "recommendation"]) {
    if (typeof v[key] !== "string") {
      throw new InsightValidationError(`missing string field "${key}"`, value);
    }
  }
  const c = v.confidence;
  if (typeof c !== "number" || Number.isNaN(c) || c < 0 || c > 1) {
    throw new InsightValidationError('"confidence" must be a number in [0,1]', value);
  }
}

// src/agent.ts
var DomainAgent = class {
  constructor(domain, analyzeFn) {
    this.domain = domain;
    this.analyzeFn = analyzeFn;
    if (!domain.id) throw new Error("[cql-native-ai] domain.id is required");
  }
  /**
   * Apply the functor: F_d(input, history) → DomainInsight.
   * Output is runtime-validated so downstream consumers (Meta Agent,
   * Natural Transformations) can rely on the interface.
   */
  async analyze(input, history = [], options = {}) {
    const insight = await this.analyzeFn(input, history, options);
    validateInsight(insight, this.domain.id);
    if (!insight.timestamp) insight.timestamp = (/* @__PURE__ */ new Date()).toISOString();
    return insight;
  }
};
function createAgent(domain, analyzeFn) {
  return new DomainAgent(domain, analyzeFn);
}

// src/registry.ts
var DomainRegistry = class {
  constructor() {
    this.agents = /* @__PURE__ */ new Map();
  }
  /** Add (or replace) a Domain Agent. Returns the registry for chaining. */
  register(agent) {
    this.agents.set(agent.domain.id, agent);
    return this;
  }
  unregister(domainId) {
    return this.agents.delete(domainId);
  }
  get(domainId) {
    return this.agents.get(domainId);
  }
  has(domainId) {
    return this.agents.has(domainId);
  }
  /** All active agents (Objects of D). */
  list() {
    return [...this.agents.values()].filter(
      (a) => a.domain.active !== false
    );
  }
  /** All active domain definitions. */
  domains() {
    return this.list().map((a) => a.domain);
  }
  /**
   * Keyword-based domain inference over free text.
   * Useful as a cheap pre-classifier before invoking an LLM.
   */
  inferDomains(text) {
    const lower = text.toLowerCase();
    return this.domains().filter(
      (d) => (d.keywords ?? []).some((kw) => lower.includes(kw.toLowerCase()))
    );
  }
  /**
   * Build a classifier prompt section listing every active domain.
   * Feed this into any LLM that must map free text → domain ids.
   * Because it is generated from the registry, adding a domain
   * automatically updates classification behavior.
   */
  buildClassifierPrompt() {
    const lines = this.domains().map((d) => {
      const kw = d.keywords?.length ? ` (signals: ${d.keywords.join(", ")})` : "";
      return `- ${d.id}: ${d.description ?? d.name}${kw}`;
    });
    return lines.join("\n");
  }
  /**
   * Build the Meta Agent context section: one line per domain
   * describing what it contributes.
   */
  buildMetaContext() {
    return this.domains().map((d) => `${d.name} (${d.id}): ${d.metaSummaryTemplate ?? d.description ?? ""}`).join("\n");
  }
  /** Serialize registry definitions (e.g. to persist as JSON). */
  toJSON() {
    return this.domains();
  }
};

// src/types.ts
function errorInsight(domain, err) {
  return {
    domain,
    status: "error",
    headline: "analysis failed",
    detail: err instanceof Error ? err.message : String(err),
    recommendation: "check agent implementation or input data",
    confidence: 0,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/meta.ts
var TemplateSynthesizer = class {
  async synthesize(insights) {
    const warn = insights.filter((i) => i.status === "warning");
    const good = insights.filter((i) => i.status === "good");
    const parts = [];
    if (warn.length) {
      parts.push(
        `Attention needed: ${warn.map((i) => `${i.domain} (${i.headline})`).join(", ")}.`
      );
      const top = warn.sort((a, b) => b.confidence - a.confidence)[0];
      if (top?.recommendation) parts.push(`Recommended action: ${top.recommendation}`);
    }
    if (good.length) {
      parts.push(`On track: ${good.map((i) => i.domain).join(", ")}.`);
    }
    if (!parts.length) parts.push("Not enough data yet \u2014 keep logging.");
    return parts.join(" ");
  }
};
var MetaAgent = class {
  constructor(registry, synthesizer = new TemplateSynthesizer()) {
    this.registry = registry;
    this.synthesizer = synthesizer;
  }
  /**
   * Run the lax colimit:
   *   1. fan out to every registered agent that has input (in parallel)
   *   2. collect all DomainInsights (errors become error-insights,
   *      keeping the colimit total)
   *   3. synthesize a UnifiedInsight
   */
  async run({ inputs, history = [] }) {
    const agents = this.registry.list().filter((a) => inputs[a.domain.id] !== void 0);
    const insights = await Promise.all(
      agents.map(
        (a) => a.analyze(inputs[a.domain.id], history).catch((err) => errorInsight(a.domain.id, err))
      )
    );
    const text = await this.synthesizer.synthesize(insights, {
      domainContext: this.registry.buildMetaContext()
    });
    return {
      insight: text,
      warningDomains: insights.filter((i) => i.status === "warning").map((i) => i.domain),
      goodDomains: insights.filter((i) => i.status === "good").map((i) => i.domain),
      contributing: insights,
      meta: {
        activeDomainCount: this.registry.list().length,
        analyzedDomainCount: insights.length,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
  }
};

// src/transform.ts
var NaturalTransformation = class {
  constructor(source, target, translation) {
    this.source = source;
    this.target = target;
    this.translation = translation;
  }
  /**
   * Apply η at a single input:
   *   1. F_A(input)                    — source insight
   *   2. G(input)                      — translate to target domain
   *   3. F_B(G(input), context=F_A(x)) — target insight, informed by source
   */
  async apply(input, history = []) {
    const sourceInsight = await this.source.analyze(input, history);
    const translated = this.translation.translateInput(input);
    const targetInsight = await this.target.analyze(translated, history, {
      context: [sourceInsight]
    });
    return { sourceInsight, targetInsight };
  }
  /**
   * Empirical naturality check.
   *
   * Naturality demands the square commutes: for inputs x1, x2 the
   * target conclusion must not depend on processing order. LLM-backed
   * agents can violate this; this method measures how badly.
   *
   * We compare F_B applied after [x1 then x2] vs [x2 then x1] and
   * report status equality + headline similarity.
   */
  async checkNaturality(inputs, history = [], threshold = 0.8) {
    const [x1, x2] = inputs;
    const s1 = await this.source.analyze(x1, history);
    const forward = await this.target.analyze(
      this.translation.translateInput(x2),
      history,
      { context: [s1] }
    );
    const s2 = await this.source.analyze(x2, history);
    const reversed = await this.target.analyze(
      this.translation.translateInput(x2),
      history,
      { context: [s2, s1] }
      // same information, different arrival order
    );
    const statusMatch = forward.status === reversed.status;
    const headlineSimilarity = jaccard(forward.headline, reversed.headline);
    const similarity = (Number(statusMatch) + headlineSimilarity) / 2;
    return {
      consistent: similarity >= threshold,
      similarity,
      details: { statusMatch, headlineSimilarity, forward, reversed }
    };
  }
};
function jaccard(a, b) {
  const ta = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}
export {
  DomainAgent,
  DomainRegistry,
  MetaAgent,
  NaturalTransformation,
  createAgent
};
