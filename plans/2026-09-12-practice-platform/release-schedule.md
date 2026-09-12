# Two-release schedule

Updated after owner input on 2026-09-12: both housecalls and clinic care; home base 2619 Spruce Street; housecalls potentially late October 2026; clinic likely early 2027; Stripe preferred; external veterinary-software API required.

## Late-October housecall release

Dates are target checkpoints, not verified delivery promises. The full 15–28 engineering-week estimate cannot fit a single implementer's seven-week window. Prioritize complete small workflows, parallel workstreams and weekly staff/veterinarian acceptance. Reassess by September 25 after technical/provider discovery.

| Target window | Complete outcome |
|---|---|
| Sep 14–20 | Environment/ownership inventory, auth/reset/CI fixes, confirmed housecall services, domain/SMS onboarding, Stripe sandbox, external API access request and mapping sample, brand concepts |
| Sep 21–27 | Complete client/patient editor, addresses and clinical alerts; SOAP draft/sign prototype; controlled email/SMS reply prototype; ezyVet adapter dry-run or documented access blocker |
| Sep 28–Oct 4 | Housecall calendar/travel buffers, appointment reminders, patient files/history, external-record review, basic service/product/lot catalog |
| Oct 5–11 | Vaccine administration and due dates, certificates, stock-linked charges, invoice/Stripe checkout; selected record delivery; public housecall booking-request flow |
| Oct 12–18 | Integrated rehearsal: full visit, refunds, opt-out/bounce, duplicate webhooks, record access, patient-specific reminder overrides, external sync replay |
| Oct 19–25 | Staff pilot, backup restore, critical defect fixes, truthful website opening content, provider/account readiness review; readiness decision |
| Late October | Controlled housecall launch only when required workflows pass; monitor daily |

### Required housecall scope

- Clients, full pet fields, visit addresses/access instructions, external-history access, serious alerts and reliable SOAP.
- Calendar with travel buffers/navigation links, automatic appointment reminders and basic vaccine/lab due reminders with per-patient overrides.
- Two-way email/SMS inbox, manual assignment/templates/internal notes, authorized record/lab/certificate sharing and clear delivery failures.
- Vaccine/medication catalog with lots/expiry and stock movement for products actually carried; vaccine/rabies certificates when administering those vaccines.
- Itemized invoices, Stripe hosted checkout by email/text, payment status reconciliation and refund/manual-payment handling appropriate to launch operations.
- Simple QOL/consent forms if end-of-life work is offered. Any dental/anesthesia service requires its appropriate charting/recording path before use.
- External veterinary API capability starts now. Core client/patient mapping and safe source-history access must be validated for any patient imported through it. If API entitlement is delayed, reviewed manual record import is an interim operational workaround, not completion of the requested API feature.
- Mobile usability and explicit save status; agreed downtime/no-network procedure.

### Later enhancement scope, retained in the roadmap

Full dental chart, automatic anesthesia adapter, advanced QOL trends, longitudinal graphical mass mapping, direct lab integrations, richer external PIMS synchronization, route optimization, voice/voicemail, clinic card-present payments and full client portal. Promote a feature into October if the offered service requires it; adjust schedule/resources accordingly.

## November–December and early-2027 clinic release

Use pilot findings to improve reliability first, then finish dental/anesthesia/QOL/body maps, lab and external PIMS integrations. Add rooms/equipment/staff scheduling and clinic/mobile inventory transfers. Finalize signage, real clinic photos, hours and client arrival instructions. Set the exact clinic date when construction and service readiness are known.

## Go/no-go conditions

No critical data-loss/access-control defect; staff can restore records; provider failures are visible; no duplicate charges/messages/stock events; required certificates/charts accepted by veterinarian; housecall contact and emergency referral information verified; vendor access and credentials owned by the practice. If these fail, reduce offered scope or move the software launch. Do not treat an attractive UI or an API table as proof of readiness.

## Cost and dependency register

Owner to confirm domain, practice number, estimated monthly SMS/email volume and staff count. Technical owner to price Supabase production/staging/backup/storage, Vercel plan, Resend, Twilio number/messages/registration, Stripe processing, maps if used, and vendor API access. Do not forecast fees from guessed usage. Reserve design effort for a production logo and clinician time for template/chart review.
