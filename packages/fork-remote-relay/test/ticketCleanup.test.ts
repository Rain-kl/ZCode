import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileTicketCleanup, type TicketCleanupStorage } from "../src/ticketCleanup.js";

function storageWith(records: Record<string, number>) {
  const entries = new Map(
    Object.entries(records).map(([key, expiresAt]) => [
      key,
      { userId: "owner", role: "device" as const, expiresAt },
    ]),
  );
  const deleted: string[] = [];
  let alarm: number | null | undefined;
  const storage: TicketCleanupStorage = {
    async list<T>() {
      return entries as Map<string, T>;
    },
    async delete(keys: string[]) {
      for (const key of keys) {
        entries.delete(key);
        deleted.push(key);
      }
      return true;
    },
    async setAlarm(scheduledTime: number) {
      alarm = scheduledTime;
    },
    async deleteAlarm() {
      alarm = null;
    },
  };
  return { storage, deleted, alarm: () => alarm };
}

test("ticket cleanup removes expired records and schedules the next expiry", async () => {
  const fake = storageWith({
    "ticket:expired": 1_000,
    "ticket:next": 8_000,
    "ticket:later": 9_000,
  });

  await reconcileTicketCleanup(fake.storage, 5_000);

  assert.deepEqual(fake.deleted, ["ticket:expired"]);
  assert.equal(fake.alarm(), 8_000);
});

test("ticket cleanup clears the alarm when no tickets remain", async () => {
  const fake = storageWith({});

  await reconcileTicketCleanup(fake.storage, 5_000);

  assert.equal(fake.alarm(), null);
});
