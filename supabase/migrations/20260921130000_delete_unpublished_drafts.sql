-- Operators may permanently remove only untouched drafts. Every later
-- workflow state remains recoverable through Archive instead.
create policy content_drafts_delete_unpublished
  on public.content_drafts
  for delete
  to authenticated
  using (
    status = 'draft'
    and app.can_write_org(organisation_id)
  );
