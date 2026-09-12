-- Separate audited ledgers preserve legacy vaccination records without silently importing balances.
create table public.catalog_products (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 200),
 kind text not null check(kind in ('medication','vaccine','service')), manufacturer text not null default '' check(length(manufacturer)<=200),
 unit text not null check(length(trim(unit)) between 1 and 50), unit_price_cents bigint not null check(unit_price_cents between 0 and 100000000),
 active boolean not null default true, version integer not null default 1, created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.inventory_lots (
 id uuid primary key, product_id uuid not null references public.catalog_products(id) on delete restrict,
 lot_number text not null check(length(trim(lot_number)) between 1 and 200), expires_on date not null check(isfinite(expires_on)),
 location text not null check(length(trim(location)) between 1 and 200), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(product_id,lot_number,expires_on,location)
);
create table public.inventory_movements (
 id uuid primary key, lot_id uuid not null references public.inventory_lots(id) on delete restrict,
 quantity numeric(14,3) not null check(quantity<>0 and quantity::text not in ('NaN','Infinity','-Infinity')), kind text not null check(kind in ('receive','adjust','dispense')),
 reason text not null check(length(trim(reason)) between 1 and 2000), created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index inventory_movements_lot_idx on public.inventory_movements(lot_id);
create table public.billing_invoices (
 id uuid primary key, client_id uuid not null references public.clients(id) on delete restrict,
 status text not null default 'draft' check(status in ('draft','issued','void')), currency text not null default 'usd' check(currency='usd'),
 total_cents bigint, version integer not null default 1, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), issued_at timestamptz, voided_at timestamptz, void_reason text,
 check((status='draft' and total_cents is null and issued_at is null) or (status in ('issued','void') and total_cents>=0 and issued_at is not null))
);
create table public.billing_invoice_items (
 id uuid primary key, invoice_id uuid not null references public.billing_invoices(id) on delete restrict,
 pet_id uuid references public.pets(id) on delete restrict, product_id uuid not null references public.catalog_products(id) on delete restrict,
 description text not null, quantity numeric(14,3) not null check(quantity>0 and quantity::text not in ('NaN','Infinity','-Infinity')), unit_price_cents bigint not null check(unit_price_cents>=0),
 amount_cents bigint generated always as (round(quantity*unit_price_cents)::bigint) stored,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index billing_invoice_items_invoice_idx on public.billing_invoice_items(invoice_id);
create table public.billing_credits (
 id uuid primary key, invoice_id uuid not null references public.billing_invoices(id) on delete restrict,
 amount_cents bigint not null check(amount_cents>0), reason text not null check(length(trim(reason)) between 1 and 2000),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.patient_treatments (
 id uuid primary key, pet_id uuid not null references public.pets(id) on delete restrict,
 product_id uuid references public.catalog_products(id) on delete restrict, lot_id uuid references public.inventory_lots(id) on delete restrict,
 invoice_id uuid references public.billing_invoices(id) on delete restrict,
 kind text not null check(kind in ('medication','vaccine')), historical boolean not null,
 product_name text not null check(length(trim(product_name)) between 1 and 200), manufacturer text not null check(length(manufacturer)<=200),
 lot_number text not null check(length(lot_number)<=200), expires_on date check(expires_on is null or isfinite(expires_on)), quantity numeric(14,3) not null check(quantity>0 and quantity::text not in ('NaN','Infinity','-Infinity')),
 dose text not null check(length(trim(dose)) between 1 and 200), route text not null check(length(trim(route)) between 1 and 100), site text not null check(length(site)<=200),
 veterinarian text not null check(length(trim(veterinarian)) between 1 and 200), veterinarian_license text not null check(length(veterinarian_license)<=100),
 administered_at timestamptz not null check(isfinite(administered_at)), next_due_on date check(next_due_on is null or isfinite(next_due_on)), source text not null check(length(source)<=500),
 request jsonb not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 check(next_due_on is null or next_due_on >= (administered_at at time zone 'America/Denver')::date),
 check(historical or (lot_id is not null and invoice_id is not null and product_id is not null))
);
create index patient_treatments_pet_idx on public.patient_treatments(pet_id,administered_at desc);
create table public.patient_treatment_corrections (
 id uuid primary key, treatment_id uuid not null references public.patient_treatments(id) on delete restrict,
 reason text not null check(length(trim(reason)) between 1 and 2000), replacement_id uuid references public.patient_treatments(id) on delete restrict,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(treatment_id)
);
create function public.inventory_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();
begin
 if TG_OP='DELETE' then raise exception 'Inventory and billing history cannot be deleted' using errcode='23514'; end if;
 if TG_OP='UPDATE' then
  if TG_TABLE_NAME not in ('catalog_products','billing_invoices') then raise exception 'Ledger records are append-only' using errcode='23514'; end if;
  NEW.created_by:=OLD.created_by; NEW.created_at:=OLD.created_at; NEW.version:=OLD.version+1;
  if TG_TABLE_NAME='catalog_products' then
   if (NEW.kind,NEW.unit) is distinct from (OLD.kind,OLD.unit) then raise exception 'Product kind and stock unit are immutable' using errcode='23514'; end if;
  end if;
  if TG_TABLE_NAME='billing_invoices' then
   if NEW.client_id<>OLD.client_id or not ((OLD.status='draft' and NEW.status in ('draft','issued')) or (OLD.status='issued' and NEW.status='void')) then raise exception 'Invalid invoice transition' using errcode='23514'; end if;
   if OLD.status='issued' then NEW.total_cents:=OLD.total_cents; NEW.issued_at:=OLD.issued_at; end if;
  end if;
 else NEW.created_by:=actor; NEW.created_at:=now();
 end if;
 return NEW;
end $$;
do $$ declare t text; begin
 foreach t in array array['catalog_products','inventory_lots','inventory_movements','billing_invoices','billing_invoice_items','billing_credits','patient_treatments','patient_treatment_corrections'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
  execute format('create policy "Active staff read" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
  execute format('create trigger inventory_guard before insert or update or delete on public.%I for each row execute function public.inventory_guard()',t);
  execute format('create trigger inventory_audit after insert or update on public.%I for each row execute function public.audit_trigger_fn()',t);
 end loop;
end $$;
create function public.save_catalog_product(p_id uuid,p_expected_version integer,p_name text,p_kind text,p_manufacturer text,p_unit text,p_unit_price_cents bigint,p_active boolean) returns public.catalog_products language plpgsql security definer set search_path=public as $$
declare result public.catalog_products; actor uuid:=public.clinical_require_staff();
begin
 if p_id is null then insert into public.catalog_products(name,kind,manufacturer,unit,unit_price_cents,active,created_by) values(trim(p_name),p_kind,coalesce(p_manufacturer,''),p_unit,p_unit_price_cents,p_active,actor) returning * into result;
 else update public.catalog_products set name=trim(p_name),kind=p_kind,manufacturer=coalesce(p_manufacturer,''),unit=p_unit,unit_price_cents=p_unit_price_cents,active=p_active where id=p_id and version=p_expected_version returning * into result;
 if not found then raise exception 'Product changed; reload before saving' using errcode='40001'; end if; end if;
 return result;
end $$;
create function public.receive_inventory(p_id uuid,p_lot_id uuid,p_product_id uuid,p_lot_number text,p_expires_on date,p_location text,p_quantity numeric,p_reason text) returns public.inventory_movements language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.inventory_movements; lot public.inventory_lots;
begin
 if p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity<=0 or p_quantity<>round(p_quantity,3) then raise exception 'Receipt quantity must be positive with at most 3 decimals' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from public.inventory_movements where id=p_id;
 if found then
  select * into lot from public.inventory_lots where id=result.lot_id;
  if result.created_by<>actor or row(result.kind,result.lot_id,result.quantity,result.reason,lot.product_id,lot.lot_number,lot.expires_on,lot.location) is distinct from row('receive'::text,p_lot_id,p_quantity,p_reason,p_product_id,p_lot_number,p_expires_on,p_location) then raise exception 'Receipt identifier already used' using errcode='23514'; end if;
  return result;
 end if;
 perform 1 from public.catalog_products where id=p_product_id and kind<>'service' and active for share;
 if not found then raise exception 'Receipt requires active stock product' using errcode='23514'; end if;
 insert into public.inventory_lots(id,product_id,lot_number,expires_on,location,created_by) values(p_lot_id,p_product_id,p_lot_number,p_expires_on,p_location,actor) on conflict(id) do nothing;
 select * into lot from public.inventory_lots where id=p_lot_id for update;
 if row(lot.product_id,lot.lot_number,lot.expires_on,lot.location) is distinct from row(p_product_id,p_lot_number,p_expires_on,p_location) then raise exception 'Lot identifier already used with different metadata' using errcode='23514'; end if;
 insert into public.inventory_movements(id,lot_id,quantity,kind,reason,created_by) values(p_id,p_lot_id,p_quantity,'receive',p_reason,actor) returning * into result;
 return result;
end $$;
create function public.adjust_inventory(p_id uuid,p_lot_id uuid,p_quantity numeric,p_reason text) returns public.inventory_movements language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.inventory_movements;
begin
 if p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity=0 or p_quantity<>round(p_quantity,3) then raise exception 'Adjustment must be nonzero with at most 3 decimals' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from public.inventory_movements where id=p_id;
 if found then
  if result.created_by<>actor or row(result.lot_id,result.quantity,result.reason,result.kind) is distinct from row(p_lot_id,p_quantity,p_reason,'adjust'::text) then raise exception 'Adjustment identifier already used' using errcode='23514'; end if; return result;
 end if;
 perform 1 from public.inventory_lots where id=p_lot_id for update;
 if not found then raise exception 'Lot not found' using errcode='23514'; end if;
 if (select coalesce(sum(quantity),0) from public.inventory_movements where lot_id=p_lot_id)+p_quantity<0 then raise exception 'Insufficient stock' using errcode='23514'; end if;
 insert into public.inventory_movements(id,lot_id,quantity,kind,reason,created_by) values(p_id,p_lot_id,p_quantity,'adjust',p_reason,actor) returning * into result; return result;
end $$;
create function public.create_billing_invoice(p_id uuid,p_client_id uuid) returns public.billing_invoices language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.billing_invoices;
begin
 insert into public.billing_invoices(id,client_id,created_by) values(p_id,p_client_id,actor) on conflict(id) do nothing;
 select * into result from public.billing_invoices where id=p_id;
 if result.client_id<>p_client_id or result.created_by<>actor then raise exception 'Invoice identifier already used' using errcode='23514'; end if; return result;
end $$;
-- Request JSON is an immutable retry fingerprint; unknown keys are rejected.
create function public.record_patient_treatment(p_id uuid,p_request jsonb) returns public.patient_treatments language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.patient_treatments; lot public.inventory_lots; product public.catalog_products; inv public.billing_invoices; historical boolean; pet uuid; qty numeric; admin_at timestamptz;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or exists(select 1 from jsonb_object_keys(p_request) k where k not in ('pet_id','lot_id','invoice_id','quantity','dose','route','site','veterinarian','veterinarian_license','administered_at','next_due_on','historical','product_name','manufacturer','lot_number','expires_on','source','kind')) then raise exception 'Invalid treatment request fields' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from public.patient_treatments where id=p_id;
 if found then if result.created_by<>actor or result.request<>p_request then raise exception 'Treatment identifier already used' using errcode='23514'; end if; return result; end if;
 historical:=coalesce((p_request->>'historical')::boolean,false); pet:=(p_request->>'pet_id')::uuid; qty:=(p_request->>'quantity')::numeric; admin_at:=(p_request->>'administered_at')::timestamptz;
 if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty<>round(qty,3) or admin_at is null or not isfinite(admin_at) or admin_at>now()+interval '5 minutes' then raise exception 'Invalid quantity or administration time' using errcode='23514'; end if;
 if historical then
  if p_request->>'lot_id' is not null or p_request->>'invoice_id' is not null or length(trim(coalesce(p_request->>'source','')))=0 then raise exception 'Historical records require source and cannot bill or debit stock' using errcode='23514'; end if;
  insert into public.patient_treatments(id,pet_id,kind,historical,product_name,manufacturer,lot_number,expires_on,quantity,dose,route,site,veterinarian,veterinarian_license,administered_at,next_due_on,source,request,created_by)
  values(p_id,pet,coalesce(p_request->>'kind','vaccine'),true,p_request->>'product_name',coalesce(p_request->>'manufacturer',''),coalesce(p_request->>'lot_number',''),(p_request->>'expires_on')::date,qty,p_request->>'dose',p_request->>'route',coalesce(p_request->>'site',''),p_request->>'veterinarian',coalesce(p_request->>'veterinarian_license',''),admin_at,(p_request->>'next_due_on')::date,p_request->>'source',p_request,actor) returning * into result;
 else
  select * into inv from public.billing_invoices where id=(p_request->>'invoice_id')::uuid for update;
  if not found or inv.status<>'draft' then raise exception 'A draft invoice is required' using errcode='23514'; end if;
  perform 1 from public.pets where id=pet and client_id=inv.client_id and archived_at is null and deceased_at is null for share;
  if not found then raise exception 'Invoice patient mismatch or inactive patient' using errcode='23514'; end if;
  select * into lot from public.inventory_lots where id=(p_request->>'lot_id')::uuid for update;
  if not found then raise exception 'Lot not found' using errcode='23514'; end if;
  select * into product from public.catalog_products where id=lot.product_id for share;
  if not product.active then raise exception 'Product is inactive' using errcode='23514'; end if;
  if lot.expires_on<(now() at time zone 'America/Denver')::date or lot.expires_on<(admin_at at time zone 'America/Denver')::date then raise exception 'Expired stock cannot be administered or dispensed' using errcode='23514'; end if;
  if (select coalesce(sum(quantity),0) from public.inventory_movements where lot_id=lot.id)<qty then raise exception 'Insufficient stock' using errcode='23514'; end if;
  insert into public.patient_treatments(id,pet_id,product_id,lot_id,invoice_id,kind,historical,product_name,manufacturer,lot_number,expires_on,quantity,dose,route,site,veterinarian,veterinarian_license,administered_at,next_due_on,source,request,created_by)
  values(p_id,pet,product.id,lot.id,inv.id,product.kind,false,product.name,product.manufacturer,lot.lot_number,lot.expires_on,qty,p_request->>'dose',p_request->>'route',coalesce(p_request->>'site',''),p_request->>'veterinarian',coalesce(p_request->>'veterinarian_license',''),admin_at,(p_request->>'next_due_on')::date,coalesce(p_request->>'source','Practice administration'),p_request,actor) returning * into result;
  insert into public.inventory_movements(id,lot_id,quantity,kind,reason,created_by) values(p_id,lot.id,-qty,'dispense','Patient treatment '||p_id::text,actor);
  insert into public.billing_invoice_items(id,invoice_id,pet_id,product_id,description,quantity,unit_price_cents,created_by) values(p_id,inv.id,pet,product.id,product.name,qty,product.unit_price_cents,actor);
  update public.billing_invoices set version=version+1 where id=inv.id;
 end if;
 return result;
end $$;
create function public.add_invoice_service(p_id uuid,p_invoice_id uuid,p_pet_id uuid,p_product_id uuid,p_quantity numeric) returns public.billing_invoice_items language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.billing_invoice_items; product public.catalog_products; inv public.billing_invoices;
begin
 if p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity<=0 or p_quantity<>round(p_quantity,3) then raise exception 'Invalid service quantity' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from public.billing_invoice_items where id=p_id;
 if found then if result.created_by<>actor or row(result.invoice_id,result.pet_id,result.product_id,result.quantity) is distinct from row(p_invoice_id,p_pet_id,p_product_id,p_quantity) then raise exception 'Line identifier already used' using errcode='23514'; end if; return result; end if;
 select * into inv from public.billing_invoices where id=p_invoice_id for update;
 if not found or inv.status<>'draft' then raise exception 'A draft invoice is required' using errcode='23514'; end if;
 if p_pet_id is not null and not exists(select 1 from public.pets where id=p_pet_id and client_id=inv.client_id) then raise exception 'Invoice patient mismatch' using errcode='23514'; end if;
 select * into product from public.catalog_products where id=p_product_id and kind='service' and active for share;
 if not found then raise exception 'Active service product required' using errcode='23514'; end if;
 insert into public.billing_invoice_items(id,invoice_id,pet_id,product_id,description,quantity,unit_price_cents,created_by) values(p_id,p_invoice_id,p_pet_id,product.id,product.name,p_quantity,product.unit_price_cents,actor) returning * into result;
 update public.billing_invoices set version=version+1 where id=p_invoice_id;
 return result;
end $$;
create function public.issue_billing_invoice(p_id uuid,p_expected_version integer) returns public.billing_invoices language plpgsql security definer set search_path=public as $$
declare result public.billing_invoices;
begin
 perform public.clinical_require_staff();
 select * into result from public.billing_invoices where id=p_id for update;
 if not found or result.version<>p_expected_version or result.status<>'draft' then raise exception 'Invoice changed; reload before issuing' using errcode='40001'; end if;
 if not exists(select 1 from public.billing_invoice_items where invoice_id=p_id) then raise exception 'Invoice requires at least one item' using errcode='23514'; end if;
 update public.billing_invoices set status='issued',issued_at=now(),total_cents=(select sum(amount_cents) from public.billing_invoice_items where invoice_id=p_id) where id=p_id returning * into result;
 return result;
end $$;
create function public.void_billing_invoice(p_id uuid,p_expected_version integer,p_reason text) returns public.billing_invoices language plpgsql security definer set search_path=public as $$
declare result public.billing_invoices;
begin
 perform public.clinical_require_staff();
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Void reason is required' using errcode='23514'; end if;
 select * into result from public.billing_invoices where id=p_id for update;
 if not found or result.version<>p_expected_version or result.status<>'issued' then raise exception 'Invoice changed; reload before voiding' using errcode='40001'; end if;
 if exists(select 1 from public.billing_credits where invoice_id=p_id) then raise exception 'Credited invoices cannot be voided; credit the remaining balance' using errcode='23514'; end if;
 update public.billing_invoices set status='void',voided_at=now(),void_reason=trim(p_reason) where id=p_id returning * into result; return result;
end $$;
create function public.credit_billing_invoice(p_id uuid,p_invoice_id uuid,p_amount_cents bigint,p_reason text) returns public.billing_credits language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.billing_credits; inv public.billing_invoices;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from public.billing_credits where id=p_id;
 if found then if result.created_by<>actor or row(result.invoice_id,result.amount_cents,result.reason) is distinct from row(p_invoice_id,p_amount_cents,p_reason) then raise exception 'Credit identifier already used' using errcode='23514'; end if; return result; end if;
 select * into inv from public.billing_invoices where id=p_invoice_id for update;
 if not found or inv.status<>'issued' then raise exception 'Credit requires issued invoice' using errcode='23514'; end if;
 if (select coalesce(sum(amount_cents),0) from public.billing_credits where invoice_id=p_invoice_id)+p_amount_cents>inv.total_cents then raise exception 'Credit exceeds invoice balance' using errcode='23514'; end if;
 insert into public.billing_credits(id,invoice_id,amount_cents,reason,created_by) values(p_id,p_invoice_id,p_amount_cents,p_reason,actor) returning * into result; return result;
end $$;
create function public.correct_patient_treatment(p_id uuid,p_treatment_id uuid,p_reason text,p_replacement_id uuid) returns public.patient_treatment_corrections language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.patient_treatment_corrections; original public.patient_treatments;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from public.patient_treatment_corrections where id=p_id;
 if found then if result.created_by<>actor or row(result.treatment_id,result.reason,result.replacement_id) is distinct from row(p_treatment_id,p_reason,p_replacement_id) then raise exception 'Correction identifier already used' using errcode='23514'; end if; return result; end if;
 select * into original from public.patient_treatments where id=p_treatment_id for update;
 if not found then raise exception 'Treatment not found' using errcode='23514'; end if;
 if p_replacement_id is not null and (p_replacement_id=p_treatment_id or not exists(select 1 from public.patient_treatments where id=p_replacement_id and pet_id=original.pet_id)) then raise exception 'Replacement must be a different record for the same patient' using errcode='23514'; end if;
 insert into public.patient_treatment_corrections(id,treatment_id,reason,replacement_id,created_by) values(p_id,p_treatment_id,p_reason,p_replacement_id,actor) returning * into result; return result;
end $$;
revoke all on function public.inventory_guard() from public,anon,authenticated,service_role;
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('save_catalog_product','receive_inventory','adjust_inventory','create_billing_invoice','record_patient_treatment','add_invoice_service','issue_billing_invoice','void_billing_invoice','credit_billing_invoice','correct_patient_treatment') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
