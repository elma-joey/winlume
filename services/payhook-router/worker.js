const encoder = new TextEncoder();

// metadata.source → 投递目标（URL 与签名密钥都是 Worker secret）。
// events：这个项目能处理的事件。没声明的事件会被确认后忽略（200），不会投递给它——
// by-your-side 的接收端只认 order.paid，不能收到 order.refunded。
const KNOWN_EVENTS = ['order.paid', 'order.refunded'];
const TARGETS = {
  'by-your-side': { url: 'BYYOURSIDE_DELIVERY_URL', secret: 'BYYOURSIDE_DELIVERY_SECRET', events: ['order.paid'] },
  'v2-design': { url: 'V2DESIGN_DELIVERY_URL', secret: 'V2DESIGN_DELIVERY_SECRET', events: ['order.paid', 'order.refunded'] },
  'reizo': { endpoint: 'https://reizo-ai.com/api/pay/kyren/notify', secret: 'REIZO_DELIVERY_SECRET', events: ['order.paid', 'order.refunded'] },
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function hexBytes(value) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function verifyHmac(payload, signature, timestamp, secret) {
  if (!signature?.startsWith('sha256=') || !timestamp || !secret) return false;
  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(Date.now() - timestampMs) > 300000) return false;
  const signatureBytes = hexBytes(signature.slice('sha256='.length));
  if (!signatureBytes) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(timestamp + '.' + payload));
}

async function signHmac(payload, timestamp, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + '.' + payload)));
  return 'sha256=' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function receiveKyren(request, env) {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return json(415, { error: 'content type must be application/json' });
  const raw = await request.text();
  if (!await verifyHmac(raw, request.headers.get('x-kyren-signature'), request.headers.get('x-kyren-timestamp'), env.KYREN_WEBHOOK_SECRET)) return json(400, { error: 'invalid Kyren webhook signature' });

  let event;
  try { event = JSON.parse(raw); } catch { return json(400, { error: 'invalid JSON body' }); }
  const source = event?.data?.metadata?.source;
  const localOrderId = event?.data?.metadata?.local_order_id;
  if (!KNOWN_EVENTS.includes(event?.type) || typeof event?.id !== 'string' || typeof source !== 'string' || typeof localOrderId !== 'string') return json(400, { error: 'unsupported Kyren event' });
  if (!Object.hasOwn(TARGETS, source)) return json(400, { error: 'unknown payment source' });
  if (!TARGETS[source].events.includes(event.type)) return json(200, { ok: true, ignored: true });

  const insert = await env.DB.prepare('INSERT OR IGNORE INTO webhook_events(event_id, event_type, source, local_order_id, payload, received_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(event.id, event.type, source, localOrderId, raw, Date.now()).run();

  if (insert.meta.changes === 1) {
    try { await env.DELIVERIES.send({ eventId: event.id }); }
    catch (error) {
      await env.DB.prepare('UPDATE webhook_events SET last_error=? WHERE event_id=?').bind(String(error), event.id).run();
      return json(503, { error: 'delivery queue unavailable' });
    }
  } else {
    const existing = await env.DB.prepare('SELECT state FROM webhook_events WHERE event_id=?').bind(event.id).first();
    if (existing?.state !== 'delivered') await env.DELIVERIES.send({ eventId: event.id });
  }
  return json(200, { ok: true });
}

async function deliver(message, env) {
  const eventId = message.body?.eventId;
  if (typeof eventId !== 'string') { message.ack(); return; }
  const record = await env.DB.prepare('SELECT payload, state, source FROM webhook_events WHERE event_id=?').bind(eventId).first();
  if (!record || record.state === 'delivered') { message.ack(); return; }

  const target = TARGETS[record.source] ?? TARGETS['by-your-side'];
  const payload = record.payload;
  const timestamp = String(Date.now());
  const signature = await signHmac(payload, timestamp, env[target.secret]);
  let response;
  let errorMessage = null;
  try {
    response = await fetch(target.endpoint ?? env[target.url], { method: 'POST', headers: { 'content-type': 'application/json', 'x-payhook-signature': signature, 'x-payhook-timestamp': timestamp, 'x-payhook-event-id': eventId }, body: payload });
    if (!response.ok) errorMessage = 'receiver returned ' + response.status;
  } catch (error) { errorMessage = String(error); }

  await env.DB.prepare('INSERT INTO delivery_attempts(event_id, attempted_at, response_status, error_message) VALUES (?, ?, ?, ?)')
    .bind(eventId, Date.now(), response?.status ?? null, errorMessage).run();

  if (!errorMessage) {
    await env.DB.prepare("UPDATE webhook_events SET state='delivered', delivered_at=?, last_error=NULL WHERE event_id=?").bind(Date.now(), eventId).run();
    message.ack();
    return;
  }

  await env.DB.prepare('UPDATE webhook_events SET last_error=? WHERE event_id=?').bind(errorMessage, eventId).run();
  message.retry({ delaySeconds: Math.min(30 * message.attempts, 600) });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/healthz') return json(200, { ok: true });
    if (request.method === 'POST' && path === '/kyren') return receiveKyren(request, env);
    return json(404, { error: 'not found' });
  },
  async queue(batch, env) {
    for (const message of batch.messages) await deliver(message, env);
  }
};
