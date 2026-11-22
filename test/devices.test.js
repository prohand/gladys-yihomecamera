import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  FEATURES,
  buildCameraDevice,
  defaultCameraName,
  platformIdFromStatus,
  signalPercent,
} from '../src/devices/camera.js';
import { createIdentityStore } from '../src/store.js';

const gladys = createFakeGladys();
const camera = (overrides = {}) => ({
  host: '192.168.1.20',
  id: 'aabbccddee01',
  name: 'Garage',
  model: 'y623',
  firmware: '0.4.1',
  ptz: false,
  presets: [],
  ...overrides,
});

test('every feature carries the columns Gladys stores NOT NULL', () => {
  const device = buildCameraDevice(
    gladys,
    camera({ ptz: true, presets: [{ num: 1, name: 'Door' }] }),
  );
  for (const feature of device.features) {
    for (const column of ['name', 'min', 'max', 'read_only', 'has_feedback']) {
      assert.notEqual(feature[column], undefined, `${feature.external_id}: ${column}`);
      assert.notEqual(feature[column], null, `${feature.external_id}: ${column}`);
    }
    assert.ok(feature.min <= feature.max, feature.external_id);
  }
});

test('the fake Gladys accepts the discovery payload', async () => {
  await gladys.publishDiscoveredDevices([
    buildCameraDevice(gladys, camera()),
    buildCameraDevice(gladys, camera({ id: 'aabbccddee02', ptz: true })),
  ]);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('feature external ids are the device id plus a stable key', () => {
  const device = buildCameraDevice(gladys, camera());
  assert.equal(device.external_id, 'ext:test-integration:yi-camera:aabbccddee01');
  const keys = device.features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(keys, [
    FEATURES.IMAGE,
    FEATURES.ENABLED,
    FEATURES.MOTION,
    FEATURES.LED,
    FEATURES.IR,
    FEATURES.SIGNAL,
  ]);
});

test('only PTZ cameras get move and preset', () => {
  const plain = buildCameraDevice(gladys, camera());
  assert.ok(!plain.features.some((f) => f.external_id.endsWith(':move')));
  const ptz = buildCameraDevice(gladys, camera({ ptz: true }));
  const move = ptz.features.find((f) => f.external_id.endsWith(':move'));
  assert.deepEqual(
    move.supported_options.map((o) => o.value),
    [1, 2, 3, 4],
    'no zoom on a Yi camera, and 0 (stop) is never listed',
  );
});

test('the platform id is the MAC, then the serial; never a placeholder', () => {
  assert.equal(platformIdFromStatus({ mac_addr: 'AA:BB:CC:DD:EE:01' }), 'aabbccddee01');
  assert.equal(platformIdFromStatus({ mac_addr: '', serial_number: 'ABCD1234567' }), 'abcd1234567');
  assert.equal(
    platformIdFromStatus({ mac_addr: '00:00:00:00:00:00', serial_number: '0000' }),
    null,
  );
});

test('the default yi-hack hostname is replaced by the address', () => {
  assert.equal(defaultCameraName({ hostname: 'yi-hack' }, '10.0.0.5'), 'Yi camera 10.0.0.5');
  assert.equal(defaultCameraName({ hostname: 'Entrance' }, '10.0.0.5'), 'Entrance');
});

test('Wi-Fi quality is converted from the /70 scale and capped', () => {
  assert.equal(signalPercent({ wlan_strength: '35' }), 50);
  assert.equal(signalPercent({ wlan_strength: '90' }), 100);
  assert.equal(signalPercent({ wlan_strength: '' }), null);
});

test('identities survive a restart in cameras.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yi-store-'));
  try {
    const store = createIdentityStore({ dir });
    store.set('10.0.0.5', { ...camera(), client: {}, online: true });
    const saved = JSON.parse(readFileSync(join(dir, 'cameras.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved['10.0.0.5']).sort(), [
      'firmware',
      'id',
      'model',
      'name',
      'presets',
      'ptz',
    ]);
    assert.equal(createIdentityStore({ dir }).get('10.0.0.5').id, 'aabbccddee01');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
