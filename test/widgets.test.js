import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../src/app.js';
import { WIDGETS, WIDGET_KEYS, ago, refreshWidgets } from '../src/capabilities/widgets.js';
import {
  createFakeCameras,
  createFakeClock,
  createFakeMqtt,
  createMemoryStore,
} from './helpers/fakeCamera.js';

const A = '192.168.1.20';
const B = '192.168.1.21';
const DEVICE_A = 'ext:test-integration:yi-camera:aabbccddee01';

async function start(defs = { [A]: {} }) {
  const network = createFakeCameras(defs);
  const clock = createFakeClock();
  const gladys = createFakeGladys({
    config: { cameras: Object.keys(defs).join(','), snapshot_interval: 0 },
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
  return { gladys, app, network, clock };
}

async function content(gladys, key, settings = {}) {
  const ack = await gladys.fake.widgetGet(key, { settings });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content ?? ack.data;
}

test('the camera widget is rendered exactly as sent, image included', async () => {
  const { gladys, app } = await start({
    [A]: { status: { ptz: 'yes' }, presets: { 0: 'Door,1,2' } },
  });
  await app.manager.capture(app.manager.list()[0]);
  const widget = await content(gladys, WIDGET_KEYS.CAMERA, { device: DEVICE_A });
  assert.deepEqual(validateWidgetContent(widget), []);
  const types = widget.components.map((c) => c.type);
  assert.deepEqual(types, ['image', 'status', 'button', 'button', 'button', 'button']);

  const image = await gladys.fake.widgetGetImage(widget.components[0].key);
  assert.equal(image.success, true);
  assert.equal(Buffer.from(image.data.image ?? image.data, 'base64')[0], 0xff);
  await app.stop();
});

test('a camera widget without a camera picked asks for one', async () => {
  const { gladys, app } = await start();
  const widget = await content(gladys, WIDGET_KEYS.CAMERA);
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.equal(widget.components[0].type, 'text');
  await app.stop();
});

test('an unreachable or switched off camera still renders a valid widget', async () => {
  const { gladys, app, network } = await start({
    [A]: { settings: { SWITCH_ON: 'no' } },
    [B]: {},
  });
  const off = await content(gladys, WIDGET_KEYS.CAMERA, { device: DEVICE_A });
  assert.deepEqual(validateWidgetContent(off), []);
  assert.ok(!off.components.some((c) => c.action?.key === 'snapshot'), 'no snapshot when off');

  network.cameras.get(A).reachable = false;
  await app.manager.refreshAll();
  const down = await content(gladys, WIDGET_KEYS.CAMERA, { device: DEVICE_A });
  assert.deepEqual(validateWidgetContent(down), []);

  const overview = await content(gladys, WIDGET_KEYS.CAMERAS);
  assert.deepEqual(validateWidgetContent(overview), []);
  assert.equal(overview.components[1].items.length, 2);
  await app.stop();
});

test('every button of the camera widget is handled and answers a short toast', async () => {
  const { gladys, app, network } = await start({
    [A]: { status: { ptz: 'yes' }, presets: { 2: 'Garden,1,2' } },
  });
  const widget = await content(gladys, WIDGET_KEYS.CAMERA, { device: DEVICE_A });
  for (const { action } of widget.components.filter((c) => c.action)) {
    const values = action.fields ? { preset: '2' } : undefined;
    const ack = await gladys.fake.widgetAction(WIDGET_KEYS.CAMERA, action.key, action.params, {
      settings: { device: DEVICE_A },
      values,
    });
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    const message = ack.data.message ?? ack.data;
    assert.ok(message.en.length <= 200);
    assert.ok(message.fr && message.de && message.es, `${action.key} speaks every language`);
  }
  const camera = network.cameras.get(A);
  assert.deepEqual(camera.presetsVisited, [2]);
  assert.equal(camera.reboots, 1);
  assert.equal(camera.settings.SWITCH_ON, 'no');
  await app.stop();
});

test('a preset that does not exist is refused', async () => {
  const { gladys, app } = await start({ [A]: { status: { ptz: 'yes' } } });
  const ack = await gladys.fake.widgetAction(
    WIDGET_KEYS.CAMERA,
    'preset',
    { device: DEVICE_A },
    { values: { preset: 5 } },
  );
  assert.equal(ack.success, false);
  await app.stop();
});

test('the overview refresh button works', async () => {
  const { gladys, app } = await start();
  const widget = await content(gladys, WIDGET_KEYS.CAMERAS);
  assert.deepEqual(validateWidgetContent(widget), []);
  const button = widget.components.find((c) => c.type === 'button');
  const ack = await gladys.fake.widgetAction(WIDGET_KEYS.CAMERAS, button.action.key, {});
  assert.equal(ack.success, true);
  await app.stop();
});

test('relative times read naturally', () => {
  const now = Date.parse('2026-11-22T10:00:00Z');
  assert.equal(ago(now, now).fr, "à l'instant");
  assert.equal(ago(now, now - 5 * 60_000).en, '5 min ago');
  assert.equal(ago(now, now - 3 * 3600_000).de, 'vor 3 Std.');
  assert.equal(ago(now, now - 3 * 86400_000).es, 'hace 3 días');
});

test('refreshWidgets nudges every widget', () => {
  const gladys = createFakeGladys();
  refreshWidgets(gladys);
  assert.deepEqual(gladys.fake.widgetRefreshes, Object.keys(WIDGETS));
});
