-- Anesthesia/sedation drugs administered from a stock lot during a draft anesthesia record.
-- record_patient_treatment remains the only path that debits stock, adds the invoice line and stores the alert review;
-- this module validates the anesthesia context and links that treatment row to the record in the same transaction.
-- Controlled-substance (DEA) logs, dose calculation/advice and monitor/device import are out of scope.
-- Signed records are locked: later drugs are recorded in Treatments and explained with an anesthesia addendum.
create table public.anesthesia_drug_administrations (
 id uuid primary key references public.patient_treatments(id) on delete restrict,
 record_id uuid not null references public.patient_anesthesia_records(id) on delete restrict,
 pet_id uuid not null references public.pets(id) on delete restrict,
 request jsonb not null check(jsonb_typeof(request)='object'),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create index anesthesia_drug_administrations_record_idx on public.anesthesia_drug_administrations(record_id,created_at,id);
create function public.anesthesia_drug_administration_guard() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Anesthesia drug entries are append-only; correct the linked treatment record instead' using errcode='23514';end $$;
create trigger anesthesia_drug_administration_guard before update or delete on public.anesthesia_drug_administrations for each row execute function public.anesthesia_drug_administration_guard();
create trigger anesthesia_drug_administration_truncate_guard before truncate on public.anesthesia_drug_administrations for each statement execute function public.anesthesia_drug_administration_guard();
-- Draft edits may not move the procedure window away from drugs already charged against it.
create function public.anesthesia_drug_window_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (new.started_at,new.ended_at) is distinct from (old.started_at,old.ended_at) and exists(select 1 from public.anesthesia_drug_administrations a join public.patient_treatments t on t.id=a.id where a.record_id=new.id and (t.administered_at<new.started_at or t.administered_at>coalesce(new.ended_at,'infinity'::timestamptz))) then raise exception 'Recorded anesthesia drugs must stay within the procedure times' using errcode='23514';end if;
 return new;
end $$;
create trigger anesthesia_drug_window_guard before update on public.patient_anesthesia_records for each row execute function public.anesthesia_drug_window_guard();
create function public.record_anesthesia_drug_administration(p_id uuid,p_record_id uuid,p_pet_id uuid,p_request jsonb) returns public.patient_treatments language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();rec public.patient_anesthesia_records;link public.anesthesia_drug_administrations;treatment_request jsonb;product_kind text;admin_at timestamptz;result public.patient_treatments;
begin
 if p_id is null or p_record_id is null or p_pet_id is null or p_request is null or jsonb_typeof(p_request)<>'object' or exists(select 1 from jsonb_object_keys(p_request) k where k not in ('lot_id','invoice_id','quantity','dose','route','site','veterinarian','veterinarian_license','administered_at','alert_review')) then raise exception 'Invalid anesthesia drug fields' using errcode='23514';end if;
 if jsonb_typeof(p_request->'lot_id') is distinct from 'string' or jsonb_typeof(p_request->'invoice_id') is distinct from 'string' then raise exception 'Anesthesia drugs require a stock lot and the household draft invoice' using errcode='23514';end if;
 -- Server-owned patient and source keep the treatment fingerprint deterministic for retries.
 treatment_request:=p_request||jsonb_build_object('pet_id',p_pet_id,'source','Anesthesia record '||p_record_id::text);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,14));
 perform public.clinical_require_staff();
 select * into link from public.anesthesia_drug_administrations where id=p_id;
 if found then
  if link.created_by<>actor or link.record_id<>p_record_id or link.pet_id<>p_pet_id or link.request<>treatment_request then raise exception 'Anesthesia drug identifier already used' using errcode='23514';end if;
  select * into strict result from public.patient_treatments where id=p_id;return result;
 end if;
 if exists(select 1 from public.patient_treatments where id=p_id) then raise exception 'Treatment identifier already used' using errcode='23514';end if;
 -- SHARE blocks a concurrent save/sign until this entry commits; signing then includes it.
 select * into rec from public.patient_anesthesia_records where id=p_record_id for share;
 if not found then raise exception 'Anesthesia record not found' using errcode='23514';end if;
 if rec.pet_id<>p_pet_id then raise exception 'Anesthesia record belongs to another patient' using errcode='42501';end if;
 if rec.status<>'draft' then raise exception 'Signed anesthesia records are locked; record later drugs in Treatments and append an anesthesia addendum' using errcode='23514';end if;
 admin_at:=(p_request->>'administered_at')::timestamptz;
 if admin_at is null or not isfinite(admin_at) or admin_at<rec.started_at or admin_at>coalesce(rec.ended_at,now()+interval '5 minutes') then raise exception 'Drug administration time must fall within the recorded procedure' using errcode='23514';end if;
 -- Lot product and product kind are immutable, so this unlocked read cannot change before the treatment locks.
 select p.kind into product_kind from public.inventory_lots l join public.catalog_products p on p.id=l.product_id where l.id=(p_request->>'lot_id')::uuid;
 if not found then raise exception 'Lot not found' using errcode='23514';end if;
 if product_kind<>'medication' then raise exception 'Anesthesia drug entries require a medication stock lot' using errcode='23514';end if;
 result:=public.record_patient_treatment(p_id,treatment_request);
 insert into public.anesthesia_drug_administrations(id,record_id,pet_id,request,created_by) values(p_id,p_record_id,p_pet_id,treatment_request,actor);
 return result;
end $$;
alter table public.anesthesia_drug_administrations enable row level security;
revoke all on table public.anesthesia_drug_administrations from public,anon,authenticated,service_role;
grant select on table public.anesthesia_drug_administrations to authenticated;
create policy "Active staff read anesthesia drug entries" on public.anesthesia_drug_administrations for select to authenticated using(public.is_active_staff(auth.uid()));
revoke all on function public.anesthesia_drug_administration_guard(),public.anesthesia_drug_window_guard() from public,anon,authenticated,service_role;
revoke all on function public.record_anesthesia_drug_administration(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_anesthesia_drug_administration(uuid,uuid,uuid,jsonb) to authenticated;
