"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

type Subscriber = { refresh: () => void };
type Poll = { subscribers: Set<Subscriber>; timer?: ReturnType<typeof setTimeout>; busy: boolean; count: number };
const polls = new WeakMap<object, Poll>();
const INTERVAL_MS = 15_000;
const MAX_REFRESHES = 40;

function schedule(poll: Poll) {
  if (poll.timer || poll.busy || poll.count >= MAX_REFRESHES || !poll.subscribers.size) return;
  poll.timer = setTimeout(() => {
    poll.timer = undefined;
    const subscriber = poll.subscribers.values().next().value;
    if (!subscriber) return;
    poll.busy = true;
    poll.count++;
    subscriber.refresh();
  }, INTERVAL_MS);
}

/** One bounded refresh stream per mounted route, shared by all publication cards.
 * React's transition remains pending until the server refresh commits.
 */
export function useCampaignPublicationPoll(active: boolean) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const owned = useRef<Poll | null>(null);
  useEffect(() => {
    if (!active) return;
    let poll = polls.get(router);
    if (!poll) {
      poll = { subscribers: new Set(), busy: false, count: 0 };
      polls.set(router, poll);
    }
    const shared = poll;
    const subscriber = { refresh: () => {
      owned.current = shared;
      startTransition(() => router.refresh());
    } };
    shared.subscribers.add(subscriber);
    schedule(shared);
    return () => {
      shared.subscribers.delete(subscriber);
      if (!shared.subscribers.size) {
        clearTimeout(shared.timer);
        shared.timer = undefined;
        polls.delete(router);
      }
    };
  }, [active, router]);
  useEffect(() => {
    if (!pending && owned.current) {
      const poll = owned.current;
      owned.current = null;
      poll.busy = false;
      schedule(poll);
    }
  });
}
