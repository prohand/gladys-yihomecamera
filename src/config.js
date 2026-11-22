// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` declared in
// `gladys-assistant-integration.json`. This module provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined`, strings typed in a number field, or a badly written list of
// camera addresses.
// -----------------------------------------------------------------------------

/** Snapshot resolutions the yi-hack `snapshot.sh` endpoint accepts. */
export const SNAPSHOT_RESOLUTIONS = ['low', 'high'];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // Addresses of the cameras, as typed by the user (parsed by parseCameraList).
  cameras: '',
  // HTTP credentials of the yi-hack web interface (empty: no authentication).
  username: '',
  password: '',
  // Seconds between two reads of every camera (status, settings).
  poll_frequency: 30,
  // Seconds between two snapshots pushed to Gladys; 0 turns the push off (the
  // dashboard still gets a fresh image on demand).
  snapshot_interval: 60,
  snapshot_resolution: 'low',
  // Optional MQTT broker the cameras publish their events to (yi-hack
  // "MQTT" page). Empty: motion is deduced from the recordings instead.
  mqtt_url: '',
  mqtt_username: '',
  mqtt_password: '',
  // Seconds after which a motion goes back to 0 when the camera does not say
  // so itself (no MQTT motion_stop, motion deduced from a recording).
  motion_timeout: 60,
};

const LIMITS = {
  poll_frequency: [10, 3600],
  snapshot_interval: [0, 3600],
  motion_timeout: [10, 600],
};

// The camera API publishes at most 12 images a minute per device: never push
// faster than one every 10 s, whatever was typed.
const MIN_SNAPSHOT_INTERVAL = 10;

/**
 * A number from a form value, clamped to its range, the default when the
 * value is not a number at all.
 */
function toNumber(key, raw) {
  const value = Number(raw);
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(value)) {
    return DEFAULT_CONFIG[key];
  }
  const [min, max] = LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

function toText(raw) {
  return typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim();
}

/**
 * Turn what the user typed in the "Cameras" field into a clean list of
 * addresses: separated by commas, semicolons, spaces or new lines, with or
 * without `http://`, with or without a port, duplicates removed.
 *
 *   "192.168.1.20, http://192.168.1.21:8080/" -> ['192.168.1.20', '192.168.1.21:8080']
 *
 * @param {string} text
 * @returns {string[]} `host` or `host:port`, lowercase
 */
export function parseCameraList(text) {
  const hosts = [];
  for (const token of toText(text).split(/[\s,;]+/)) {
    const host = normalizeHost(token);
    if (host && !hosts.includes(host)) {
      hosts.push(host);
    }
  }
  return hosts;
}

/**
 * One address, normalized: scheme, path and trailing slash removed. Returns
 * null for something that cannot be a host.
 *
 * @param {string} token
 * @returns {string|null}
 */
export function normalizeHost(token) {
  const cleaned = toText(token)
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
  // Letters, digits, dots, dashes, and an optional :port. Anything else (a
  // space inside, credentials typed as user:pass@host…) is refused: the
  // credentials have their own fields.
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...raw };
  const snapshotInterval = toNumber('snapshot_interval', raw.snapshot_interval);
  return {
    ...config,
    cameras: toText(config.cameras),
    username: toText(config.username),
    // A password may legitimately start or end with a space: kept as typed.
    password: typeof config.password === 'string' ? config.password : '',
    poll_frequency: toNumber('poll_frequency', raw.poll_frequency),
    snapshot_interval:
      snapshotInterval === 0 ? 0 : Math.max(MIN_SNAPSHOT_INTERVAL, snapshotInterval),
    snapshot_resolution: SNAPSHOT_RESOLUTIONS.includes(config.snapshot_resolution)
      ? config.snapshot_resolution
      : DEFAULT_CONFIG.snapshot_resolution,
    mqtt_url: toText(config.mqtt_url),
    mqtt_username: toText(config.mqtt_username),
    mqtt_password: typeof config.mqtt_password === 'string' ? config.mqtt_password : '',
    motion_timeout: toNumber('motion_timeout', raw.motion_timeout),
    hosts: parseCameraList(config.cameras),
  };
}
