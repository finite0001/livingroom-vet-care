# Narcotics log — staff workflow

This is the Living Room Vet workflow. It uses the Living Room Vet backend and
staff login. GreenTree's VetConnect Hub and ezyVet integration are separate.

## Independent physical counts

1. Open **Inventory → Narcotics log** and choose an authorized medication/site.
2. Load the counts. An authorized manager can start a count with two distinct,
   eligible observers. Each observer must use their own staff login.
3. Open the count and personally inspect the stock. Enter the observation time,
   every quantity, and every container's presence. Fields start blank. Add any
   unexpected stock or label findings, then attest and record the observation.
4. Expected balances and the other person's quantities remain hidden until both
   observations are recorded. Each observer can see their own saved statement.
5. After both submissions, review the comparison and finalize the count.
   Finalizing records agreement or variance; it does not change stock.

If the stock/source/policy boundary changed, close the count as stale and repeat
it. This does not supply either person's missing observation. Cancellation needs
an explicit reason. A timer expiring in the browser never supplies a count or
changes an existing historical outcome.

Observation times use the displayed time zone. Nonexistent daylight-saving times
are refused; repeated local times require choosing the intended occurrence.
Quantities keep their exact decimal spelling, with up to three decimal places.
Clinical dose and stock quantity are distinct concepts.

## Recording stock movements and witnessing

Start the movement from its normal inventory, dispensing, return, correction,
treatment or anesthesia screen. If the medication is controlled stock, review
the actual source containers and enter the required physical facts. Preparing
the action does not post stock. Read the prepared quantities, custody changes,
observation time and original clinical action before choosing to record it.

If an independent witness is required, leave the recorder's original preparation
pending. The other staff member signs in with their own account and opens
**Independent witness** from the narcotics log. They read the exact prepared
action, confirm only what they independently witnessed, and explicitly attest.
Attesting does not post the movement. The recorder checks the witness result,
rereads the preparation and separately records the original action.

After an uncertain response, use the original operation's recovery controls.
Do not create another movement or witness attempt to replace an unconfirmed save.
The entry's recovery IDs remain until its complete saved result has been checked
and admitted. A witness attestation and a later independent record review serve
different purposes; completing one does not complete the other.

## Discrepancies and stock corrections

Open **Discrepancies and corrections** to read open investigations and recorded
correction cases. A warning identifies other-site investigations; the current
site's list never implies that the entire product has been cleared.

For an eligible new correction, read every source count in the complete offered
set. Deliberately enter the signed stock change and reason; no change is
calculated or prefilled. Review the captured confirmation wording and prepare the
correction. Preparation, independent approval, stock execution and independent
confirmation are separate actions, offered only when the backend permits them.
The proposed balance is not a physical count.

Closing an investigation is another explicit step. A variance needs the
corresponding confirmed correction and a newer, current agreeing count. Supported
stale/cancelled investigations can use a fresh agreeing count. Read that count
and confirm the available evidence before requesting resolution. The backend
checks freshness, source integrity and the complete cause set; unsupported
conditions remain held.

## Settings

An authorized administrator opens **Administrator settings**, reads the current
policy and publishes an explicit revision. New settings have no chosen clinical
roles, ages, methods or confirmation wording. A revision preserves the exact prior
policy link and does not rewrite older counts' captured policy or meaning.
Registering the medication and opening stock is a separate administrator workflow.

## Lost responses and recovery

A pending save blocks another count/settings/correction mutation for that staff
account. Use **Check original action**. Closing a pending attempt preserves an
existing save or permanently prevents the original attempt from saving later.
Neither button resends the original mutation. Keep the browser's recovery data
until the original saved or abandoned outcome has been verified.

Leaving an unsubmitted draft asks before discarding local entries. Signing out
immediately removes the previous staff member's displayed data. A new login does
not erase an unresolved operation; return using the original staff account to
check it. Do not clear browser storage as a substitute for recovery.

## Recorded movements and independent record reviews

Open **Recorded movements and reviews**. Its medication/site/kind chooser uses
register READ access independently from count permissions. The site-exceptions
view contains records whose site cannot be established and does not offer signing.

Read a record, open the review workspace, enter the decision and reason, and
explicitly prepare. Inspect the complete returned evidence, acknowledge reviewing
it, then deliberately confirm and sign. This records review of the saved record;
it does not attest that the reviewer physically witnessed the underlying action.
Recovery checks the original operation without signing again.

## Verification boundary

Synthetic UI tests exercise the actual clients, lifecycle and recovery controls,
but do not establish real Auth, database persistence, physical observations or
clinical commissioning. Backend installation, authenticated integration tests and
the hosted release require their own recorded verification.
