insert into auth.users(id,email,raw_user_meta_data) values
 ('__ACTOR__','a2-synthetic@example.test','{}');
update public.profiles set is_active=true,full_name='Synthetic a2 prescriber'
 where id='__ACTOR__';
insert into public.user_roles(user_id,role) values
 ('__ACTOR__','STAFF'),
 ('__ACTOR__','DVM'),
 ('__ACTOR__','ADMIN');

-- AUTHENTICATED_SETUP --
insert into a2_ids select 'client',id from save_client(auth.uid(),null,null,'A2','Synthetic','+13035559188','a2-client@example.test','EMAIL','Synthetic local fixture',null);
insert into a2_ids select 'pet',id from save_patient(null,pg_temp.a2_id('client'),null,'A2 Synthetic Patient','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);

select configure_native_prescriber(pg_temp.a2_id('config'),jsonb_build_object('user_id',auth.uid(),'expected_version',null,'attest_review',true,'fields',
 jsonb_build_object('active',true,'license_number','SYNTHETIC','license_state','CO','license_expires_on','2099-12-31',
 'practice_name','Synthetic fixture only','practice_address','Synthetic local fixture','practice_phone',null,'clinical_review_note','Synthetic engineering fixture only')));
