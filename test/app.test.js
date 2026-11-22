// End to end: the app wired to the SDK's fake Gladys, the cameras faked behind
// `fetch`, the timers driven by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp, RECORDINGS_INTERVAL_MS } from '../src/app.js';
import {
  createFakeCameras,
  createFakeClock,
  createFakeMqtt,
  createMemoryStore,
} from './helpers/fakeCamera.js';

const A = '192.168.1.20';
const B = '192.168.1.21';
const DEVICE_A = 'ext:test-integration:yi-camera:aabbccddee01';

async function start({ defs = { [A]: {} }, config } = {}) {
  const network = createFakeCameras(defs);
  const clock = createFakeClock();
  const gladys = createFakeGladys({
    config: config ?? { cameras: Object.keys(defs).join(', ') },
  });
  const app = createApp({
    gladys,
    store: createMemoryStore(),
    fetch: network.fetch,
    connectMqtt: createFakeMqtt().connect,
    timers: clock.timers,
    sleep: clock.sleep,
    now: clock.now,
  });
  await gladys.connect();
  // The first snapshots run in the background of the connection handler.
  await clock.advance(0);
  return { gladys, app, network, clock };
}

test('on connection: devices published, status connected, first snapshot pushed', async () => {
  const { gladys, app } = await start();
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(gladys.fake.discoveredDevices[0].external_id, DEVICE_A);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.cameraImages.length, 1);
  await app.stop();
});

test('without any camera, the status says what to fill in', async () => {
  const { gladys, app } = await start({ defs: {}, config: {} });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /adresse d'au moins une caméra/);
  await app.stop();
});

test('one camera down out of two: connected, and its address named', async () => {
  const { gladys, app } = await start({ defs: { [A]: {}, [B]: { reachable: false } } });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /192\.168\.1\.21/);
  await app.stop();
});

test('a command from Gladys reaches the camera and the confirmed state comes back', async () => {
  const { gladys, app, network } = await start();
  const device = gladys.fake.discoveredDevices[0];
  const ir = device.features.find((f) => f.external_id.endsWith(':ir'));
  assert.deepEqual(await gladys.fake.setValue(device, ir, 0), { success: true });
  assert.equal(network.cameras.get(A).settings.IR, 'no');
  assert.equal(gladys.fake.lastState(ir.external_id), 0);
  await app.stop();
});

test('a command on an unknown device is acked as failed', async () => {
  const { gladys, app } = await start();
  const ack = await gladys.fake.setValue(
    { external_id: 'ext:test-integration:yi-camera:nope' },
    { external_id: 'ext:test-integration:yi-camera:nope:led', category: 'switch', type: 'binary' },
    1,
  );
  assert.equal(ack.success, false);
  await app.stop();
});

test('Gladys asking for a fresh image gets a JPEG', async () => {
  const { gladys, app } = await start();
  const ack = await gladys.fake.getImage(gladys.fake.discoveredDevices[0]);
  assert.equal(ack.success, true);
  assert.match(ack.data.image, /^image\/jpg;base64,/);
  await app.stop();
});

test('the timers refresh the cameras and look at the recordings', async () => {
  const { gladys, app, network, clock } = await start();
  network.cameras.get(A).settings.LED = 'yes';
  await clock.advance(30_000);
  assert.equal(gladys.fake.lastState(`${DEVICE_A}:led`), 1);

  network.cameras.get(A).lastRecording = 'new.mp4';
  await clock.advance(RECORDINGS_INTERVAL_MS);
  assert.ok(gladys.fake.sceneEvents.some((e) => e.key === 'motion_detected'));
  await app.stop();
  assert.equal(clock.pending(), 0);
});

test('a new configuration is applied at once', async () => {
  const { gladys, app, network } = await start();
  network.add(B);
  await gladys.fake.configUpdated({ cameras: `${A}, ${B}` });
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  await app.stop();
});

test('the Configuration screen buttons answer in every language', async () => {
  const { gladys, app } = await start();
  const test = await gladys.fake.action('test_connection', {});
  assert.equal(test.success, true);
  assert.match(test.data.message.en, /✓ 192\.168\.1\.20/);
  assert.match(test.data.message.es, /movimiento/);

  const identify = await gladys.fake.action('identify', { device: DEVICE_A });
  assert.match(identify.data.message.de, /dreimal/);

  const reboot = await gladys.fake.action('reboot', { device: 'unknown' });
  assert.match(reboot.data.message.fr, /plus dans la configuration/);
  await app.stop();
});

test('scene actions return their outputs, false when the camera cannot', async () => {
  const { gladys, app, network } = await start();
  const snap = await gladys.fake.sceneAction('take_snapshot', { device: DEVICE_A });
  assert.deepEqual(snap.data, { outputs: { captured: true } });

  const preset = await gladys.fake.sceneAction('go_to_preset', { device: DEVICE_A, preset: 1 });
  assert.deepEqual(preset.data, { outputs: { moved: false } }, 'not a PTZ camera');

  const sensitivity = await gladys.fake.sceneAction('set_motion_sensitivity', {
    device: DEVICE_A,
    sensitivity: 'high',
  });
  assert.deepEqual(sensitivity.data, { outputs: { applied: true } });
  assert.equal(network.cameras.get(A).settings.SENSITIVITY, 'high');

  const reboot = await gladys.fake.sceneAction('reboot_camera', { device: 'unknown' });
  assert.deepEqual(reboot.data, { outputs: { rebooted: false } });
  await app.stop();
});

test('the device list is published once per connection, and again on a scan', async () => {
  const { gladys, app } = await start();
  const published = () => gladys.fake.bodies('POST', '/discovered_device').length;
  assert.equal(published(), 1);
  await gladys.fake.scanRequest();
  assert.equal(published(), 2);
  await app.stop();
});
