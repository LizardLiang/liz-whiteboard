---
title: RTK & Token Reduction Strategies for Kratos
cached: 2026-05-09
valid_until: 2026-08-07
source: Mimir research
tags: [kratos, token-reduction, cost-optimization, prompt-caching, model-routing]
---

# RTK & Token Reduction Strategies for Kratos

## What Is RTK?

**RTK = Rust Token Killer** (`github.com/rtk-ai/rtk`). NOT "Response Token Kit" — that term has no established meaning. RTK is a Rust CLI proxy that compresses bash command outputs 60–90% before they reach LLM context. Integrates with Claude Code via PreToolUse hook. Supports 100+ commands: git, gh, jest, tsc, eslint, docker, kubectl, AWS CLI.

**Kratos applicability:** Relevant only to Ares (implementation) stage where bash tool calls dominate. Zero benefit for Athena, Hephaestus, Artemis, or review stages — their cost is LLM prose, not CLI output.

---

## Top 5 Token Reduction Techniques

### 1. Anthropic Prompt Caching — Impact: HIGH / Effort: LOW

Cache reads cost 0.1x base input price (90% discount). Every Kratos agent currently re-sends its full system prompt as uncached input.

- Use `system` as array with `{"type": "ephemeral", "ttl": "1h"}` on all static blocks
- Use 1-hour TTL (Kratos stages run longer than 5 minutes)
- Cache tool definitions separately — up to 4 independent breakpoints per request
- Pre-warm agents at pipeline start with `max_tokens=0` requests
- **Cache killers:** timestamps/request IDs in cached blocks, non-deterministic tool order, dynamic tool toggling, images anywhere in prompt
- **Minimum thresholds:** Sonnet 4.6 = 2048 tokens; Opus 4.6 = 4096 tokens

### 2. Model Routing — Downgrade Stages — Impact: HIGH / Effort: LOW

Opus 4.6 costs 40% more than Sonnet 4.6 (SWE-bench: 80.8% vs 79.6% — 1.2pp gap).

| Stage | Agent | Recommended | Rationale |
|-------|-------|-------------|-----------|
| PRD writing | Athena | Sonnet 4.6 | Creative synthesis, not deep reasoning |
| Tech spec | Hephaestus | Sonnet 4.6 | Within Sonnet's capability |
| Task decomposition | Hephaestus | Haiku 4.5 | Structured extraction |
| Implementation | Ares | Sonnet 4.6 | 40% cheaper, 1.2pp quality gap |
| Test planning | Artemis | Haiku 4.5 | Low reasoning demand |
| Code review | Hermes/Cassandra | Sonnet 4.6 | Reasoning needed, not Opus depth |
| Red-team risk | Cassandra | Opus (optional) | Only stage where Opus depth may justify cost |
| Orchestration/routing | Kratos | Haiku 4.5 | Classification, not reasoning |

**Opus-as-advisor pattern:** Use Opus once at pipeline start for high-level constraints, then hand to Sonnet for all execution. Result: 11% cost reduction + 2% quality improvement.

### 3. Selective Context Forwarding (YAML Handoffs) — Impact: HIGH / Effort: MEDIUM

Full-context forwarding in 4-agent pipelines results in 20+ calls each carrying the entire growing transcript. Selective forwarding: **70–90% context reduction**.

Each agent outputs:
- `<stage>.md` — full human-readable document (never forwarded downstream)
- `<stage>-summary.yaml` — structured handoff payload only

| From | To | Summary contains |
|------|----|-----------------|
| Athena (PRD) | Hephaestus | Acceptance criteria, data constraints, API shape, key decisions — no narrative |
| Hephaestus (spec) | Ares | Component list, function signatures, file paths, data model delta — no rationale |
| Ares (impl) | Artemis | Files changed, functions added/modified, edge cases — no narrative |
| Any stage | Reviewer | Diff + test results only |

### 4. Output Format Discipline — Impact: MEDIUM / Effort: LOW

- Use YAML for inter-agent handoffs (30–60% fewer tokens than JSON for tabular data)
- Add to every agent system prompt:
  ```
  OUTPUT DISCIPLINE:
  - Inter-agent handoff: YAML only. No preamble, no conclusion, no apology.
  - Fragments OK. Omit articles.
  - Reasoning is internal — never repeat it in structured output.
  ```
- Two-step pattern: let agent reason in prose → format into YAML as final step (forcing structured reasoning directly degrades accuracy 10–15%)
- Set explicit `max_tokens` per stage — output tokens cost 4–6x more than input

### 5. RTK for Ares Bash Tool Output — Impact: MEDIUM / Effort: LOW

Install RTK and register PreToolUse hook in Ares agent init. Transparently rewrites all bash calls through compression proxy.

**Savings:** 60–90% on CLI output tokens. 50 tool calls: ~150k context → ~45k.

---

## Honourable Mentions

- **Rolling summarization:** Keep last 10 messages verbatim; summarize older into cacheable system block. Acon framework: 26–54% peak token reduction, 95% task retention.
- **AgentDropout:** Skip agents with redundant contributions. 21.6% prompt + 18.4% completion reduction.
- **SkillReducer:** Audit tool descriptions — 63% reduction achievable with comparable performance.
- **Extended thinking budgets:** Disable for routing/classification; 1k–4k for moderate reasoning; up to 10k for Cassandra red-team. Never leave at default max.

---

## Implementation Priority for Kratos

| # | Technique | Effort | Expected Savings |
|---|-----------|--------|-----------------|
| 1 | Prompt caching (1h TTL) on all agent system prompts | 1 day | 50–80% input cost on repeated calls |
| 2 | Model routing: Ares+Athena→Sonnet; Artemis/decomp→Haiku | 2 hours | 30–40% overall cost |
| 3 | Selective context forwarding (YAML summary schemas) | 2 days | 60–70% input reduction downstream |
| 4 | Output format discipline (YAML handoffs, terse rules) | 1 day | 20–40% output token reduction |
| 5 | RTK for Ares bash tool calls | 1 hour | 60–90% on CLI output tokens |
| 6 | Rolling summarization + observation masking for Ares | 3 days | 30–50% context reduction long sessions |

**Total realistic reduction applying all six: 65–80% of current token spend.** First three alone deliver 60%+ at ~3 days effort.

---

## Sources

- [RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk)
- [Anthropic Prompt Caching Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Stop Wasting Tokens: Efficient Multi-Agent Systems — arXiv 2510.26585](https://arxiv.org/html/2510.26585v2)
- [AgentDropout — ACL 2025](https://aclanthology.org/2025.acl-long.1170/)
- [SkillReducer — arXiv 2603.29919](https://arxiv.org/html/2603.29919v1)
- [Acon: Context Compression — arXiv 2510.00615](https://arxiv.org/html/2510.00615v1)
- [Opus-as-Advisor Strategy — MindStudio](https://www.mindstudio.ai/blog/anthropic-advisor-strategy-opus-adviser-sonnet-haiku)
- [JSON vs TOON Token Format — Medium](https://medium.com/@michael.hannecke/beyond-json-picking-the-right-format-for-llm-pipelines-b65f15f77f7d)
