import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseCameraList } from '../src/config.js';

test('the camera list accepts commas, spaces, new lines, schemes, ports and paths', () => {
  assert.deepEqual(
    parseCameraList(' 192.168.1.20,http://192.168.1.21:8080/ ;\n Cam-Garage.lan  192.168.1.20 '),
    ['192.168.1.20', '192.168.1.21:8080', 'cam-garage.lan'],
  );
});

test('the camera list drops what cannot be an address', () => {
  assert.deepEqual(parseCameraList('user:pass@192.168.1.20, , 10.0.0.5'), ['10.0.0.5']);
  assert.deepEqual(parseCameraList(undefined), []);
  assert.deepEqual(parseCameraList(''), []);
});

test('an empty config gives the defaults', () => {
  const config = normalizeConfig();
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.deepEqual(config[key], value, key);
  }
  assert.deepEqual(config.hosts, []);
});

test('numbers typed as text are read, clamped to their range', () => {
  const config = normalizeConfig({
    poll_frequency: '5',
    motion_timeout: '9999',
    snapshot_interval: 'x',
  });
  assert.equal(config.poll_frequency, 10);
  assert.equal(config.motion_timeout, 600);
  assert.equal(config.snapshot_interval, DEFAULT_CONFIG.snapshot_interval);
});

test('snapshots: 0 turns the push off, anything else is 10 s at least', () => {
  assert.equal(normalizeConfig({ snapshot_interval: 0 }).snapshot_interval, 0);
  assert.equal(normalizeConfig({ snapshot_interval: '3' }).snapshot_interval, 10);
  assert.equal(normalizeConfig({ snapshot_interval: 120 }).snapshot_interval, 120);
});

test('an unknown resolution falls back to low', () => {
  assert.equal(normalizeConfig({ snapshot_resolution: 'ultra' }).snapshot_resolution, 'low');
  assert.equal(normalizeConfig({ snapshot_resolution: 'high' }).snapshot_resolution, 'high');
});

test('passwords are kept exactly as typed, other texts are trimmed', () => {
  const config = normalizeConfig({
    username: ' admin ',
    password: ' p@ss ',
    mqtt_url: ' mqtt://b ',
  });
  assert.equal(config.username, 'admin');
  assert.equal(config.password, ' p@ss ');
  assert.equal(config.mqtt_url, 'mqtt://b');
});
