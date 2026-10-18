# Public pricing verification — 2026-10-18 UTC

This is documentation research, not a paid-run approval. No authenticated API, token-count endpoint, server key or account setting was accessed.

OpenAI documents `gpt-6-luna`, a 1.05M-token context window and a 128K output maximum. Our frozen request keeps its smaller **8,000 generated-token ceiling**. Public documentation does not prove this particular account's current access or resolve the alias to an immutable snapshot. [Model reference](https://developers.openai.com/api/docs/models/gpt-6-luna).

The current published rates below are USD per million tokens. For admission, use the highest relevant input category rather than assuming a cache discount. Short context is at most 272K input tokens; long context is above that threshold. Applicable regional/FedRAMP processing has a published 10% uplift. [Official pricing](https://developers.openai.com/api/docs/pricing).

| Tier / context | Ordinary input | Cache write | Output |
| --- | ---: | ---: | ---: |
| Standard / short | 0.10 | 0.125 | 0.50 |
| Standard / long | 0.20 | 0.25 | 0.75 |
| Fast / short | 0.20 | 0.25 | 1.00 |
| Fast / long | 0.40 | 0.50 | 1.50 |

The frozen ten requests total **136,742 UTF8 body bytes** and allow at most **80,000 generated tokens**. Byte length is not a token count. At Standard/short output pricing, that generated-token component alone is at most **$0.04**; this is not the total request budget. The frozen bodies include `prompt_cache_options:{mode:"explicit"}` and do not pin `service_tier`. Do not silently alter them to force a tier or assume the project uses Standard.

OpenAI's token-count documentation includes request-formatting overhead and explains why local character estimates miss schemas/model-specific structure. No counting request has been made; any needed counting calls must appear explicitly in the future authorization and request inventory. [Token counting](https://developers.openai.com/api/docs/guides/token-counting).

OpenAI's spending-controller example requires verified rates, reserves worst-case charges and treats missing usage as uncertain. Its sample prices are fictional and its budget excludes other charges; do not copy them. Our alias-preserving fixed suite also cannot inherit its fixed-model assumption unchanged. [Spending-controller example](https://developers.openai.com/cookbook/articles/per_run_spending_controller_responses_api).

## Conservative reservation without a counting request

The context window is the maximum tokens in one request, including input/output/reasoning. Reserving the **entire 1,050,000-token context as input**, then adding the separate 8,000-token output ceiling, deliberately over-reserves schema/formatting overhead instead of estimating input tokens from body bytes. [Context definition](https://developers.openai.com/api/docs/guides/conversation-state). The output ceiling includes reasoning and invisible formatting. [Reasoning costs](https://developers.openai.com/api/docs/guides/reasoning).

An unspecified tier can inherit a Fast project default. [Fast defaults](https://developers.openai.com/api/docs/guides/fast-mode). The frozen explicit-cache request has no breakpoints, so the documented behavior is no cache hits or writes; cache writes otherwise replace ordinary-input accounting. [Cache accounting](https://developers.openai.com/api/docs/guides/prompt-caching). Nevertheless reserve every input token at the greatest published Luna input/cache-write rate, include the 10% uplift and take the greatest output rate:

```text
Per case: (1,050,000 × $0.55 + 8,000 × $1.65) / 1,000,000 = $0.5907
Margin per case: $0.0093
Permanent reservation: $0.60 × 10 cases = $6.00
```

This covers the published Standard/Fast short/long token categories conservatively, without cache discounts, retries, extra tools or counting requests. It assumes the documented alias/context and PAYG pricing remain applicable. Account access/contract rates, taxes, shared-account usage and temporary Supabase usage are **not verified or included**. The [transport design](provider-run-design.md) distinguishes this calculated admission reservation from a guaranteed provider bill cap. A request with missing/uncertain billing evidence never refunds its reservation. Call processing remains off.
