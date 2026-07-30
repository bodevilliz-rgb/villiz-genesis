-- ===========================================================================
-- Project Genesis — Sprint 2: MemBrain readiness taxonomy
--
-- The MemBrain readiness calculation (business/brand description, audience,
-- brand voice, content pillars, products & services, restrictions) needs two
-- categories that did not exist in the original 7-category taxonomy from
-- migration 0005: a place for the business/brand description itself, and a
-- place for content pillars. Neither "brand_voice" (tone/phrasing rules, not
-- what the business IS) nor any other existing category represents either of
-- these honestly, so this does not repurpose an existing category — it adds
-- two more rows to the same per-organisation taxonomy mechanism every other
-- system category already uses. No new table, no new model.
-- ===========================================================================

create or replace function app.provision_membrain_taxonomy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.membrain_categories (organisation_id, key, label, description, position, is_system)
  values
    (new.id, 'brand_description', 'Brand description', 'What the business is, what it does and why it exists.', 5, true),
    (new.id, 'brand_voice', 'Brand voice', 'Tone, vocabulary, phrasing rules and things never to say.', 10, true),
    (new.id, 'audience', 'Audience', 'Who we are speaking to, their language, motivations and objections.', 20, true),
    (new.id, 'offering', 'Products & services', 'What the client sells, pricing posture and positioning.', 30, true),
    (new.id, 'content_pillars', 'Content pillars', 'The recurring themes and topics content should be built around.', 35, true),
    (new.id, 'guidelines', 'Rules & compliance', 'Legal, regulatory and client-mandated constraints.', 40, true),
    (new.id, 'performance', 'Performance insight', 'What has actually worked, learned from published assets.', 50, true),
    (new.id, 'competitors', 'Competitors', 'Competitive landscape and differentiation.', 60, true),
    (new.id, 'operations', 'Account operations', 'Approvals, contacts, cadence and how this client likes to work.', 70, true)
  on conflict (organisation_id, key) do nothing;
  return new;
end;
$$;

-- Backfill: organisations created before this migration only got the
-- original 7 categories from the trigger that existed at the time. The
-- trigger only fires on insert, so it cannot retroactively add these two —
-- do it once, here, for every organisation that already exists.
insert into public.membrain_categories (organisation_id, key, label, description, position, is_system)
select o.id, v.key, v.label, v.description, v.position, true
from public.organisations o
cross join (
  values
    ('brand_description', 'Brand description', 'What the business is, what it does and why it exists.', 5::smallint),
    ('content_pillars', 'Content pillars', 'The recurring themes and topics content should be built around.', 35::smallint)
) as v(key, label, description, position)
on conflict (organisation_id, key) do nothing;
