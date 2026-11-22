import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YI_ERRORS, YiClient, parsePresets, yesNo } from '../src/yi/client.js';
import { createFakeCameras } from './helpers/fakeCamera.js';

const HOST = '192.168.1.20';

function setup(overrides) {
  const network = createFakeCameras({ [HOST]: overrides });
  const client = new YiClient({ host: HOST, fetch: network.fetch });
  return { network, client, camera: network.cameras.get(HOST) };
}

test('reads status.json and the camera settings, without the closing NULL', async () => {
  const { client } = setup();
  const status = await client.getStatus();
  assert.equal(status.fw_version, '0.4.1');
  const settings = await client.getConfig('camera');
  assert.equal(settings.SWITCH_ON, 'yes');
  assert.equal(settings.NULL, undefined);
});

test('changes settings with the tokens yi-hack expects', async () => {
  const { client, camera, network } = setup();
  await client.setCameraSettings({ led: 'yes', switch_on: 'no' });
  assert.equal(camera.settings.LED, 'yes');
  assert.equal(camera.settings.SWITCH_ON, 'no');
  assert.deepEqual(network.calls.at(-1).query, { led: 'yes', switch_on: 'no' });
});

test('a snapshot is a JPEG buffer; anything else is refused', async () => {
  const { client, camera } = setup();
  const buffer = await client.snapshot({ resolution: 'low' });
  assert.equal(buffer[0], 0xff);
  assert.equal(buffer[1], 0xd8);
  camera.lowJpeg = Buffer.from('{"error":"true"}');
  await assert.rejects(client.snapshot(), (err) => err.code === YI_ERRORS.INVALID);
});

test('wrong credentials, unreachable camera and non yi-hack device are told apart', async () => {
  const { client, camera, network } = setup({ auth: { user: 'admin', pass: 'secret' } });
  await assert.rejects(client.getStatus(), (err) => err.code === YI_ERRORS.AUTH);

  const authed = new YiClient({
    host: HOST,
    username: 'admin',
    password: 'secret',
    fetch: network.fetch,
  });
  assert.equal((await authed.getStatus()).hostname, 'cam1');

  camera.reachable = false;
  await assert.rejects(authed.getStatus(), (err) => err.code === YI_ERRORS.UNREACHABLE);

  camera.reachable = true;
  camera.status = { hello: 'router' };
  await assert.rejects(authed.getStatus(), (err) => err.code === YI_ERRORS.INVALID);
});

test('a camera that never answers times out', async () => {
  // AbortSignal.timeout does not keep the event loop alive on its own.
  const keepAlive = setTimeout(() => {}, 1000);
  const client = new YiClient({
    host: HOST,
    timeoutMs: 20,
    fetch: (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      ),
  });
  await assert.rejects(client.getStatus(), (err) => err.code === YI_ERRORS.TIMEOUT);
  clearTimeout(keepAlive);
});

test('PTZ steps and presets are checked before anything is sent', async () => {
  const { client, camera } = setup();
  await client.ptzStep('left');
  await client.goToPreset(3);
  assert.deepEqual(camera.ptzMoves, ['left']);
  assert.deepEqual(camera.presetsVisited, [3]);
  await assert.rejects(client.ptzStep('spin'), /Unknown PTZ direction/);
  await assert.rejects(client.goToPreset(8), /does not exist/);
});

test('the last recording is a path, or null when there is none', async () => {
  const { client, camera } = setup();
  assert.equal(await client.lastRecording(), '2026Y11M22D10H/E1M00S00P60.mp4');
  camera.lastRecording = '';
  assert.equal(await client.lastRecording(), null);
});

test('presets: named slots only, in order', () => {
  assert.deepEqual(parsePresets({ 2: 'Door,120,40', 0: 'Garden,1,2', 1: '', NULL: 'NULL' }), [
    { num: 0, name: 'Garden' },
    { num: 2, name: 'Door' },
  ]);
});

test('yes/no settings', () => {
  assert.equal(yesNo('yes'), 1);
  assert.equal(yesNo('no'), 0);
  assert.equal(yesNo(undefined), null);
});
