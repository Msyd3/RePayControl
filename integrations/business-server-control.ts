import { randomUUID } from 'node:crypto';
import type { Request } from 'express';

/** Called only after appendContactLead succeeds. Best-effort telemetry must not fail a saved lead. */
export async function recordLeadCreated(req: Request): Promise<void> {
  const origin = process.env.REPAY_CONTROL_ORIGIN, key = process.env.REPAY_CONTROL_SERVER_KEY;
  if (!origin || !key) return;
  try {
    const url = new URL('/api/server-events', origin);
    if (url.protocol !== 'https:') return;
    const clean = (v: string | undefined) => v && /^[a-zA-Z0-9_.:-]{1,120}$/.test(v) ? v : '';
    const result = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(1500), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({events:[{
      id: randomUUID(), project:'business', name:'lead_created', path:'/api/leads', session:clean(req.get('X-RePayControl-Session')), visitor:clean(req.get('X-RePayControl-Visitor'))
    }]}) });
    if (!result.ok) req.log.warn({ status: result.status }, 'RePayControl event not accepted');
  } catch { req.log.warn('RePayControl unavailable; contact lead already saved'); }
}
