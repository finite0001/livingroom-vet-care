# Susan review — proposed appointment and daily-task defaults

Draft only. Dave requested these proposals on October13,2026. They are not published appointment templates, clinical protocols or active automation. Susan should revise the lengths, species, visit modes, resources and operating checklists before they are configured. Durations are scheduling proposals, not clinical limits; visits needing more time receive an explicit reviewed duration.

| Proposed type | Category | Proposed booking length | Initial eligibility | Resource/task proposal |
|---|---|---:|---|---|
| Established-patient wellness | Well | 30min | Dogs/cats; clinic or housecall | Exam space; turnover after actual use |
| New-patient comprehensive visit | Well | 45min | Dogs/cats; clinic or housecall | Exam space; turnover after actual use |
| Illness/problem visit | Sick | 40min | Dogs/cats; clinic or housecall | Exam space; turnover; staff flags extra cleanup if required by practice SOP |
| Vaccine/technician visit | Well | 15min | Dogs/cats; clinic; housecall only if approved | Exam/technician space; review clinician/technician staffing rule |
| Recheck/follow-up | Sick or well, selected explicitly | 20min | Dogs/cats; clinic or housecall | Exam space; turnover after actual use |
| Bloodwork/sample-collection visit | Procedure | 20min | Dogs/cats; clinic; housecall only if approved | Technician/exam space; no automatic clinical order or testing interval |
| Dental/procedure consultation | Procedure | 30min | Dogs/cats; clinic | Exam space; turnover after actual use |
| Dental treatment/anesthesia | Procedure | Case-specific; require reviewed duration | Clinic; eligible species approved per type | Procedure room; preparation and completed-use cleanup; no fixed120min assumption |
| Surgery | Procedure | Case-specific; require reviewed duration | Clinic; eligible species approved per procedure | Reviewed surgical resources; preparation and completed-use cleanup |
| Quality-of-life consultation | Sick | 45min | Dogs/cats; clinic or housecall | Quiet exam space where available; turnover after use |

Task rules must be linked to reviewed appointment-type IDs and resource IDs. A dental consultation does not trigger dental-treatment preparation, and free-text words such as “surgery” must not trigger clinical preparation automatically.

Other species need an explicitly reviewed type; the software must not silently substitute dog/cat defaults. Room names/identities remain unassigned until the actual practice resource list is reviewed. Proposed housecall travel buffers:15min before/after until staff review the route; staff should use the mapped route to adjust travel allowances before booking. The software enforces entered buffers and does not infer a guaranteed travel time.

| Proposed daily task | Trigger and due time | Proposed owner | Draft completion checklist |
|---|---|---|---|
| Exam-space turnover | After actual room use; before next use | Assigned technician/staff | Follow approved room-cleaning SOP; restore work surfaces/supplies; confirm room ready |
| Procedure preparation | 30min before scheduled procedure, subject to Susan's procedure-specific review | Assigned procedure team | Confirm required room/resources and the reviewed preparation checklist; flag missing supplies/equipment |
| Procedure-room cleanup | After procedure's actual completion; before next use | Assigned technician/staff | Follow approved procedure-room cleaning SOP; restore room/resources; report any unresolved issue |
| Daily restocking | End of each day with room use | Assigned staff | Check approved par levels; record missing items; link any actual inventory transfer separately |
| Housecall-kit check | Before departure on a housecall day | Assigned mobile team | Review the approved kit checklist; flag missing supplies; record actual stock transfers separately |

Exact cleaning methods, product contact times, infection-control steps, clinical preparation and equipment checks must come from the practice's approved SOPs. These software checklist proposals do not supply those protocols. Completing a restock checklist does not change inventory counts. Completed task history stays intact when an appointment is canceled or rescheduled; outstanding tasks are revised or marked for review rather than silently deleted.

At appointment completion, propose **Schedule next visit**, **Schedule later** and **Client declined**. Show already-booked visits and the patient's existing reviewed due-care information. Do not invent a next clinical interval or send a reminder from this prompt. Repeated saves recover the same scheduling outcome and cannot silently book another visit.

Susan review fields: appointment length/species/mode; clinician or technician eligibility; resource mapping; travel allowance; procedure timing; task role/assignee and due time; approved checklist/SOP reference; approved override rules. Record reviewer/date/version before publication.

[Implementation preparation](plan.md). [Original requirements](../2026-10-08-vet-feedback/phase-04-scheduling-tasks.md).
