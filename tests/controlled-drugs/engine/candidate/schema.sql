-- LOCAL WIP ONLY. Not a canonical migration, activation route or policy seed.
create table public.controlled_stock_engine_manifests(
 revision integer primary key check(revision>0),definition jsonb not null,
 definition_hash text not null check(definition_hash~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null default clock_timestamp()
);
create table public.controlled_stock_sites(
 id uuid primary key,label text not null check(length(label)between 1 and 200),
 registration_evidence jsonb not null check(jsonb_typeof(registration_evidence)='object'),
 actor_id uuid not null references public.profiles(id)on delete restrict,
 session_id uuid not null,recorded_at timestamptz not null default clock_timestamp()
);
create table public.controlled_stock_locations(
 id uuid primary key,site_id uuid not null references public.controlled_stock_sites(id)on delete restrict,
 kind text not null check(kind in('clinic','mobile_kit')),label text not null check(length(label)between 1 and 200),
 initial_custodian_id uuid references public.profiles(id)on delete restrict,
 actor_id uuid not null references public.profiles(id)on delete restrict,
 session_id uuid not null,recorded_at timestamptz not null default clock_timestamp(),unique(id,site_id)
);
create table public.controlled_stock_policy_versions(
 id uuid primary key,product_id uuid not null references public.catalog_products(id)on delete restrict,
 version integer not null check(version>0),
 draft_version_id uuid not null references public.controlled_draft_versions(id)on delete restrict,
 engine_revision integer not null references public.controlled_stock_engine_manifests(revision)on delete restrict,
 stock_unit text not null check(length(stock_unit)between 1 and 50),
 identity_snapshot jsonb not null check(jsonb_typeof(identity_snapshot)='object'),
 permissions jsonb not null check(jsonb_typeof(permissions)='object'),
 clinic_retained_return_permitted boolean not null,
 review_reference text not null check(length(review_reference)between 1 and 2000),
 actor_id uuid not null references public.profiles(id)on delete restrict,
 session_id uuid not null,recorded_at timestamptz not null default clock_timestamp(),
 unique(product_id,version),unique(id,product_id)
);
create table public.controlled_stock_policy_sites(
 policy_version_id uuid not null references public.controlled_stock_policy_versions(id)on delete restrict,
 site_id uuid not null references public.controlled_stock_sites(id)on delete restrict,
 primary key(policy_version_id,site_id)
);
create table public.controlled_stock_openings(
 id uuid primary key,product_id uuid not null unique references public.catalog_products(id)on delete restrict,
 policy_version_id uuid not null,observed_at timestamptz not null check(isfinite(observed_at)),
 count_evidence jsonb not null check(jsonb_typeof(count_evidence)='object'),
 native_custody_boundary jsonb not null check(jsonb_typeof(native_custody_boundary)='array'),
 actor_id uuid not null references public.profiles(id)on delete restrict,
 session_id uuid not null,recorded_at timestamptz not null default clock_timestamp(),
 foreign key(policy_version_id,product_id)references public.controlled_stock_policy_versions(id,product_id)on delete restrict,
 unique(id,product_id)
);
create table public.controlled_stock_opening_movements(
 opening_id uuid not null references public.controlled_stock_openings(id)on delete restrict,
 movement_id uuid not null unique references public.inventory_movements(id)on delete restrict,
 lot_id uuid not null references public.inventory_lots(id)on delete restrict,
 quantity numeric(14,3)not null check(quantity<>0),source_snapshot jsonb not null,
 primary key(opening_id,movement_id)
);
create table public.controlled_stock_state_events(
 id uuid primary key,product_id uuid not null references public.catalog_products(id)on delete restrict,
 version integer not null check(version>0),prior_event_id uuid unique references public.controlled_stock_state_events(id)on delete restrict,
 state text not null check(state in('opening_frozen','active','suspended','retired')),
 policy_version_id uuid not null,opening_id uuid,
 actor_id uuid not null references public.profiles(id)on delete restrict,session_id uuid not null,
 reason text not null check(length(reason)between 1 and 2000),recorded_at timestamptz not null default clock_timestamp(),
 foreign key(policy_version_id,product_id)references public.controlled_stock_policy_versions(id,product_id)on delete restrict,
 foreign key(opening_id,product_id)references public.controlled_stock_openings(id,product_id)on delete restrict,
 unique(product_id,version),unique(id,product_id),check((version=1)=(prior_event_id is null)),
 check(state<>'active'or opening_id is not null)
);
create table public.controlled_stock_states(
 product_id uuid primary key references public.catalog_products(id)on delete restrict,
 head_id uuid not null,event_version bigint not null default 0 check(event_version>=0),last_event_id uuid,
 foreign key(head_id,product_id)references public.controlled_stock_state_events(id,product_id)deferrable initially deferred,
 check((event_version=0)=(last_event_id is null))
);
create table public.controlled_stock_preparations(
 id uuid primary key,writer text not null,actor_id uuid not null references public.profiles(id)on delete restrict,
 session_id uuid not null,product_id uuid not null references public.catalog_products(id)on delete restrict,
 policy_version_id uuid not null,state_head_id uuid not null,opening_id uuid not null,
 canonical_arguments jsonb not null check(jsonb_typeof(canonical_arguments)='object'and octet_length(canonical_arguments::text)<=131072),
 context jsonb not null check(jsonb_typeof(context)='object'and octet_length(context::text)<=262144),
 frozen jsonb not null check(jsonb_typeof(frozen)='object'and octet_length(frozen::text)<=1048576),
 request_hash text not null check(request_hash~'^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default(clock_timestamp()+interval '15 minutes'),
 foreign key(policy_version_id,product_id)references public.controlled_stock_policy_versions(id,product_id)on delete restrict,
 foreign key(state_head_id,product_id)references public.controlled_stock_state_events(id,product_id)on delete restrict,
 foreign key(opening_id,product_id)references public.controlled_stock_openings(id,product_id)on delete restrict,
 check(expires_at>created_at),unique(id,actor_id,writer)
);
create table public.controlled_stock_cancellations(
 id uuid primary key references public.controlled_stock_preparations(id)on delete restrict,
 actor_id uuid not null references public.profiles(id)on delete restrict,writer text not null,
 session_id uuid not null,recorded_at timestamptz not null default clock_timestamp(),
 foreign key(id,actor_id,writer)references public.controlled_stock_preparations(id,actor_id,writer)on delete restrict
);
create table public.controlled_stock_actions(
 id uuid primary key references public.controlled_stock_preparations(id)on delete restrict,
 actor_id uuid not null references public.profiles(id)on delete restrict,writer text not null,
 session_id uuid not null,request_hash text not null check(request_hash~'^[0-9a-f]{64}$'),
 receipt jsonb not null check(jsonb_typeof(receipt)='object'and octet_length(receipt::text)<=2097152),
 recorded_at timestamptz not null default clock_timestamp(),
 foreign key(id,actor_id,writer)references public.controlled_stock_preparations(id,actor_id,writer)on delete restrict
);
create table public.controlled_stock_events(
 id uuid primary key references public.controlled_stock_actions(id)deferrable initially deferred,
 product_id uuid not null references public.catalog_products(id)on delete restrict,
 sequence bigint not null check(sequence>0),prior_event_id uuid unique,
 policy_version_id uuid not null,opening_id uuid not null,
 engine_revision integer not null references public.controlled_stock_engine_manifests(revision)on delete restrict,
 writer text not null,event_kind text not null,
 actor_id uuid not null references public.profiles(id)on delete restrict,session_id uuid not null,
 actor_name text not null check(length(actor_name)between 1 and 200),
 basis text not null check(basis in('physical_record','correction_assertion','annotation','discrepancy_assertion')),
 observed_at timestamptz check(isfinite(observed_at)),recorded_at timestamptz not null default clock_timestamp(),
 note text not null check(length(note)between 1 and 4000),context_hash text not null check(context_hash~'^[0-9a-f]{64}$'),
 canonical_result jsonb not null check(jsonb_typeof(canonical_result)='object'),
 source_bundle jsonb not null,source_effects jsonb not null,clinical_snapshot jsonb not null,
 secondary_review_required boolean not null,prior_record_hash text,record_hash text not null check(record_hash~'^[0-9a-f]{64}$'),
 foreign key(policy_version_id,product_id)references public.controlled_stock_policy_versions(id,product_id)on delete restrict,
 foreign key(opening_id,product_id)references public.controlled_stock_openings(id,product_id)on delete restrict,
 unique(product_id,sequence),unique(id,product_id),
 foreign key(prior_event_id,product_id)references public.controlled_stock_events(id,product_id)on delete restrict,
 check((sequence=1)=(prior_event_id is null)),check((sequence=1)=(prior_record_hash is null)),
 check((basis='physical_record')=(observed_at is not null))
);
alter table public.controlled_stock_actions add constraint controlled_stock_action_event_fk foreign key(id)references public.controlled_stock_events(id)deferrable initially deferred;
alter table public.controlled_stock_states add constraint controlled_stock_product_event_fk foreign key(last_event_id,product_id)references public.controlled_stock_events(id,product_id)deferrable initially deferred;
create table public.controlled_stock_containers(
 id uuid primary key,product_id uuid not null references public.catalog_products(id)on delete restrict,
 stock_unit text not null check(length(stock_unit)between 1 and 50),label text not null check(length(label)between 1 and 200),
 kind text not null check(kind in('stock','prepared')),stock_lot_id uuid references public.inventory_lots(id)on delete restrict,
 controlling_site_id uuid not null references public.controlled_stock_sites(id)on delete restrict,
 initial_location_id uuid not null,initial_custodian_id uuid references public.profiles(id)on delete restrict,
 opening_id uuid references public.controlled_stock_openings(id)on delete restrict,
 created_event_id uuid references public.controlled_stock_events(id)deferrable initially deferred,
 actor_id uuid not null references public.profiles(id)on delete restrict,session_id uuid not null,
 recorded_at timestamptz not null default clock_timestamp(),
 foreign key(initial_location_id,controlling_site_id)references public.controlled_stock_locations(id,site_id)on delete restrict,
 check((kind='stock')=(stock_lot_id is not null)),check(num_nonnulls(opening_id,created_event_id)=1)
);
create table public.controlled_stock_container_transitions(
 id uuid primary key,event_id uuid not null references public.controlled_stock_events(id)on delete restrict,
 container_id uuid not null references public.controlled_stock_containers(id)on delete restrict,
 version_before bigint not null check(version_before>=0),version_after bigint not null check(version_after=version_before+1),
 before_location_id uuid references public.controlled_stock_locations(id)on delete restrict,
 before_custodian_id uuid references public.profiles(id)on delete restrict,
 before_status text not null check(before_status in('onsite','handed_off','disposed')),
 after_location_id uuid references public.controlled_stock_locations(id)on delete restrict,
 after_custodian_id uuid references public.profiles(id)on delete restrict,
 after_status text not null check(after_status in('onsite','handed_off','disposed')),
 unique(event_id,container_id),unique(container_id,version_after),unique(container_id,version_after,event_id)
);
create table public.controlled_stock_container_heads(
 container_id uuid primary key references public.controlled_stock_containers(id)on delete restrict,
 version bigint not null check(version>=0),location_id uuid references public.controlled_stock_locations(id)on delete restrict,
 custodian_id uuid references public.profiles(id)on delete restrict,
 status text not null check(status in('onsite','handed_off','disposed')),last_event_id uuid,
 check((version=0)=(last_event_id is null)),check((status='onsite')=(location_id is not null)),
 check(status='onsite'or custodian_id is null),
 foreign key(container_id,version,last_event_id)references public.controlled_stock_container_transitions(container_id,version_after,event_id)deferrable initially deferred
);
create table public.controlled_stock_cells(
 id uuid primary key,container_id uuid not null references public.controlled_stock_containers(id)on delete restrict,
 lot_id uuid not null references public.inventory_lots(id)on delete restrict,
 channel text not null check(channel in('available','prepared','return_held')),
 dispense_id uuid references public.native_dispenses(id)on delete restrict,
 allocation_id uuid references public.native_dispense_allocations(id)on delete restrict,
 intake_id uuid references public.native_return_events(id)on delete restrict,
 opening_id uuid references public.controlled_stock_openings(id)on delete restrict,
 created_event_id uuid references public.controlled_stock_events(id)deferrable initially deferred,
 opening_quantity numeric(14,3)not null check(opening_quantity>=0),
 check(num_nonnulls(opening_id,created_event_id)=1),check(created_event_id is null or opening_quantity=0),
 check((channel='available'and dispense_id is null and allocation_id is null and intake_id is null)
  or(channel='prepared'and dispense_id is not null and allocation_id is not null and intake_id is null)
  or(channel='return_held'and dispense_id is not null and allocation_id is not null and intake_id is not null)),
 unique nulls not distinct(container_id,lot_id,channel,dispense_id,allocation_id,intake_id)
);
create table public.controlled_stock_positions(
 cell_id uuid primary key references public.controlled_stock_cells(id)on delete restrict,
 quantity numeric(14,3)not null check(quantity>=0)
);
create table public.controlled_stock_source_links(
 id uuid primary key,event_id uuid not null references public.controlled_stock_events(id)on delete restrict,
 movement_id uuid unique references public.inventory_movements(id)on delete restrict,
 return_event_id uuid unique references public.native_return_events(id)on delete restrict,
 discrepancy_event_id uuid unique references public.native_return_discrepancy_events(id)on delete restrict,
 pickup_id uuid unique references public.native_pickups(id)on delete restrict,
 correction_event_id uuid unique references public.native_dispense_correction_events(id)on delete restrict,
 check(num_nonnulls(movement_id,return_event_id,discrepancy_event_id,pickup_id,correction_event_id)=1)
);
create table public.controlled_stock_event_lines(
 id uuid primary key,event_id uuid not null references public.controlled_stock_events(id)on delete restrict,
 cell_id uuid not null references public.controlled_stock_cells(id)on delete restrict,
 source_link_id uuid not null references public.controlled_stock_source_links(id)on delete restrict,
 quantity_delta numeric(14,3)not null check(quantity_delta<>0),
 container_version_before bigint not null check(container_version_before>=0),
 container_version_after bigint not null check(container_version_after=container_version_before+1),
 unique(event_id,cell_id,source_link_id)
);
create table public.controlled_stock_execution_contexts(
 backend_pid integer primary key,server_started_at timestamptz not null,transaction_id bigint not null,
 transaction_started_at timestamptz not null,statement_started_at timestamptz not null,
 nonce uuid not null,operation_id uuid not null,writer text not null,
 actor_id uuid not null,session_id uuid not null,phase text not null check(phase='executing')
);
