# Staff session integration — 2026-10-24

The application Auth provider now supplies a dedicated review-session source. It
extracts actor, session and expiry from the SDK token, binds the actor to the SDK
user, and enables the source only after the matching current staff profile/role
query succeeds. JWT decoding does not verify a signature or grant permission;
the backend still authenticates and authorizes every sensitive operation.

Identity snapshots contain only actor/session/generation. Tokens remain private to
the explicit RPC session source. There is no new token/clinical-packet persistence,
automatic review request, production review route, backend grant or roster seed.

Token/session changes and explicit access revalidation immediately clear review
visibility. An identical unexpired SDK focus event preserves the identity; denied
access stays denied and advances generation. Expiry is checked on every source read
and by a timer. A clock failure fails closed; observer errors cannot prevent other
consumers from receiving invalidation.

Logout intent suspends the bridge before SDK work. A current successful explicit
sign-in must match the latest SDK token/user before resuming. Login/logout/unmount
intent revisions prevent older asynchronous results from changing newer state.
While password calls overlap, SDK notifications cannot silently switch the review
actor: a late notification from an older login suspends review access, and that
stale result cannot resume it. Staff must sign in again in that uncertain case.
Asynchronous profile queries remain outside SDK Auth callbacks, preserving the
existing [Supabase callback-lock workaround](https://supabase.com/docs/guides/troubleshooting/why-is-my-supabase-api-call-not-returning-PGzXw0).

Validation: all 1,856 tests, three TypeScript configurations and build pass. Four
existing lint warnings remain. Ten broker tests and seven additional provider race
controls cover stale login/logout/unmount, old SDK notification after a newer login,
token mismatch, duplicate notifications, denied access and expiry. The provider
controls transpile the actual provider and use the actual broker/request modules
with inert SDK/React stubs; they are not genuine Supabase Auth or DOM acceptance.

Independent source gate: four-file freeze
`871749fe3b66511086ba11c76a7792313e75d5901e111706ec04d39ddf6f10cb`;
report SHA256 `e1e15e3f95432b521e785e62eb5a0533484fb2ae2b168c61b156331ef8a7d4df`.
The provider regression controls are included in the ordinary repository suite.
The installed Auth SDK source confirms that its SIGNED_IN callbacks complete
before its password-sign-in result is returned.

This completes the source bridge and its regression checks. A real SDK/browser
workflow, complete backend event coverage, populated restore and commissioned
clinic activation remain separate stages in the
[completion plan](../../plans/20261024-controlled-completion/plan.md).
