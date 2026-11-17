/**
 * LIVE DEMO: N different users try to book the same seat at the same instant.
 *
 *   npm run demo:concurrency                       # 50 users, against http://localhost:4000
 *   npm run demo:concurrency -- --users 100 --pay  # also pay for the winning hold
 *   API_URL=http://localhost:4000/api npm run demo:concurrency
 *
 * Requires a running server with seeded data (npm run db:reset && npm run dev).
 */
const API = process.env.API_URL ?? 'http://localhost:4000/api';
const argv = process.argv.slice(2);
const USERS = Number(argv[argv.indexOf('--users') + 1]) || 50;
const PAY = argv.includes('--pay');

type Json = any;
async function call(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: Json; ms: number }> {
  const t0 = performance.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json(), ms: performance.now() - t0 };
}

async function main() {
  const health = await call('GET', '/health').catch(() => null);
  if (!health || health.status !== 200) throw new Error(`Server not reachable at ${API}. Start it with "npm run dev".`);
  console.log(`\nServer OK - seat locking strategy: ${health.json.data.seatLockStrategy}`);

  // 1. Pick the first upcoming show and a free seat.
  const movies = (await call('GET', '/movies')).json.data;
  let show: Json = null;
  for (const m of movies) {
    const shows = (await call('GET', `/movies/${m.id}/shows`)).json.data;
    show = shows.find((s: Json) => s.availableSeats > 0);
    if (show) break;
  }
  if (!show) throw new Error('No upcoming show with free seats - run npm run db:reset');
  const map = (await call('GET', `/shows/${show.id}/seats`)).json.data;
  const seat = map.rows.flatMap((r: Json) => r.seats).find((s: Json) => s.status === 'AVAILABLE');
  console.log(`Target: show #${show.id} (${map.show.movieTitle} @ ${show.theatreName}), seat ${seat.label} (seatId ${seat.seatId})`);

  // 2. Register N demo users.
  const run = Date.now().toString(36);
  const tokens: string[] = await Promise.all(
    Array.from({ length: USERS }, async (_, i) => {
      const r = await call('POST', '/auth/register', { name: `Racer ${i}`, email: `racer${i}-${run}@demo.dev`, password: 'Password1' });
      return r.json.data.token as string;
    }),
  );
  console.log(`Registered ${USERS} users. Firing ${USERS} simultaneous POST /bookings for seat ${seat.label}...\n`);

  // 3. Fire all requests at once.
  const t0 = performance.now();
  const results = await Promise.all(tokens.map((t) => call('POST', '/bookings', { showId: show.id, seatIds: [seat.seatId] }, t)));
  const elapsed = performance.now() - t0;

  const tally = new Map<string, number>();
  for (const r of results) {
    const key = r.status === 201 ? '201 CREATED (hold acquired)' : `${r.status} ${r.json.error?.code}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  console.table([...tally.entries()].map(([outcome, count]) => ({ outcome, count })));
  console.log(`All ${USERS} requests completed in ${elapsed.toFixed(0)} ms`);

  const winners = results.filter((r) => r.status === 201);
  const after = (await call('GET', `/shows/${show.id}/seats`)).json.data;
  const seatAfter = after.rows.flatMap((r: Json) => r.seats).find((s: Json) => s.seatId === seat.seatId);
  console.log(`Seat ${seat.label} status now: ${seatAfter.status}`);
  console.log(winners.length === 1 ? '\nPASS: exactly one user holds the seat; everyone else got 409.' : `\nFAIL: ${winners.length} winners`);

  if (PAY && winners.length === 1) {
    const idx = results.indexOf(winners[0]!);
    const paid = await call('POST', `/bookings/${winners[0]!.json.data.id}/payments`, { method: 'UPI', details: { upiId: 'winner@okbank' } }, tokens[idx]);
    console.log(`Payment: HTTP ${paid.status} -> booking ${paid.json.data?.reference} is ${paid.json.data?.status}`);
  }
  process.exit(winners.length === 1 ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
