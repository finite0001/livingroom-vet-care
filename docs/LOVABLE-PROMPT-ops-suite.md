# Lovable prompt — ops suite backend (inventory, provider delivery, missed-shift RPC)

Paste everything between the lines into Lovable. After it applies, tell me and I'll run the post-apply checklist (bottom of this file) and build the UI on top.

---

**Goal:** Add three backend capabilities: (1) inventory management with a tamper-resistant stock ledger and controlled-substance dispense logging, (2) a provider contact directory plus a delivery log for sending records/recommendations to outside providers, and (3) an admin RPC to record a missed shift in the time clock.

Create a new Supabase migration and apply it. Requirements:

**Schema**
```sql
CREATE TABLE public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  sku text,
  unit text NOT NULL DEFAULT 'each',
  qty_on_hand numeric NOT NULL DEFAULT 0,
  reorder_threshold numeric NOT NULL DEFAULT 0,
  is_controlled boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  type text NOT NULL CHECK (type IN ('RECEIVE','DISPENSE','ADJUST')),
  quantity_delta numeric NOT NULL CHECK (quantity_delta <> 0),
  client_id uuid REFERENCES public.clients(id),
  pet_id uuid REFERENCES public.pets(id),
  staff_id uuid NOT NULL REFERENCES public.profiles(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (type = 'RECEIVE' AND quantity_delta > 0) OR
    (type = 'DISPENSE' AND quantity_delta < 0) OR
    (type = 'ADJUST')
  )
);
CREATE INDEX ON public.inventory_transactions (item_id, created_at DESC);

CREATE TABLE public.provider_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  organization text,
  email text,
  phone text,
  fax text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.document_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES public.provider_contacts(id),
  client_id uuid REFERENCES public.clients(id),
  pet_id uuid REFERENCES public.pets(id),
  channel text NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL')),
  recipient text NOT NULL,
  subject text,
  body_excerpt text,
  attachment_paths text[],
  delivered boolean NOT NULL DEFAULT false,
  status_note text,
  error_text text,
  sent_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Row Level Security** (required)
- Enable RLS on all four new tables.
- `inventory_items`: SELECT / INSERT / UPDATE for `is_active_staff(auth.uid())`; DELETE admin-only (`has_role(auth.uid(),'ADMIN')`, which already requires the profile to be active). Add a trigger that BLOCKS any change to `qty_on_hand` via direct UPDATE — stock levels may only change through the `record_inventory_transaction` RPC below (use the same session-guard pattern as `protect_profile_privileges`: the RPC sets a local flag the trigger checks).
- `inventory_transactions`: SELECT for active staff only. NO INSERT/UPDATE/DELETE policies for any client role — the ledger is written exclusively by the SECURITY DEFINER RPC and is immutable (corrections are new ADJUST rows, never edits).
- `provider_contacts`: SELECT / INSERT / UPDATE for active staff; DELETE admin-only.
- `document_deliveries`: SELECT for active staff only. No INSERT/UPDATE/DELETE policies — rows are written only by an edge function using the service role.

**Functions / RPCs**
All `SECURITY DEFINER` with `SET search_path = public, pg_temp`, inputs validated, authorization checked inside the function. Do NOT write to any GENERATED column.

1. `record_inventory_transaction(_item_id uuid, _type text, _quantity numeric, _client_id uuid DEFAULT NULL, _pet_id uuid DEFAULT NULL, _note text DEFAULT NULL) RETURNS uuid`
   - Require `is_active_staff(auth.uid())`.
   - Validate `_type IN ('RECEIVE','DISPENSE','ADJUST')`. For RECEIVE and DISPENSE require `_quantity > 0` and apply the sign inside the function (RECEIVE → `+_quantity`, DISPENSE → `-_quantity`); for ADJUST, `_quantity` is the signed delta and must be nonzero.
   - Lock the item row (`SELECT ... FOR UPDATE`), reject if the item is missing or inactive, reject a DISPENSE that would take `qty_on_hand` below 0.
   - If the item has `is_controlled = true` and `_type = 'DISPENSE'`: require `_client_id`, `_pet_id`, and a non-empty `_note` (dispense reason), else raise an exception — this is the controlled-substance log.
   - Insert the ledger row with `staff_id = auth.uid()`, update `inventory_items.qty_on_hand` (through the session-guard flag), return the transaction id.
2. `admin_create_time_entry(_staff_id uuid, _clock_in_at timestamptz, _clock_out_at timestamptz, _note text DEFAULT NULL) RETURNS uuid`
   - Require `has_role(auth.uid(),'ADMIN')`.
   - `_clock_out_at` is required and must be after `_clock_in_at`; `_clock_in_at` must not be in the future; `_staff_id` must reference an existing profile.
   - Insert directly into `time_entries` (this RPC exists because direct INSERT is blocked by design). Because the entry is closed, do not touch `profiles.is_on_duty`.

**Audit** (sensitive tables)
- Add the existing audit trigger (writing to `audit_logs`, `user_id` nullable so null-uid writes don't roll back) to: `inventory_items`, `inventory_transactions`, `document_deliveries`, `provider_contacts`.

**Do not** change unrelated tables, drop data, or loosen existing policies. Existing RLS in this project is partly applied via an `op_tables` loop — do not add these new tables to that loop; write their policies explicitly as specified above.

After applying, tell me: the migration filename, and confirm `types.ts` regenerated with `inventory_items`, `inventory_transactions`, `provider_contacts`, `document_deliveries`, `record_inventory_transaction`, and `admin_create_time_entry`.

---

## Post-apply checklist (mine, not part of the prompt)
- [ ] `git fetch && git diff origin/main` — reconcile any auto-generated overlapping UI onto shared hooks/query keys
- [ ] new identifiers present in `src/integrations/supabase/types.ts`
- [ ] `bash ~/.claude/skills/verify-lovable-build/verify.sh ~/livingroom-vet-care -- inventory_items inventory_transactions provider_contacts document_deliveries record_inventory_transaction admin_create_time_entry` → PASS
- [ ] then build: inventory UI (`/hub/tools/inventory`), provider directory + send-records flow, admin "add missed shift" dialog
