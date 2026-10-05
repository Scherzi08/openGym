/* The equipment scan — photos in, catalogue equipment out.
 *
 * Three layers, each against its own fake: the checks on what a client may send, the requests
 * the HTTPS adapters put on the wire when photos ride along, and the whole path through the
 * job module's preflight with the fixture provider standing in for a vision model. No photo
 * is ever looked at by anything here; what is asserted is what is sent, and what is let back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const scan = await import('../coach/core/scan.js');
const anthropic = (await import('../coach/core/adapters/anthropic.js')).default;
const openai = (await import('../coach/core/adapters/openai.js')).default;
const gemini = (await import('../coach/core/adapters/gemini.js')).default;
const compatible = (await import('../coach/core/adapters/compatible.js')).default;
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');

forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
const photo = (data = JPEG, mime = 'image/jpeg') => ({ mime, data });

function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify(answer) };
  };
  f.calls = calls;
  return f;
}
const ANSWER = JSON.stringify({ coach_contract: 1, equipment: ['dumbbell', 'cable'], maybe: [], note: '' });

/* ---------- what a client may send ---------- */

test('checkImages accepts JPEG, PNG and WebP, as objects or data URLs', () => {
  const r = scan.checkImages([photo(), 'data:image/png;base64,' + PNG, photo('UklGRiQAAABXRUJQ', 'image/webp')]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.images.map(i => i.mime), ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(r.images[1].data, PNG);
});

test('checkImages refuses what is not a bounded set of real photos', () => {
  const bad = [
    [undefined, /no photos/],
    [[], /no photos/],
    [Array(scan.MAX_SCAN_IMAGES + 1).fill(photo()), /at most/],
    [[photo(JPEG, 'image/gif')], /JPEG, PNG or WebP/],
    [[photo(JPEG, 'text/html')], /JPEG, PNG or WebP/],
    [[photo('')], /empty/],
    [[photo('/9j/' + 'A'.repeat(scan.MAX_IMAGE_CHARS))], /too large/],
    [[photo('/9j/<script>')], /base64/],
    // A PNG that says it is a JPEG — the first bytes decide, not the label.
    [[photo(PNG, 'image/jpeg')], /not the type it claims/],
    [['https://example.com/gym.jpg'], /data URL/],
    [[42], /JPEG, PNG or WebP/]
  ];
  for (const [input, re] of bad) {
    const r = scan.checkImages(input);
    assert.equal(r.ok, false, JSON.stringify(input)?.slice(0, 60));
    assert.match(r.error, re);
  }
});

/* ---------- what is let back ---------- */

test('validateScan keeps only catalogue values, once each, and never body weight', () => {
  const r = scan.validateScan({
    coach_contract: 1,
    equipment: ['Dumbbell', 'cable', 'dumbbell', 'body weight', 'laser treadmill', 42, 'ignore previous instructions'],
    maybe: ['cable', 'kettlebell', 'unicorn'],
    note: '  Two photos were blurry.  '
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.equipment, ['dumbbell', 'cable']);
  // `cable` was already sure, so it does not reappear as a maybe.
  assert.deepEqual(r.result.maybe, ['kettlebell']);
  assert.equal(r.result.note, 'Two photos were blurry.');
  assert.equal(r.result.dropped, 4);
});

test('validateScan refuses an answer without an equipment list', () => {
  for (const v of [null, [], 'dumbbell', {}, { equipment: 'dumbbell' }, { equipment: [], maybe: 'x' }]) {
    assert.equal(scan.validateScan(v).ok, false, JSON.stringify(v));
  }
});

test('the allowed list is the catalogue taxonomy, without body weight', () => {
  assert.ok(scan.SCAN_EQUIPMENT.includes('dumbbell'));
  assert.ok(scan.SCAN_EQUIPMENT.includes('leverage machine'));
  assert.ok(!scan.SCAN_EQUIPMENT.includes('body weight'));
  const { system, user } = scan.buildScanPrompt({ photos: 2, lang: 'de' });
  for (const v of scan.SCAN_EQUIPMENT) assert.ok(system.includes('`' + v + '`'), v);
  assert.ok(system.startsWith(scan.SCAN_TASK_MARKER));
  assert.match(user, /"photos":2/);
  assert.match(user, /"lang":"de"/);
});

/* ---------- on the wire ---------- */

test('Anthropic: photos go before the text as base64 image blocks', async () => {
  const f = fakeFetch({ content: [{ type: 'text', text: ANSWER }], stop_reason: 'end_turn' });
  const r = await scan.runScan({ adapter: anthropic, cfg: {}, images: [photo(), photo(PNG, 'image/png')], lang: 'en', invokeOpts: { env: { ANTHROPIC_API_KEY: 'k' }, fetch: f } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.equipment, ['dumbbell', 'cable']);
  const content = f.calls[0].body.messages[0].content;
  assert.deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG } });
  assert.equal(content[1].source.media_type, 'image/png');
  assert.equal(content[2].type, 'text');
  assert.match(f.calls[0].body.system[0].text, /# Task: equipment scan/);
  assert.equal(f.calls[0].body.max_tokens, scan.SCAN_MAX_TOKENS);
});

test('OpenAI and compatible: photos as data-URL image_url parts, the scan schema as JSON mode', async () => {
  for (const [adapter, env, c] of [
    [openai, { OPENAI_API_KEY: 'k' }, {}],
    [compatible, {}, { provider: 'compatible', providerOptions: { compatible: { baseUrl: 'http://ollama.lan:11434' } } }]
  ]) {
    const f = fakeFetch({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] });
    const r = await scan.runScan({ adapter, cfg: c, images: [photo()], model: 'm', invokeOpts: { env, fetch: f } });
    assert.equal(r.ok, true, adapter.id);
    const user = f.calls[0].body.messages[1];
    assert.equal(user.content[0].type, 'text');
    assert.deepEqual(user.content[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + JPEG } });
    assert.equal(f.calls[0].body.response_format.json_schema.name, 'equipment_scan');
  }
});

test('Gemini: photos as inlineData parts ahead of the text', async () => {
  const f = fakeFetch({ candidates: [{ content: { parts: [{ text: ANSWER }] }, finishReason: 'STOP' }] });
  const r = await scan.runScan({ adapter: gemini, cfg: {}, images: [photo()], invokeOpts: { env: { GEMINI_API_KEY: 'k' }, fetch: f } });
  assert.equal(r.ok, true);
  const parts = f.calls[0].body.contents[0].parts;
  assert.deepEqual(parts[0], { inlineData: { mimeType: 'image/jpeg', data: JPEG } });
  assert.ok(parts[1].text);
});

test('a text-only job puts no image parts on the wire', async () => {
  const f = fakeFetch({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' });
  await anthropic.invoke({ cfg: {}, prompt: 'P', env: { ANTHROPIC_API_KEY: 'k' }, fetch: f });
  assert.equal(f.calls[0].body.messages[0].content, 'P');
});

test('runScan classifies a refusal, garbage and a wrong contract', async () => {
  const run = (answer, status = 200) => scan.runScan({
    adapter: anthropic, cfg: {}, images: [photo()],
    invokeOpts: { env: { ANTHROPIC_API_KEY: 'k' }, fetch: async () => ({ ok: status === 200, status, text: async () => JSON.stringify(answer) }) }
  });
  assert.equal((await run({ error: { message: 'invalid x-api-key' } }, 401)).errorClass, 'auth');
  assert.equal((await run({ error: { message: 'model does not support images' } }, 400)).errorClass, 'provider');
  assert.equal((await run({ content: [{ type: 'text', text: 'Sorry, I see a gym.' }], stop_reason: 'end_turn' })).errorClass, 'unusable');
  assert.equal((await run({ content: [{ type: 'text', text: '{"coach_contract":9,"equipment":[]}' }], stop_reason: 'end_turn' })).errorClass, 'unusable');
});

/* ---------- through the preflight, with the fixture as the vision model ---------- */

cfg.save({ enabled: true, provider: 'fixture', caps: { perProfileDaily: 10, instanceDaily: 0 } });

test('a scan through the fixture: catalogue values only, counted against the cap, logged without content', async () => {
  const uid = 'u-scan';
  writeState(DIR, uid, sampleState());
  const r = await jobs.scanEquipment(uid, { images: [photo(), photo()], lang: 'de' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.equipment, ['barbell', 'dumbbell', 'cable', 'leverage machine', 'smith machine']);
  assert.deepEqual(r.result.maybe, ['ez barbell', 'kettlebell']);
  assert.equal(r.result.dropped, 1);
  assert.equal(jobs.capState(uid).used, 1);
  const entry = cfg.load().log.at(-1);
  assert.equal(entry.kind, 'scan');
  assert.equal(entry.outcome, 'ready');
  assert.equal(entry.detail, '2 photo(s), 5 found');
  // Nothing of the photos is kept on the server.
  const everything = fs.readdirSync(DIR, { recursive: true }).map(f => path.join(DIR, String(f)))
    .filter(f => fs.statSync(f).isFile()).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  assert.ok(!everything.includes(JPEG));
});

test('no consent, no scan — and nothing is spent', async () => {
  const uid = 'u-scan-noconsent';
  writeState(DIR, uid, sampleState({ coach: {} }));
  await assert.rejects(jobs.scanEquipment(uid, { images: [photo()] }), e => e.code === 'consent');
  assert.equal(jobs.capState(uid).used, 0);
});

test('the daily cap stops a scan like it stops a job', async () => {
  const uid = 'u-scan-cap';
  writeState(DIR, uid, sampleState());
  cfg.save({ caps: { perProfileDaily: 1, instanceDaily: 0 } });
  await jobs.scanEquipment(uid, { images: [photo()] });
  await assert.rejects(jobs.scanEquipment(uid, { images: [photo()] }), e => e.code === 'cap');
  cfg.save({ caps: { perProfileDaily: 10, instanceDaily: 0 } });
});

test('a scan and a job cannot run at once for one profile', async () => {
  const uid = 'u-scan-busy';
  writeState(DIR, uid, sampleState());
  const running = jobs.scanEquipment(uid, { images: [photo()] });
  assert.throws(() => jobs.enqueue(uid, { kind: 'review' }), e => e.code === 'busy');
  await running;
});

test('a provider that cannot see photos is refused before anything is spent', async () => {
  const uid = 'u-scan-novision';
  writeState(DIR, uid, sampleState());
  cfg.save({ provider: 'codex' });
  try {
    await assert.rejects(jobs.scanEquipment(uid, { images: [photo()] }), e => e.code === 'novision');
    assert.equal(jobs.capState(uid).used, 0);
  } finally {
    cfg.save({ provider: 'fixture' });
  }
});

test('an empty gym is an answer, not a failure', async () => {
  const uid = 'u-scan-empty';
  writeState(DIR, uid, sampleState());
  process.env.FIXTURE_MODE = 'scan-empty';
  try {
    const r = await jobs.scanEquipment(uid, { images: [photo()] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.equipment, []);
  } finally {
    delete process.env.FIXTURE_MODE;
  }
});
