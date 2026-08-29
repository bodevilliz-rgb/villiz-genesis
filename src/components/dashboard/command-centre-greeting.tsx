"use client";

import { useEffect, useState } from "react";

export function getCommandCentreGreeting(fullName: string | null, localHour: number): string {
  const daypart = localHour < 12 ? "Morning" : localHour < 18 ? "Afternoon" : "Evening";
  const displayName = fullName?.trim();
  return `Good ${daypart}${displayName ? `, ${displayName}` : ""}.`;
}

export function CommandCentreGreeting({ fullName, initialHour }: { fullName: string | null; initialHour: number }) {
  const [localHour, setLocalHour] = useState(initialHour);

  // The browser clock is Genesis's existing operator-local time convention.
  // The server hour keeps the first render deterministic; hydration then
  // corrects for deployments whose server timezone differs from the operator.
  useEffect(() => setLocalHour(new Date().getHours()), []);

  return getCommandCentreGreeting(fullName, localHour);
}
