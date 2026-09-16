-- Read-only inventory. This script does not authorize or perform deletion.
-- Run against a database containing the conversation/incoming attachment migrations.
begin read only;
with inventory as (
 select o.bucket_id,
  case when u.id is null then 'unknown_object_review'
    when u.status='ready' then 'retain_verified_upload'
    when u.status='abandoned' then 'abandoned_upload_review'
    else 'retain_pending_upload' end as category,
  o.created_at,
  case when o.metadata->>'size' ~ '^[0-9]{1,18}$' then (o.metadata->>'size')::bigint end as bytes
 from storage.objects o
 left join public.conversation_attachment_uploads u on u.storage_path=o.name
 where o.bucket_id='conversation-attachment-uploads'
 union all
 select o.bucket_id,
  case when current_capture.id is not null and current_capture.status='ready' then 'retain_verified_incoming'
    when current_capture.id is not null then 'retain_current_capture_attempt'
    when superseding_capture.id is not null then 'superseded_attempt_review'
    else 'unknown_object_review' end,
  o.created_at,
  case when o.metadata->>'size' ~ '^[0-9]{1,18}$' then (o.metadata->>'size')::bigint end
 from storage.objects o
 left join public.inbound_attachment_captures current_capture on current_capture.storage_path=o.name
 left join public.inbound_attachment_captures superseding_capture
  on superseding_capture.inbound_id::text=split_part(o.name,'/',1)
  and superseding_capture.attachment_id::text=split_part(o.name,'/',2)
  and superseding_capture.storage_path<>o.name
  and o.name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}/original$'
 where o.bucket_id='inbound-attachment-originals'
)
select bucket_id,category,count(*) as objects,coalesce(sum(bytes),0) as known_bytes,
 count(*) filter(where bytes is null) as unknown_size_objects,min(created_at) as oldest_object
from inventory group by bucket_id,category order by bucket_id,category;
rollback;
