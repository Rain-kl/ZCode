const ticketPrefix = "ticket:";

interface ExpiringTicket {
  expiresAt: number;
}

export interface TicketCleanupStorage {
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  delete(keys: string[]): Promise<unknown>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

export async function reconcileTicketCleanup(
  storage: TicketCleanupStorage,
  now = Date.now(),
): Promise<void> {
  const tickets = await storage.list<ExpiringTicket>({ prefix: ticketPrefix });
  const expired: string[] = [];
  let nextExpiry = Number.POSITIVE_INFINITY;
  for (const [key, ticket] of tickets) {
    if (ticket.expiresAt <= now) expired.push(key);
    else nextExpiry = Math.min(nextExpiry, ticket.expiresAt);
  }
  if (expired.length > 0) await storage.delete(expired);
  if (Number.isFinite(nextExpiry)) await storage.setAlarm(nextExpiry);
  else await storage.deleteAlarm();
}
