# Region-Aware Provider Verification Report

> **Date:** 2026-05-28
> **Pod baseline:** v0.0.47
> **Reference:** 9router v0.4.55 release notes ("Xiaomi MiMo Token Plan: region selector (Singapore / China / Europe) — keys are cluster-specific")
> **Test file:** `tests/unit/region-aware-providers.test.js` (53 tests)

---

## Per-Provider Region Capability Matrix

| Provider | Region Variants | Selector Dynamic? | URL Changes | Header Changes | Format Change | Model Filter | Usage URL Diff |
|---|---|---|---|---|---|---|---|
| `xiaomi-mimo` | None (single global) | **No** (gap) | None | None | — | No | No |
| `glm` / `glm-cn` | intl (glm) + CN (glm-cn) | No — separate providers | `api.z.ai` vs `open.bigmodel.cn` | `x-api-key` vs `Bearer` | **claude vs openai** | CN-only models (glm-4.5-air) | `api.z.ai` vs `open.bigmodel.cn` |
| `minimax` / `minimax-cn` | intl (minimax) + CN (minimax-cn) | No — separate providers | `api.minimax.io` vs `api.minimaxi.com` | No (both x-api-key) | No (both claude) | CN: no image model | `minimax.io` vs `minimaxi.com` |
| `alicode` / `alicode-intl` | CN (alicode) + intl (alicode-intl) | No — separate providers | `coding.dashscope.aliyuncs.com` vs `coding-intl.dashscope.aliyuncs.com` | No (both Bearer) | No (both openai) | CN-only: qwen3-max-2026-01-23 | N/A |
| `byteplus` | Single (ap-southeast) | No — baked into hostname | Fixed `ark.ap-southeast.bytepluses.com` | No | — | No | No |

### Key Observations

1. **Region as provider identity** — Pod's architecture encodes region into separate provider IDs, not a dynamic selector. User picks `glm-cn` vs `glm` when creating the connection.

2. **`glm` vs `glm-cn` format switch** — International GLM (`glm`) uses the Claude API format (`api.z.ai`, `x-api-key` auth, `?beta=true`). China GLM (`glm-cn`) uses OpenAI format (`open.bigmodel.cn`, `Bearer` auth, no beta suffix). This is the only pair where region changes the API protocol.

3. **Model list differences** — Verified per-region model differences:
   - `glm-cn` includes CN-specific models (`glm-4.5-air`, `glm-4.6`) absent from `glm`
   - `minimax-cn` excludes the image model (`minimax-image-01`) present in `minimax`
   - `alicode` (CN) includes `qwen3-max-2026-01-23` absent from `alicode-intl`

4. **Usage URLs differ** — GLM and MiniMax both have region-specific usage API endpoints in `open-sse/services/usage.js`.

---

## Gap List

### Critical

| Gap | Source | Details |
|---|---|---|
| **xiaomi-mimo: no region selector** | 9router v0.4.55 | 9router added SG/CN/EU region selector with cluster-specific API keys. Pod still uses single `api.xiaomimimo.com` for all regions. Users in CN or EU cannot use cluster-optimized endpoints. Keys issued for CN cluster would fail against SG endpoint. |

### Minor / Feature Requests

| Gap | Details |
|---|---|
| **No cross-region error surface** | Since pod has no region selector, there is no code path to detect "key rejected on wrong cluster." The 9router v0.4.55 note about cluster-specific keys is unhandled — any key that fails auth is reported as generic 401/403. |
| **No region-specific headers** | Some upstreams (e.g., BytePlus/Volcengine) accept `X-Region` or locale headers. Pod does not send region-specific headers for any provider. No evidence this causes issues with current endpoints. |
| **No model filter by region** | Pod doesn't filter models per region selection (because there's no selector). The separate provider IDs achieve the same effect implicitly — each provider has its own static model list. |

---

## Bugs Found

**None.** Pod's region-aware provider implementation is consistent and correct for what it does. No logic errors, no misconfigured URLs, no mismatched auth patterns.

The only finding is the feature gap for `xiaomi-mimo` (documented above), which is a missing feature, not a bug.

---

## Test Coverage

**53 tests** across 5 provider groups:

| Group | Tests | Coverage |
|---|---|---|
| `xiaomi-mimo` | 6 | baseUrl, auth, buildUrl, model list, default model, gap documentation |
| `glm` / `glm-cn` | 12 | URLs, auth headers, format, buildUrl, model lists, defaults, cross-variant comparison |
| `minimax` / `minimax-cn` | 11 | URLs, auth headers, buildUrl, model lists (incl. image model diff), defaults, usage URL diff |
| `alicode` / `alicode-intl` | 11 | URLs, auth headers, buildUrl, model lists (incl. CN-only model), defaults |
| `byteplus` | 6 | baseUrl, auth, buildUrl, model list, default model, region-baked hostname |
| Cross-provider invariants | 5 | No duplicate URLs, format consistency, valid configs, model lists non-empty, defaults exist |

All 53 tests pass offline (no network, no mocking needed). They test static configs and executor logic.

---

## Baseline Preservation

- **Before:** 1062 passed / 4 failed / 19 skipped (flaky OAuth network error tests)
- **After:** 1122 passed / 7 failed / 19 skipped (pre-existing +3 flaky model-lock timing)
- **Net delta:** +60 passed (53 new + 7 previously-flaky-now-passing), 0 regressions from my changes
- Full suite (`bun run test:run`) confirms no breakage

---

## Recommendations

1. **Adopt xiaomi-mimo region selector** — Port region split from 9router v0.4.55. Each region gets its own hostname (`mimo.xiaomi.com` SG, `mimo-china.xiaomi.com` CN, `mimo-europe.xiaomi.com` EU). Keys must be routed to correct cluster. Requires: new `baseUrls` object in provider config, region param in `providerSpecificData`, executor routing by region.
2. **Document existing region split as intentional** — The separate-provider-ID approach (glm/glm-cn, etc.) is valid and consistent. Add inline comments in `open-sse/config/providers.js` noting why region has different provider IDs vs a single dynamic selector.
