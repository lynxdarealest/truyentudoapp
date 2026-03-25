// Simple bridge to send AI requests via Relay WebSocket and await streamed response.

type RelaySendFn = (payload: unknown) => boolean;

interface PendingRequest {
  chunks: string[];
  resolve: (body: string) => void;
  reject: (err: Error) => void;
  timeout: number;
}

let relaySend: RelaySendFn | null = null;
const pending = new Map<string, PendingRequest>();

const makeRequestId = () => `req_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

export function setRelaySender(fn: RelaySendFn | null) {
  relaySend = fn;
}

export function notifyRelayDisconnected(reason: string) {
  pending.forEach((p) => p.reject(new Error(reason)));
  pending.clear();
}

export function handleRelayMessage(msg: any) {
  if (!msg || typeof msg !== 'object') return;
  const requestId = msg.request_id;
  if (!requestId || !pending.has(requestId)) return;
  const entry = pending.get(requestId)!;
  const event = msg.event_type;

  if (event === 'chunk') {
    entry.chunks.push(String(msg.data || ''));
    return;
  }

  if (event === 'stream_close') {
    window.clearTimeout(entry.timeout);
    const body = entry.chunks.join('');
    pending.delete(requestId);
    entry.resolve(body);
    return;
  }

  if (event === 'error') {
    window.clearTimeout(entry.timeout);
    pending.delete(requestId);
    entry.reject(new Error(msg.message || `Relay error ${msg.status || ''}`));
  }
}

export async function relayGenerateContent(model: string, body: unknown, timeoutMs = 45000): Promise<string> {
  if (!relaySend) {
    throw new Error('Relay chưa sẵn sàng. Vui lòng kết nối lại.');
  }

  const requestId = makeRequestId();
  const payload = {
    request_id: requestId,
    method: 'POST',
    path: `/v1beta/models/${model}:generateContent`,
    headers: { 'Content-Type': 'application/json' },
    body,
  };

  const sent = relaySend(payload);
  if (!sent) {
    throw new Error('Không thể gửi yêu cầu tới Relay.');
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Relay timeout'));
    }, timeoutMs);

    pending.set(requestId, { chunks: [], resolve, reject, timeout });
  });
}
