import test from 'node:test';
import assert from 'node:assert/strict';
import { callDuration, createVoiceAPI, VoiceAPIError, voiceSocketURL } from './voice-api.ts';

test('voice mutations use the signed-in session and send only the requested settings', async () => {
  const sent: { url: string; options: RequestInit }[] = [];
  const api = createVoiceAPI('https://api.example.com', (async (url, options) => {
    sent.push({ url: String(url), options: options! });
    return Response.json({ agent: { id: 'agent-1' } });
  }) as typeof fetch);
  const settings = { name: 'Receptionist', businessName: 'A & B', greeting: 'Hello', instructions: 'Ask about the visit.', voice: 'luna' as const,
    model:'aura-2' as const,language:'es' as const,voiceLogic: 'reply_right_away' as const, transferNumber: null };
  await api.saveAgent(settings);
  assert.equal(sent[0].url, 'https://api.example.com/voice/agent');
  assert.equal(sent[0].options.method, 'PUT');
  assert.equal(sent[0].options.credentials, 'include');
  assert.deepEqual(JSON.parse(sent[0].options.body as string), settings);
  assert.equal((sent[0].options.headers as Record<string, string>)['content-type'], 'application/json');
});

test('voice requests preserve authentication failures and hide unknown server errors', async () => {
  for (const [status, code, expected] of [[401, 'not_authenticated', /session has expired/], [429, 'voice_call_limit', /call limit/],
    [402, 'insufficient_balance', /credits have run out/], [402, 'spend_limit_exceeded', /spending limit/],
    [503, 'voice_billing_unavailable', /billing is temporarily unavailable/], [503,'voice_model_unavailable',/Choose another model/],
    [503, 'internal_stack_trace_with_sensitive_details', /temporarily unavailable/]] as const) {
    const api = createVoiceAPI('https://api.example.com', (async () => Response.json({ error: code }, { status })) as typeof fetch);
    await assert.rejects(api.calls(), caught => caught instanceof VoiceAPIError && caught.status === status && expected.test(caught.message));
  }
});

test('voice requests handle offline and malformed responses', async () => {
  const offline = createVoiceAPI('https://api.example.com', (async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
  await assert.rejects(offline.agent(), /Check your connection/);
  for (const response of [new Response('<html>unavailable</html>'), Response.json(null), Response.json([])]) {
    const api = createVoiceAPI('https://api.example.com', (async () => response) as typeof fetch);
    await assert.rejects(api.agent(), /Could not read the response/);
  }
});

test('ending a test supports page dismissal without losing the call identifier', async () => {
  const api = createVoiceAPI('https://api.example.com', (async (url, options) => {
    assert.equal(url, 'https://api.example.com/voice/calls/test%2Fidentifier/end');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.keepalive, true);
    return Response.json({ call: { status: 'completed' } });
  }) as typeof fetch);
  await api.end('test/identifier', true);
});

test('voice sockets stay on the configured API origin and retain scoped connection parameters', () => {
  assert.equal(voiceSocketURL('/voice/calls/123/connect', 'https://api.example.com'), 'wss://api.example.com/voice/calls/123/connect');
  assert.equal(voiceSocketURL('ws://localhost:8787/voice/calls/123/connect?token=grant', 'http://localhost:8787'), 'ws://localhost:8787/voice/calls/123/connect?token=grant');
  for (const value of ['wss://evil.example/voice', 'ws://api.example.com/voice', 'wss://user@api.example.com/voice', 'https://api.example.com:444/voice', 'javascript:alert(1)']) {
    assert.throws(() => voiceSocketURL(value, 'https://api.example.com'), /connect securely/);
  }
});

test('call durations handle zero, minutes, and missing measurements', () => {
  assert.equal(callDuration(0), '0:00');
  assert.equal(callDuration(65.9), '1:05');
  assert.equal(callDuration(-10), '0:00');
  assert.equal(callDuration(NaN), '0:00');
});
