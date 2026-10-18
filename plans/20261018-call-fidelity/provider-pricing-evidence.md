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

Remaining before a concrete dollar authorization: reviewed account/tier applicability, conservative supported input bounds including schema/formatting, all applicable charge categories and margin, exact per-case reservations, ceiling D and the protected temporary transport implementation. The [transport design](provider-run-design.md) distinguishes a calculated application admission budget from a guaranteed final bill. Call processing remains off.
