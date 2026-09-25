# 2026-09-24 public domain HTTPS smoke

Date: 2026-09-24
Scope: custom-domain HTTPS routing only. This does not approve public launch content, phone setup, CloudTalk, or live provider delivery.

## Result

All checked public URLs returned HTTP/2 200 from Vercel with `strict-transport-security` and no TLS/SSL handshake error:

| URL | Result | Server |
| --- | --- | --- |
| `https://thelivingroom.vet` | HTTP/2 200 | Vercel |
| `https://www.thelivingroom.vet` | HTTP/2 200 | Vercel |
| `https://thelivingroom.vet/hub` | HTTP/2 200 | Vercel |

## Commands

```sh
curl -I --max-time 20 https://thelivingroom.vet
curl -I --max-time 20 https://www.thelivingroom.vet
curl -I --max-time 20 https://thelivingroom.vet/hub
```

## Remaining launch blocker at smoke time

At the time this HTTPS smoke was captured, `npm run readiness:summary` reported 4/5 gates passing and blocked only on owner public-contact content in `src/config/practice.ts`: phone, email, and emergency phone/instructions were intentionally unset.

Later same-day readiness work added a clinical/staff acceptance gate and two local hosted-readiness migrations. Use [2026-09-24 commercial readiness summary](2026-09-24-commercial-readiness-summary.json) for the current aggregate gate count.
