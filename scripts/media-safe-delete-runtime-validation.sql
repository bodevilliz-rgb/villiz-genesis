-- Disposable LOCAL validation fixtures. Never run against a linked or production database.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

insert into public.media_assets (id, organisation_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
values
('a0000000-0000-4000-a000-000000000001','00000000-0000-4000-b000-000000000001','organisations/00000000-0000-4000-b000-000000000001/validation/unused.jpg','unused.jpg','image/jpeg',100,'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
('a0000000-0000-4000-a000-000000000002','00000000-0000-4000-b000-000000000001','organisations/00000000-0000-4000-b000-000000000001/validation/attached.jpg','attached.jpg','image/jpeg',200,'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
('a0000000-0000-4000-a000-000000000003','00000000-0000-4000-b000-000000000001','organisations/00000000-0000-4000-b000-000000000001/validation/detached.jpg','detached.jpg','image/jpeg',300,'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
('a0000000-0000-4000-a000-000000000004','00000000-0000-4000-b000-000000000001','organisations/00000000-0000-4000-b000-000000000001/validation/publishing.jpg','publishing.jpg','image/jpeg',400,'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
('a0000000-0000-4000-a000-000000000005','00000000-0000-4000-b000-000000000001','organisations/00000000-0000-4000-b000-000000000001/validation/intelligence.jpg','intelligence.jpg','image/jpeg',500,'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
('a0000000-0000-4000-a000-000000000006','00000000-0000-4000-b000-000000000001','organisations/another-org/forged.jpg','forged.jpg','image/jpeg',600,'0eea9074-18f3-4934-9e20-b2bfde1fef05'),
('a0000000-0000-4000-a000-000000000007','00000000-0000-4000-b000-000000000001','organisations/00000000-0000-4000-b000-000000000001/validation/unknown.jpg','unknown.jpg','image/jpeg',700,'0eea9074-18f3-4934-9e20-b2bfde1fef05');

insert into public.content_draft_assets (draft_id, asset_id, attached_by) values
('00000000-0000-4000-d000-000000000001','a0000000-0000-4000-a000-000000000002','0eea9074-18f3-4934-9e20-b2bfde1fef05'),
('00000000-0000-4000-d000-000000000002','a0000000-0000-4000-a000-000000000003','0eea9074-18f3-4934-9e20-b2bfde1fef05'),
('00000000-0000-4000-d000-000000000004','a0000000-0000-4000-a000-000000000004','0eea9074-18f3-4934-9e20-b2bfde1fef05');
delete from public.content_draft_assets where asset_id='a0000000-0000-4000-a000-000000000003';

insert into public.publishing_jobs (
  id, organisation_id, draft_id, platform, trigger_type, scheduled_for, status,
  idempotency_key, requested_by, execution_mode
) values (
  'c0000000-0000-4000-c000-000000000001','00000000-0000-4000-b000-000000000001',
  '00000000-0000-4000-d000-000000000004','instagram','immediate',now(),'queued',
  'media-safe-delete-runtime-validation','0eea9074-18f3-4934-9e20-b2bfde1fef05','simulation'
);

update public.engagement_recommendations
set evidence = evidence || jsonb_build_array(jsonb_build_object('sourceType','media_asset','sourceId','a0000000-0000-4000-a000-000000000005','title','Disposable validation evidence'))
where id = (select id from public.engagement_recommendations where organisation_id='00000000-0000-4000-b000-000000000001' limit 1);
update public.media_assets set usage_tracking_started_at=null where id='a0000000-0000-4000-a000-000000000007';

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','0eea9074-18f3-4934-9e20-b2bfde1fef05',true);
select set_config('request.jwt.claim.role','authenticated',true);
select 'A_UNUSED|' || public.get_media_deletion_status('00000000-0000-4000-b000-000000000001','a0000000-0000-4000-a000-000000000001')::text;
select 'B_ATTACHED|' || public.get_media_deletion_status('00000000-0000-4000-b000-000000000001','a0000000-0000-4000-a000-000000000002')::text;
select 'C_DETACHED|' || public.get_media_deletion_status('00000000-0000-4000-b000-000000000001','a0000000-0000-4000-a000-000000000003')::text;
select 'D_PUBLISHING|' || public.get_media_deletion_status('00000000-0000-4000-b000-000000000001','a0000000-0000-4000-a000-000000000004')::text;
select 'E_INTELLIGENCE|' || public.get_media_deletion_status('00000000-0000-4000-b000-000000000001','a0000000-0000-4000-a000-000000000005')::text;
select 'H_CROSS_PATH|' || public.get_media_deletion_status('00000000-0000-4000-b000-000000000001','a0000000-0000-4000-a000-000000000006')::text;
select 'I_UNKNOWN|' || public.get_media_deletion_status('00000000-0000-4000-b000-000000000001','a0000000-0000-4000-a000-000000000007')::text;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-b111-111111111111',true);
select set_config('request.jwt.claim.role','authenticated',true);
select 'F_CONTRIBUTOR|' || public.request_media_safe_delete('00000000-0000-4000-b000-000000000001','a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-b000-000000000001')::text;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','0eea9074-18f3-4934-9e20-b2bfde1fef05',true);
select set_config('request.jwt.claim.role','authenticated',true);
select 'G_LEAD_DELETE|' || public.request_media_safe_delete('00000000-0000-4000-b000-000000000001','a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-b000-000000000001')::text;
select 'DUPLICATE|' || public.request_media_safe_delete('00000000-0000-4000-b000-000000000001','a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-b000-000000000002')::text;
reset role;
select 'ROW_DELETED|' || count(*) from public.media_assets where id='a0000000-0000-4000-a000-000000000001';
select 'LEDGER_PENDING|' || cleanup_state || '|' || object_paths::text || '|' || total_bytes from public.media_deletion_requests where former_asset_id='a0000000-0000-4000-a000-000000000001';
select 'AUDIT_REQUEST|' || count(*) from public.audit_events where event_type='media_permanent_deletion_requested' and metadata->>'formerAssetId'='a0000000-0000-4000-a000-000000000001';
commit;
