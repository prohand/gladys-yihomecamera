// -----------------------------------------------------------------------------
// Real-time events through MQTT (optional).
//
// yi-hack publishes what the camera detects on an MQTT broker the user points
// it to (web interface, "MQTT" page): motion start and stop, the AI detections
// (human, vehicle, animal), sound and baby crying, and an online/offline
// status. When the user gives the same broker to this integration, it listens
// there and the motion reaches Gladys in about a second. Without a broker the
// motion is deduced from the clips the camera records (see src/cameras.js),
// which is slower but needs nothing else.
//
// The topics and messages are NOT hard-coded: every camera can rename them, so
// they are read from the camera itself (get_configs.sh?conf=mqtt) and only the
// few keys below are kept — the broker password that file also holds is
// dropped on the spot.
// -----------------------------------------------------------------------------

import mqtt from 'mqtt';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'mqtt' });

/** What a message on a camera topic means. */
export const MQTT_EVENTS = {
  MOTION_START: 'motion_start',
  MOTION_STOP: 'motion_stop',
  HUMAN: 'human',
  VEHICLE: 'vehicle',
  ANIMAL: 'animal',
  SOUND: 'sound',
  CRYING: 'crying',
  ONLINE: 'online',
  OFFLINE: 'offline',
};

// yi-hack defaults, used for a key the camera's file does not have (older
// firmware versions knew fewer of them).
const DEFAULTS = {
  MQTT_PREFIX: 'yicam',
  TOPIC_BIRTH_WILL: 'status',
  TOPIC_MOTION: 'motion_detection',
  TOPIC_SOUND_DETECTION: 'sound_detection',
  BIRTH_MSG: 'online',
  WILL_MSG: 'offline',
  MOTION_START_MSG: 'motion_start',
  MOTION_STOP_MSG: 'motion_stop',
  AI_HUMAN_DETECTION_MSG: 'human',
  AI_VEHICLE_DETECTION_MSG: 'vehicle',
  AI_ANIMAL_DETECTION_MSG: 'animal',
  BABY_CRYING_MSG: 'crying',
  SOUND_DETECTION_MSG: 'sound',
};

/**
 * The topics of one camera and what each message on them means, from its
 * `get_configs.sh?conf=mqtt` answer.
 *
 * @param {Record<string, string>} raw
 * @returns {{ prefix: string, topics: Record<string, Record<string, string>> }}
 */
export function cameraTopics(raw = {}) {
  const get = (key) => {
    const value = String(raw[key] ?? '').trim();
    return value || DEFAULTS[key];
  };
  const prefix = get('MQTT_PREFIX').replace(/\/+$/, '');
  const topic = (key) => `${prefix}/${get(key)}`;

  // Baby crying and the AI detections ride on the motion topic or on the sound
  // topic depending on the firmware generation: accept them on both.
  const detections = {
    [get('AI_HUMAN_DETECTION_MSG')]: MQTT_EVENTS.HUMAN,
    [get('AI_VEHICLE_DETECTION_MSG')]: MQTT_EVENTS.VEHICLE,
    [get('AI_ANIMAL_DETECTION_MSG')]: MQTT_EVENTS.ANIMAL,
    [get('BABY_CRYING_MSG')]: MQTT_EVENTS.CRYING,
  };
  return {
    prefix,
    topics: {
      [topic('TOPIC_MOTION')]: {
        ...detections,
        [get('MOTION_START_MSG')]: MQTT_EVENTS.MOTION_START,
        [get('MOTION_STOP_MSG')]: MQTT_EVENTS.MOTION_STOP,
      },
      [topic('TOPIC_SOUND_DETECTION')]: {
        ...detections,
        [get('SOUND_DETECTION_MSG')]: MQTT_EVENTS.SOUND,
      },
      [topic('TOPIC_BIRTH_WILL')]: {
        [get('BIRTH_MSG')]: MQTT_EVENTS.ONLINE,
        [get('WILL_MSG')]: MQTT_EVENTS.OFFLINE,
      },
    },
  };
}

/** The broker address as safe to log: no credentials, ever. */
export function redactUrl(url) {
  return String(url).replace(/\/\/[^@/]*@/, '//***@');
}

/**
 * Connect to the broker and route the camera messages.
 *
 * @param {object} options
 * @param {string} options.url mqtt://host:1883, mqtts://…, ws://…
 * @param {string} [options.username]
 * @param {string} [options.password]
 * @param {(host: string, event: string) => void} options.onEvent
 * @param {(connected: boolean, error?: string) => void} [options.onStatus]
 * @param {typeof mqtt.connect} [options.connect] injected by the tests
 */
export function createMqttListener({ url, username, password, onEvent, onStatus, connect }) {
  // topic -> { host, messages }
  let routes = new Map();
  let connected = false;
  let lastError = null;

  const client = (connect ?? mqtt.connect)(url, {
    username: username || undefined,
    password: password || undefined,
    clientId: `gladys-yihomecamera-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 10_000,
    connectTimeout: 10_000,
    clean: true,
  });

  const subscribeAll = () => {
    const topics = [...routes.keys()];
    if (connected && topics.length > 0) {
      client.subscribe(topics, { qos: 0 }, (err) => {
        if (err) {
          logger.warn(`Subscription refused by the broker: ${err.message}`);
        }
      });
    }
  };

  client.on('connect', () => {
    connected = true;
    lastError = null;
    logger.info(`Connected to the MQTT broker ${redactUrl(url)}`);
    subscribeAll();
    onStatus?.(true);
  });
  client.on('close', () => {
    if (connected) {
      logger.warn('MQTT broker connection closed, retrying in 10 s');
    }
    connected = false;
    onStatus?.(false, lastError ?? undefined);
  });
  client.on('error', (err) => {
    lastError = err?.message ?? String(err);
    logger.warn(`MQTT broker error: ${lastError}`);
  });
  client.on('message', (topic, payload) => {
    const route = routes.get(topic);
    if (!route) {
      return;
    }
    const message = payload.toString().trim();
    const event = route.messages[message];
    if (event) {
      logger.debug(`${route.host} <- ${topic} ${message}`);
      onEvent(route.host, event);
    } else {
      logger.debug(`${route.host}: message "${message}" on ${topic} ignored`);
    }
  });

  return {
    get connected() {
      return connected;
    },
    get lastError() {
      return lastError;
    },

    /**
     * Replace the routed topics: `{ host -> cameraTopics(...) }`. Two cameras
     * sharing a prefix cannot be told apart: the second one is left out, and
     * its host is returned so the caller can say so.
     *
     * @param {Map<string, { topics: object }>} byHost
     * @returns {string[]} hosts left out for a duplicate prefix
     */
    route(byHost) {
      const next = new Map();
      const clashes = [];
      for (const [host, { topics }] of byHost) {
        if (Object.keys(topics).some((topic) => next.has(topic))) {
          clashes.push(host);
          continue;
        }
        for (const [topic, messages] of Object.entries(topics)) {
          next.set(topic, { host, messages });
        }
      }
      const removed = [...routes.keys()].filter((topic) => !next.has(topic));
      routes = next;
      if (connected && removed.length > 0) {
        client.unsubscribe(removed);
      }
      subscribeAll();
      return clashes;
    },

    /** Hosts currently routed. */
    hosts() {
      return new Set([...routes.values()].map((route) => route.host));
    },

    close() {
      return new Promise((resolve) => {
        client.end(true, {}, () => resolve());
      });
    },
  };
}
