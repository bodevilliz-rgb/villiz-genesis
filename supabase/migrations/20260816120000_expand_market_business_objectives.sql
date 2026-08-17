-- Extend the approved client objective vocabulary without changing table shape,
-- ownership or RLS. Existing profile values remain valid.
alter table public.market_intelligence_profiles
  drop constraint if exists market_profile_business_objectives;

alter table public.market_intelligence_profiles
  add constraint market_profile_business_objectives check (
    business_objectives <@ array[
      'visibility', 'awareness', 'enquiries', 'bookings', 'sales',
      'authority', 'community_growth', 'attendance', 'lead_generation', 'other'
    ]::text[]
  );
