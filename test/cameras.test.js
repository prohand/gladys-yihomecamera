import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { CameraManager, MAX_IMAGE_LENGTH } from '../src/cameras.js';
import { normalizeConfig } from '../src/config.js';
import { SCENE_TRIGGERS } from '../src/capabilities/triggers.js';
import {
  createFakeCameras,
  createFakeClock,
  createFakeMqtt,
  createMemoryStore,
  jpeg,
} from './helpers/fakeCamera.js';

const A = '192.168.1.20';
const B = '192.168.1.21';

function setup({ defs = { [A]: {} }, config = {}, store = createMemoryStore() } = {}) {
  const gladys = createFakeGladys();
  const network = createFakeCameras(defs);
  const clock = createFakeClock();
  const mqtt = createFakeMqtt();
  const manager = new CameraManager({
    gladys,
    store,
    fetch: network.fetch,
    connectMqtt: mqtt.connect,
    now: clock.now,
    timers: clock.timers,
    sleep: clock.sleep,
  });
  manager.configure(normalizeConfig({ cameras: Object.keys(defs).join(','), ...config }));
  return { gladys, network, clock, mqtt, manager, store };
}

const deviceId = (id) => `ext:test-integration:yi-camera:${id}`;
const ID_A = 'aabbccddee01';
const ID_B = 'aabbccddee02';

test('a refresh publishes one device per camera, keyed on its MAC address', async () => {
  const { gladys, manager, store } = setup({ defs: { [A]: {}, [B]: {} } });
  await manager.refreshAll({ full: true });
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.external_id),
    [deviceId(ID_A), deviceId(ID_B)],
  );
  assert.equal(devices[0].name, 'cam1');
  assert.deepEqual(
    devices[0].params.find((p) => p.name === 'host'),
    { name: 'host', value: A },
  );
  assert.equal(store.get(A).id, ID_A);
});

test('the states follow the camera settings and the Wi-Fi quality', async () => {
  const { gladys, manager } = setup();
  await manager.refreshAll();
  const id = deviceId(ID_A);
  assert.equal(gladys.fake.lastState(`${id}:enabled`), 1);
  assert.equal(gladys.fake.lastState(`${id}:led`), 0);
  assert.equal(gladys.fake.lastState(`${id}:ir`), 1);
  assert.equal(gladys.fake.lastState(`${id}:motion`), 0);
  // 49 on the /70 scale of the Wi-Fi chip
  assert.equal(gladys.fake.lastState(`${id}:signal`), 70);
});

test('unchanged states are not re-sent at every refresh', async () => {
  const { gladys, manager } = setup();
  await manager.refreshAll();
  const count = gladys.fake.states.length;
  await manager.refreshAll();
  assert.equal(gladys.fake.states.length, count);
});

test('a camera going offline gets the unreachable badge and fires camera_offline once', async () => {
  const { gladys, manager, network } = setup();
  await manager.refreshAll();
  assert.equal(gladys.fake.transports.at(-1).transport, 'local');
  network.cameras.get(A).reachable = false;
  await manager.refreshAll();
  await manager.refreshAll();
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  const offline = gladys.fake.sceneEvents.filter((e) => e.key === SCENE_TRIGGERS.CAMERA_OFFLINE);
  assert.equal(offline.length, 1);
  assert.equal(offline[0].data.device, deviceId(ID_A));

  network.cameras.get(A).reachable = true;
  await manager.refreshAll();
  assert.ok(gladys.fake.sceneEvents.some((e) => e.key === SCENE_TRIGGERS.CAMERA_ONLINE));
});

test('the first read never fires a connection trigger', async () => {
  const { gladys, manager } = setup({ defs: { [A]: { reachable: false } } });
  await manager.refreshAll();
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('a reboot asked from Gladys does not fire camera_offline', async () => {
  const { gladys, manager, network } = setup();
  await manager.refreshAll();
  const camera = manager.list()[0];
  await manager.reboot(camera);
  assert.equal(network.cameras.get(A).reboots, 1);
  network.cameras.get(A).reachable = false;
  await manager.refreshAll();
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('a camera unplugged at start-up is still published from what was remembered', async () => {
  const store = createMemoryStore({ [A]: { id: ID_A, name: 'Garage', ptz: false, presets: [] } });
  const { gladys, manager } = setup({ defs: { [A]: { reachable: false } }, store });
  await manager.refreshAll();
  assert.equal(gladys.fake.discoveredDevices[0].external_id, deviceId(ID_A));
  assert.equal(gladys.fake.discoveredDevices[0].name, 'Garage');
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
});

test('a PTZ camera gets move and preset features, presets from the camera', async () => {
  const { gladys, manager } = setup({
    defs: { [A]: { status: { ptz: 'yes' }, presets: { 0: 'Door,1,2', 3: 'Garden,3,4' } } },
  });
  await manager.refreshAll({ full: true });
  const features = gladys.fake.discoveredDevices[0].features;
  const preset = features.find((f) => f.external_id.endsWith(':preset'));
  assert.deepEqual(
    preset.supported_options.map(({ value, label }) => [value, label]),
    [
      [0, 'Door'],
      [3, 'Garden'],
    ],
  );
  assert.ok(features.some((f) => f.external_id.endsWith(':move')));
});

test('switch features change the camera, then publish what it says now', async () => {
  const { gladys, manager, network } = setup();
  await manager.refreshAll();
  const camera = manager.list()[0];
  await manager.setValue(camera, 'enabled', 0);
  assert.equal(network.cameras.get(A).settings.SWITCH_ON, 'no');
  assert.equal(gladys.fake.lastState(`${deviceId(ID_A)}:enabled`), 0);
  await manager.setValue(camera, 'led', 1);
  assert.equal(network.cameras.get(A).settings.LED, 'yes');
  await assert.rejects(manager.setValue(camera, 'signal', 1), /cannot be changed/);
});

test('moves are steps that stop by themselves; 0 sends nothing', async () => {
  const { manager, network } = setup({ defs: { [A]: { status: { ptz: 'yes' } } } });
  await manager.refreshAll();
  const camera = manager.list()[0];
  await manager.setValue(camera, 'move', 1);
  await manager.setValue(camera, 'move', 4);
  await manager.setValue(camera, 'move', 0);
  assert.deepEqual(network.cameras.get(A).ptzMoves, ['left', 'down']);
  await assert.rejects(manager.setValue(camera, 'move', 5), /Unsupported move/);
  await manager.setValue(camera, 'preset', 2);
  assert.deepEqual(network.cameras.get(A).presetsVisited, [2]);
});

test('a snapshot is pushed in the Gladys image format and kept for the widgets', async () => {
  const { gladys, manager } = setup();
  await manager.refreshAll();
  await manager.pushSnapshots();
  const [image] = gladys.fake.cameraImages;
  assert.equal(image.device_external_id, deviceId(ID_A));
  assert.match(image.image, /^image\/jpg;base64,\/9j/);
  assert.ok(manager.list()[0].snapshot.key.startsWith('snap-'));
});

test('no snapshot is pushed for a camera that is off', async () => {
  const { gladys, manager } = setup({ defs: { [A]: { settings: { SWITCH_ON: 'no' } } } });
  await manager.refreshAll();
  await manager.pushSnapshots();
  assert.equal(gladys.fake.cameraImages.length, 0);
});

test('a high resolution image too heavy for Gladys falls back to low', async () => {
  const { manager, network } = setup({ config: { snapshot_resolution: 'high' } });
  network.cameras.get(A).highJpeg = jpeg(MAX_IMAGE_LENGTH);
  await manager.refreshAll();
  const image = await manager.capture(manager.list()[0]);
  assert.ok(image.length <= MAX_IMAGE_LENGTH);
  assert.deepEqual(
    network.calls.filter((c) => c.path === '/cgi-bin/snapshot.sh').map((c) => c.query.res),
    ['high', 'low'],
  );
});

test('without MQTT, a new recording is a motion: state 1, one event, back to 0 later', async () => {
  const { gladys, manager, network, clock } = setup();
  await manager.refreshAll();
  await manager.checkRecordings(); // baseline only
  assert.equal(gladys.fake.sceneEvents.length, 0);

  network.cameras.get(A).lastRecording = '2026Y11M22D10H/E1M01S00P60.mp4';
  await manager.checkRecordings();
  const motion = `${deviceId(ID_A)}:motion`;
  assert.equal(gladys.fake.lastState(motion), 1);
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: SCENE_TRIGGERS.MOTION_DETECTED,
      data: { device: deviceId(ID_A), device_name: 'cam1', detection: 'motion' },
    },
  ]);

  // The same clip again is no news.
  await manager.checkRecordings();
  assert.equal(gladys.fake.sceneEvents.length, 1);

  await clock.advance(60_000);
  assert.equal(gladys.fake.lastState(motion), 0);
});

test('a camera recording all the time says nothing about motion', async () => {
  const { gladys, manager, network } = setup({
    defs: { [A]: { settings: { SAVE_VIDEO_ON_MOTION: 'no' } } },
  });
  await manager.refreshAll();
  await manager.checkRecordings();
  network.cameras.get(A).lastRecording = 'other.mp4';
  await manager.checkRecordings();
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('MQTT: topics read from each camera, motion, AI and sound routed to the right camera', async () => {
  const { gladys, manager, mqtt } = setup({
    defs: { [A]: { mqtt: { MQTT_PREFIX: 'garage' } }, [B]: { mqtt: { MQTT_PREFIX: 'garden' } } },
    config: { mqtt_url: 'mqtt://broker:1883' },
  });
  const client = mqtt.clients[0];
  client.emit('connect');
  await manager.refreshAll({ full: true });
  assert.ok(client.subscribed.has('garage/motion_detection'));
  assert.ok(client.subscribed.has('garden/sound_detection'));

  client.publish('garden/motion_detection', 'motion_start');
  client.publish('garden/motion_detection', 'human');
  client.publish('garden/sound_detection', 'crying');
  await manager.mqttQueue;

  const events = gladys.fake.sceneEvents.map((e) => [
    e.key,
    e.data.device,
    e.data.detection ?? e.data.sound,
  ]);
  assert.deepEqual(events, [
    [SCENE_TRIGGERS.MOTION_DETECTED, deviceId(ID_B), 'motion'],
    [SCENE_TRIGGERS.MOTION_DETECTED, deviceId(ID_B), 'human'],
    [SCENE_TRIGGERS.SOUND_DETECTED, deviceId(ID_B), 'crying'],
  ]);
  assert.equal(gladys.fake.lastState(`${deviceId(ID_B)}:motion`), 1);

  client.publish('garden/motion_detection', 'motion_stop');
  await manager.mqttQueue;
  assert.equal(gladys.fake.lastState(`${deviceId(ID_B)}:motion`), 0);

  // MQTT carries the motion: the recordings are not looked at.
  assert.ok(manager.mqttActive(manager.list()[1]));
});

test('MQTT: two cameras on the same prefix are reported, not mixed up', async () => {
  const { manager, mqtt } = setup({
    defs: { [A]: {}, [B]: {} },
    config: { mqtt_url: 'mqtt://broker:1883' },
  });
  mqtt.clients[0].emit('connect');
  await manager.refreshAll({ full: true });
  assert.deepEqual(manager.mqttClashes, [B]);
  assert.ok(manager.mqttActive(manager.list()[0]));
  assert.ok(!manager.mqttActive(manager.list()[1]));
});

test('the same detection twice within 10 s is one event', async () => {
  const { gladys, manager, clock } = setup();
  await manager.refreshAll();
  const camera = manager.list()[0];
  await manager.motionDetected(camera, 'human');
  await manager.motionDetected(camera, 'human');
  assert.equal(gladys.fake.sceneEvents.length, 1);
  await clock.advance(11_000);
  await manager.motionDetected(camera, 'human');
  assert.equal(gladys.fake.sceneEvents.length, 2);
});

test('identify blinks the LED and puts it back as it was', async () => {
  const { manager, network } = setup({ defs: { [A]: { settings: { LED: 'yes' } } } });
  await manager.refreshAll();
  await manager.identify(manager.list()[0]);
  const leds = network.calls
    .filter((c) => c.path === '/cgi-bin/camera_settings.sh')
    .map((c) => c.query.led);
  assert.deepEqual(leds, ['yes', 'no', 'yes', 'no', 'yes', 'no', 'yes']);
  assert.equal(network.cameras.get(A).settings.LED, 'yes');
});

test('reconfiguring keeps the cameras still listed and drops the others', async () => {
  const { manager } = setup({ defs: { [A]: {}, [B]: {} } });
  await manager.refreshAll();
  manager.configure(normalizeConfig({ cameras: B }));
  assert.deepEqual(
    manager.list().map((c) => [c.host, c.online]),
    [[B, true]],
  );
});

test('stop closes the MQTT connection', async () => {
  const { manager, mqtt } = setup({ config: { mqtt_url: 'mqtt://broker' } });
  await manager.stop();
  assert.ok(mqtt.clients[0].ended);
});
