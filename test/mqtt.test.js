import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MQTT_EVENTS, cameraTopics, createMqttListener, redactUrl } from '../src/yi/mqtt.js';
import { createFakeMqtt } from './helpers/fakeCamera.js';

test('the yi-hack defaults give the documented topics', () => {
  const { prefix, topics } = cameraTopics({});
  assert.equal(prefix, 'yicam');
  assert.equal(topics['yicam/motion_detection'].motion_start, MQTT_EVENTS.MOTION_START);
  assert.equal(topics['yicam/motion_detection'].human, MQTT_EVENTS.HUMAN);
  assert.equal(topics['yicam/sound_detection'].sound, MQTT_EVENTS.SOUND);
  assert.equal(topics['yicam/sound_detection'].crying, MQTT_EVENTS.CRYING);
  assert.equal(topics['yicam/status'].offline, MQTT_EVENTS.OFFLINE);
});

test('renamed topics and messages are read from the camera', () => {
  const { topics } = cameraTopics({
    MQTT_PREFIX: 'house/garage/',
    TOPIC_MOTION: 'motion',
    MOTION_START_MSG: 'ON',
    MOTION_STOP_MSG: 'OFF',
    MQTT_PASSWORD: 'never-kept',
  });
  assert.deepEqual(Object.keys(topics).sort(), [
    'house/garage/motion',
    'house/garage/sound_detection',
    'house/garage/status',
  ]);
  assert.equal(topics['house/garage/motion'].ON, MQTT_EVENTS.MOTION_START);
  assert.ok(!JSON.stringify(topics).includes('never-kept'), 'the broker password is dropped');
});

test('a broker URL is never logged with its credentials', () => {
  assert.equal(redactUrl('mqtt://user:secret@broker:1883'), 'mqtt://***@broker:1883');
  assert.equal(redactUrl('mqtt://broker:1883'), 'mqtt://broker:1883');
});

test('the listener routes known messages and ignores the rest', () => {
  const fake = createFakeMqtt();
  const events = [];
  const listener = createMqttListener({
    url: 'mqtt://broker',
    username: 'u',
    password: 'p',
    connect: fake.connect,
    onEvent: (host, event) => events.push([host, event]),
  });
  const [client] = fake.clients;
  assert.equal(client.options.username, 'u');
  listener.route(new Map([['10.0.0.1', cameraTopics({ MQTT_PREFIX: 'a' })]]));
  assert.equal(client.subscribed.size, 0, 'nothing subscribed before the connection');
  client.emit('connect');
  assert.ok(listener.connected);
  assert.ok(client.subscribed.has('a/motion_detection'));

  client.publish('a/motion_detection', 'motion_start');
  client.publish('a/motion_detection', 'something else');
  client.publish('b/motion_detection', 'motion_start');
  assert.deepEqual(events, [['10.0.0.1', MQTT_EVENTS.MOTION_START]]);

  listener.route(new Map());
  assert.equal(client.subscribed.size, 0, 'topics of a removed camera are unsubscribed');
  client.emit('close');
  assert.ok(!listener.connected);
});
