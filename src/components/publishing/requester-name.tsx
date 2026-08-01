type RequesterProfile = { id: string; fullName: string | null; email: string } | null;

/** Pure — used both by the component below and anywhere a plain string is needed (e.g. a `title` attribute). */
export function formatRequesterName(profile: RequesterProfile): string {
  if (!profile) return "Unknown user";
  return profile.fullName ?? profile.email;
}

/**
 * The only place "requested by" is rendered. Shows the resolved profile
 * name; falls back to email, then to "Unknown user" if the profile was
 * deleted. The raw actor UUID is never shown in normal operator UI — it
 * stays available only via the technical-details section on the job detail
 * page, which reads `job.requestedBy` directly instead of this component.
 */
export function RequesterName({ profile, showEmail = false }: { profile: RequesterProfile; showEmail?: boolean }) {
  const name = formatRequesterName(profile);
  const email = profile?.fullName ? profile.email : null;

  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span>{name}</span>
      {showEmail && email ? <span className="text-[11px] text-subtle-foreground">({email})</span> : null}
    </span>
  );
}
