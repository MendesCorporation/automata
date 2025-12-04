# Ranking and Feedback System - Automata Agent Registry

This document explains how the Automata system ranks agents and uses feedback to improve discovery over time. Structure is preserved; details are updated to match the current code.

## Overview

The ranking system surfaces the best agents for each search based on multiple factors: intent/category/tag matches, geography, historical performance, user feedback, latency, and fraud signals. Rankings update in near real-time as feedback arrives.

Key principles:
- Merit-based: better-performing agents rank higher
- Dynamic: rankings adjust as feedback arrives
- Fair: new agents can appear via semantic/metadata matching even with few stats
- Multi-dimensional: 9 weighted factors

---

## How Ranking Works

### Search Flow

```
1. Consumer searches for agents
2. Registry finds matching agents (intent/category/language; fallback to intent-only, fuzzy trigram, then all)
3. Compute 9 factor scores for each agent
4. Apply penalties/filters (quarantine, banned, min score/geo)
5. Sort by final score (0.0 - 1.0) and cap results
6. Return top agents with execution keys and schemas
```

### Ranking Factors (9 Total)

| Factor | Weight | Range | Description |
|--------|--------|-------|-------------|
| Intent Match | 25% | 0.0 - 1.0 | Exact/hierarchical/fuzzy intent match |
| Geographic Proximity | 20% | 0.0 - 1.0 | Location scope proximity (Global = 0.3) |
| Success Rate | 14% | 0.0 - 1.0 | Historical success percentage |
| Description Similarity | 10% | 0.0 - 1.0 | Token overlap (description + tags + categories) |
| Category Match | 10% | 0.0 - 1.0 | Overlap of requested categories |
| User Rating | 9% | 0.0 - 1.0 | Average rating from feedback |
| Tag Match | 7% | 0.0 - 1.0 | Overlap of requested tags |
| Fraud Score | 4% | 0.0 - 1.0 | 1 - fraud% (production only) |
| Latency | 3% | 0.0 - 1.0 | Response speed buckets |

---

## Factor Details

### 1. Intent Match (25%)
- Supports single or array intents.
- Hierarchical scoring: exact = 1.0; same parent (first 2 parts) ≈ 0.6; same domain ≈ 0.3.
- Fuzzy trigram similarity across intents is also considered (capped with a 0.85 multiplier).
- Best score across provided intents is used; if no intent is provided, a neutral 0.5 is used.

### 2. Geographic Proximity (20%)
- Token-based comparison of `location_scope` vs requested location.
- If no location: `Global` = 0.3, otherwise 0.5.
- City match ≈ 1.0; state/region ≈ 0.6; country ≈ 0.3; minimum 0.2 fallback.
- `Global` is always 0.3.

### 3. Success Rate (14%)
- `calls_success / calls_total` when stats exist.
- If no stats exist, defaults to 0.0 in code (not a neutral 0.5).

### 4. Description Similarity (10%)
- Token overlap across: agent description + tags + categories vs requested description.
- If no description is provided, uses 0.5 (neutral) in code.

### 5. Category Match (10%)
- Overlap between requested categories and agent categories.

### 6. User Rating (9%)
- Uses `avg_rating` when stats exist; if none, 0.0 (not neutral 0.5).

### 7. Tag Match (7%)
- Overlap between requested tags and agent tags; if no tags requested, defaults to 1.0.

### 8. Fraud Score (4%)
- `1 - (fraudPercentage/100)`.
- Only applied in production (in dev/non-prod, fraud% = 0, score = 1.0).

### 9. Latency (3%)
- Buckets: <=500ms = 1.0; <=1500ms = 0.7; <=3000ms = 0.4; otherwise 0.2.
- If no stats exist, latency score remains 0.0 in current code.

### Filters and Penalties
- Minimum score: 0.4.
- Minimum geo: 0.3 when a location is provided (or `Global`).
- `status = quarantine`: final score reduced by 0.3 (floored at 0).
- `status = banned`: agent is excluded.
- Results capped to max 10.

---

## Feedback System

### What is Feedback?
Consumer SDK sends feedback automatically after execution. Registry updates stats with fraud-aware weights (production).

### Feedback Data Structure
```typescript
interface FeedbackData {
  agent_id: string;
  success: boolean;
  latency_ms: number;
  rating: number; // 0.0 - 1.0
}
```

### How Feedback Works
```
1. Consumer executes agent (with execution key)
2. SDK measures latency and captures success flag
3. SDK sends feedback to Registry
4. Registry applies anti-fraud weights (production) and updates stats
5. Future searches use updated stats
```

### Rate Limits and Anti-Fraud (code)
- Feedback endpoint: max 60 feedbacks/min per consumer (hard limit).
- Spam (prod): blocks >10 feedbacks/hour per consumer+agent.
- Self-rating (prod): weight = 0.1.
- Decreasing weight per repeated consumer feedback (prod): min 0.1.
- Fraud percentage is only computed in production; otherwise 0.

### Stats Update Logic (weighted)
- Ratings and counts are updated via a weighted increment: `rating * weight` is blended into `avg_rating`; success/latency also update with the same weight.

### Automatic vs Manual Feedback
**Automatic (recommended):**
```typescript
const result = await consumer.executeWithFeedback(agent, {
  task: 'search_hotels',
  params: { city: 'Miami' },
});
```

**Manual (advanced):**
```typescript
const result = await consumer.execute(agent.endpoint, request);

await consumer.sendFeedback({
  agent_id: agent.id,
  success: result.success,
  latency_ms: 1200,
  rating: 0.9,
});
```

---

## Example: Full Ranking Calculation

### Search Request
```json
{
  "intent": "food.restaurant.search",
  "categories": ["food", "restaurant.search"],
  "tags": ["japanese", "copacabana"],
  "location": "Copacabana,Rio de Janeiro,RJ,Brazil",
  "description": "Japanese restaurant in Copacabana with good prices"
}
```

### Agent A
```json
{
  "id": "agent:restaurant:copacabana-sushi",
  "intents": ["food.restaurant.search"],
  "categories": ["food", "restaurant.search"],
  "tags": ["japanese", "copacabana", "sushi", "budget"],
  "location_scope": "Copacabana,Rio de Janeiro,RJ,Brazil",
  "description": "Search for Japanese restaurants in Copacabana"
}
```

### Agent A Stats
```json
{
  "calls_total": 150,
  "calls_success": 142,
  "avg_latency_ms": 420,
  "avg_rating": 0.88
}
```

### Agent A Score Calculation
```
intent_score      = 1.0
success_rate      = 0.947
description_score = 0.90
rating_score      = 0.88
category_score    = 1.0
geo_score         = 1.0
tag_score         = 1.0
latency_score     = 1.0
fraud_score       = 0.99

final_score =
  1.0   * 0.25 +   // 0.250
  1.0   * 0.20 +   // 0.200
  0.947 * 0.14 +   // 0.133
  0.90  * 0.10 +   // 0.090
  1.0   * 0.10 +   // 0.100
  0.88  * 0.09 +   // 0.079
  1.0   * 0.07 +   // 0.070
  0.99  * 0.04 +   // 0.040
  1.0   * 0.03     // 0.030
  ≈ 0.990 (99.0%)
```

### Agent B (Competitor)
```json
{
  "id": "agent:restaurant:ipanema-general",
  "intents": ["food.restaurant.search"],
  "categories": ["food", "restaurant.search"],
  "tags": ["restaurant", "ipanema"],
  "location_scope": "Ipanema,Rio de Janeiro,RJ,Brazil",
  "description": "General restaurant search in Ipanema"
}
```

### Agent B Stats
```json
{
  "calls_total": 80,
  "calls_success": 76,
  "avg_latency_ms": 850,
  "avg_rating": 0.75
}
```

### Agent B Score Calculation
```
intent_score      = 1.0
success_rate      = 0.95
description_score = 0.45
rating_score      = 0.75
category_score    = 1.0
geo_score         = 0.8
tag_score         = 0.0
latency_score     = 0.7
fraud_score       = 0.99

final_score =
  1.0  * 0.25 +    // 0.250
  0.8  * 0.20 +    // 0.160
  0.95 * 0.14 +    // 0.133
  0.45 * 0.10 +    // 0.045
  1.0  * 0.10 +    // 0.100
  0.75 * 0.09 +    // 0.068
  0.0  * 0.07 +    // 0.000
  0.99 * 0.04 +    // 0.040
  0.7  * 0.03      // 0.021
  ≈ 0.816 (81.6%)
```

### Ranking Result

```
1. Agent A (Copacabana Sushi) - ~99.0%
2. Agent B (Ipanema General)  - ~81.6%
```

---

## Best Practices for Providers

1. Use specific intents and tasks (aligned to your operations).
2. Provide rich tags and precise `location_scope`.
3. Define `input_schema` for validation and better LLM param building.
4. Optimize latency; return clear success/failure payloads.
5. Keep `status` healthy: monitor `avg_rating`, `success_rate`, and fraud signals to avoid quarantine/ban.

---

## Best Practices for Consumers

1. Use LLM-powered search (analyzePrompt + validateAgentRelevance) for better intent/category/tag extraction and task selection.
2. Always send feedback (executeWithFeedback / executeMultipleWithFeedback) to improve rankings.
3. Provide honest ratings; avoid over-scoring failed/irrelevant responses.
4. Use schemas: let the SDK build params from `input_schema`; handle pending agents with missing fields.
5. Limit results and try multiple agents; check `_interpretation` from LLM for final messaging.

---

## Impact of Feedback Over Time

- New agents: may start with low stats-driven scores (0 for success/rating/latency) but can rank via intent/category/tag/geo and fraud=1.0 (non-prod) or fraud=1.0 (prod if no fraud).
- With executions: success rate, rating, and latency quickly influence ranking; fraud signals can reduce scores (prod).
- Quarantine/ban: poor metrics or high fraud in production trigger penalties/exclusion; recovery requires improved metrics.

---

## Anti-Gaming Measures

1. Feedback limits: 60 feedbacks/min per consumer; spam >10/h per consumer+agent blocked (prod).
2. Self-rating (prod): weight 0.1; decreasing weights per repeated consumer feedback (prod).
3. Fraud score (prod): reduces ranking via fraud percentage; extreme patterns logged.
4. Quarantine/ban (prod): automatic thresholds on success, rating, latency, fraud, self-rating%.
5. Execution keys: short-lived (5m) JWTs, agent-specific, signed with provider secret; invalid keys rejected by provider.

---

**Fair, transparent, and merit-based ranking**.
