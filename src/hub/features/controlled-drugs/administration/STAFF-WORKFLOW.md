# Narcotics log setup

This document describes the source implementation. The backend and authenticated workflow must pass release verification before this is a live clinic workflow.

Open **Inventory → Narcotics log → Administrator setup** using a current administrator account. Load the actual administrator records. Every medication, site, location, custodian and staff member comes from those records.

1. Register the real site and its locations. A mobile kit needs an explicit initial custodian.
2. Establish opening stock for an eligible medication and its reviewed catalog draft. Select every policy setting, including permitted actions, roles, locations, witness requirements and independent review. Enter each actual physical observation and its time; none is filled from the recorded balance. If an observation differs from the legacy record, correct that record through its supported workflow and read a fresh opening preview. Review and save the complete opening to activate its controlled-stock log.
3. Revise an existing stock policy when permissions change. This preserves its opening and requires a new review reference and reason.
4. Configure review administrators, then explicit staff read/review access for the relevant medication, site and movement kind. Exception access is configured across sites for the medication.
5. Publish the staffed review calendar and escalation recipients. Every calendar date requires a staffing decision. Verify its backend time-zone projection; resolve missing or repeated closing times explicitly.
6. Publish the independent record-review policy using the actual published calendar and routing records. Its action-specific timing and escalation are shown before preparation.

Every change follows **prepare → review → continue → save**. Preparation alone changes no stock policy or registration. Read every location, staff permission, quantity, time and reference in the prepared change before confirming it.

If a connection fails, use **Read original result**. A saved receipt is the answer even when the initial response was lost. **Close original attempt** permanently closes an unsaved attempt; it does not undo an already saved change. Never clear browser storage or submit a different operation to bypass recovery. Your operation history also allows recovering work from a different browser.

An expired preparation or changed source must be closed and prepared again from current records. Unsaved forms prompt before navigation. An account or login-session change requires reopening the workflow under the current identity.

Physical witnessing and independent record review have different purposes. A required physical witness must be a different eligible person using their own authenticated workflow; an after-the-fact record review cannot replace that attestation. Backend and browser verification of that workflow remains a release gate.
