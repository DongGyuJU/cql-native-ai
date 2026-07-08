# Case Studies

Two independent, worked examples of `cql-native-ai` applied to domains
that have nothing to do with each other or with the framework's own
`examples/` — proving the Category/Functor/Natural Transformation/Meta
Agent structure genuinely generalizes, not just to "yet another business
dashboard."

| Case study | Domain shape | Natural Transformation pattern | Real data |
|---|---|---|---|
| [bungae-mart](bungae-mart/) | Organizational (4 departments) | Cross-domain causal chain: `demand ⇒ inventory ⇒ delivery` | Simulated |
| [gangnam-road](gangnam-road/) | Spatial (road segments) | Same-domain-type, adjacent nodes: `traffic-A ⇒ traffic-B ⇒ traffic-C` | **One segment connected to the real Seoul Open Data API** |

Both case studies include:
- A static scenario script (run once, inspect the output)
- A live dashboard (Fastify server + a tick-based simulator + a polling HTML page)
- An explicit extensibility proof (registering one more domain/node with zero changes elsewhere)
- Real, actually-executed terminal output in the README — not invented sample output

## Want to build your own?

[`../prompts/cql_domain_generator_prompt.md`](../prompts/cql_domain_generator_prompt.md)
is a fill-in-the-blanks prompt template that reproduces this same
quality of demo (static scenario + live dashboard + verified output) for
**any domain you describe** — hospital, warehouse, manufacturing line,
whatever — in a fresh Claude conversation with no prior context needed.
