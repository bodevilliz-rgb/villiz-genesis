-- Staff invitations are platform-scoped; client access remains represented by
-- the existing organisation_members table and its established RLS policies.
create type public.staff_invitation_status as enum ('pending', 'accepted', 'revoked');

create table public.staff_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  email text not null,
  full_name text not null,
  platform_role public.platform_role not null default 'member',
  organisation_access jsonb not null default '[]'::jsonb,
  status public.staff_invitation_status not null default 'pending',
  invited_by uuid not null references public.profiles(id),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint staff_invitations_email_lower check (email = lower(email)),
  constraint staff_invitations_name_present check (char_length(trim(full_name)) between 2 and 120),
  constraint staff_invitations_access_array check (jsonb_typeof(organisation_access) = 'array')
);

create unique index staff_invitations_one_pending_email
  on public.staff_invitations(email) where status = 'pending';

alter table public.staff_invitations enable row level security;
create policy staff_invitations_admin_only on public.staff_invitations
  for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

-- The application uses service_role for the Auth invitation itself. Ordinary
-- authenticated callers can neither execute Auth administration nor bypass
-- this table's platform-admin policy.
