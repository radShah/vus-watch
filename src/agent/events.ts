/** Append-only event log shared by the cycle and the dashboard API. */
import { appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const EVENTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'events.jsonl')

export function appendEvents(events: object[]): void {
  if (events.length) appendFileSync(EVENTS, events.map((e) => JSON.stringify(e)).join('\n') + '\n')
}
