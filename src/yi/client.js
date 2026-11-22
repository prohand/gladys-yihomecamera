// -----------------------------------------------------------------------------
// HTTP client of one camera running the yi-hack firmware.
//
// The stock Yi Home firmware has no local API: everything goes through the Yi
// cloud and its peer-to-peer video, which nobody outside Yi can use. The
// community firmwares yi-hack-MStar, yi-hack-Allwinner, yi-hack-Allwinner-v2
// and yi-hack-v5 add a small web server on the camera, with the same CGI
// scripts on all of them. This client only uses those scripts:
//
//   GET /cgi-bin/status.json                    hostname, model, MAC, Wi-Fi…
//   GET /cgi-bin/get_configs.sh?conf=camera     SWITCH_ON, LED, IR… ("yes"/"no")
//   GET /cgi-bin/get_configs.sh?conf=ptz_presets  "0": "name,x,y"…
//   GET /cgi-bin/get_configs.sh?conf=mqtt       MQTT_PREFIX, topics, messages
//   GET /cgi-bin/camera_settings.sh?led=yes     change a setting
//   GET /cgi-bin/snapshot.sh?res=low            one JPEG frame
//   GET /cgi-bin/ptz.sh?dir=left                one PTZ step (stops by itself)
//   GET /cgi-bin/preset.sh?action=go_preset&num=2
//   GET /cgi-bin/getlastrecordedvideo.sh?type=1 "DIR/FILE.mp4" of the last clip
//   GET /cgi-bin/reboot.sh
//
// Every answer is plain HTTP on the LAN, protected (when the user set it up)
// by HTTP Basic authentication. Nothing here ever logs the password.
// -----------------------------------------------------------------------------

/** Kinds of failure, so callers can tell the user what to fix. */
export const YI_ERRORS = {
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
  AUTH: 'auth',
  HTTP: 'http',
  INVALID: 'invalid',
  REFUSED: 'refused',
};

export class YiError extends Error {
  /**
   * @param {string} code one of YI_ERRORS
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'YiError';
    this.code = code;
  }
}

/** Directions `ptz.sh` accepts for a step. */
export const PTZ_DIRECTIONS = ['left', 'right', 'up', 'down'];

/** Values `camera_settings.sh` accepts for the motion sensitivity. */
export const SENSITIVITIES = ['low', 'medium', 'high'];

const DEFAULT_TIMEOUT_MS = 10_000;
// A snapshot is a real capture on a small ARM board: give it more time.
const SNAPSHOT_TIMEOUT_MS = 15_000;

export class YiClient {
  /**
   * @param {object} options
   * @param {string} options.host `host` or `host:port`
   * @param {string} [options.username]
   * @param {string} [options.password]
   * @param {typeof fetch} [options.fetch] injected by the tests
   * @param {number} [options.timeoutMs]
   */
  constructor({ host, username = '', password = '', fetch: fetchImpl, timeoutMs } = {}) {
    this.host = host;
    this.baseUrl = `http://${host}`;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.authorization = username
      ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      : null;
  }

  /**
   * One GET on the camera. Resolves the Response, throws a YiError otherwise.
   * @param {string} path path and query string
   * @param {number} [timeoutMs]
   */
  async get(path, timeoutMs = this.timeoutMs) {
    const headers = {};
    if (this.authorization) {
      headers.Authorization = this.authorization;
    }
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new YiError(YI_ERRORS.TIMEOUT, `${this.host} did not answer within ${timeoutMs} ms`);
      }
      throw new YiError(
        YI_ERRORS.UNREACHABLE,
        `${this.host} is unreachable (${err?.cause?.code ?? err?.message ?? err})`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new YiError(
        YI_ERRORS.AUTH,
        `${this.host} refused the credentials (${response.status})`,
      );
    }
    if (!response.ok) {
      throw new YiError(YI_ERRORS.HTTP, `${this.host} answered HTTP ${response.status} on ${path}`);
    }
    return response;
  }

  /** GET a yi-hack JSON answer. */
  async getJson(path) {
    const response = await this.get(path);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new YiError(
        YI_ERRORS.INVALID,
        `${this.host} answered something that is not yi-hack JSON on ${path}`,
      );
    }
  }

  /** `status.json`: hostname, model_suffix, fw_version, mac_addr, ptz, wlan_strength… */
  async getStatus() {
    const status = await this.getJson('/cgi-bin/status.json');
    if (!status || typeof status !== 'object' || !('fw_version' in status)) {
      throw new YiError(YI_ERRORS.INVALID, `${this.host} does not look like a yi-hack camera`);
    }
    return status;
  }

  /**
   * One configuration file of the camera, as an object of strings. The
   * script closes its JSON with a `"NULL": "NULL"` entry, dropped here.
   * @param {'camera'|'ptz_presets'|'mqtt'|'system'} name
   */
  async getConfig(name) {
    const config = await this.getJson(`/cgi-bin/get_configs.sh?conf=${encodeURIComponent(name)}`);
    if (config?.error === 'true') {
      throw new YiError(YI_ERRORS.REFUSED, `${this.host} refused to read its ${name} settings`);
    }
    const { NULL: _ignored, ...values } = config ?? {};
    return values;
  }

  /**
   * Change camera settings: `{ switch_on: 'no', led: 'yes' }`. The values are
   * the tokens the script accepts, never user input.
   * @param {Record<string, string>} settings
   */
  async setCameraSettings(settings) {
    const query = new URLSearchParams(settings).toString();
    const answer = await this.getJson(`/cgi-bin/camera_settings.sh?${query}`);
    if (answer?.error === 'true') {
      throw new YiError(YI_ERRORS.REFUSED, `${this.host} refused the settings ${query}`);
    }
  }

  /**
   * One JPEG frame.
   * @param {object} [options]
   * @param {'low'|'high'} [options.resolution]
   * @returns {Promise<Buffer>}
   */
  async snapshot({ resolution = 'low' } = {}) {
    const response = await this.get(
      `/cgi-bin/snapshot.sh?res=${resolution}&watermark=yes`,
      Math.max(this.timeoutMs, SNAPSHOT_TIMEOUT_MS),
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    // A JPEG starts with FF D8. Anything else is an error page (the script
    // answers its errors in JSON with a 200).
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      throw new YiError(YI_ERRORS.INVALID, `${this.host} did not send a JPEG image`);
    }
    return buffer;
  }

  /**
   * One PTZ step in a direction. The camera starts the motor, waits and stops
   * it by itself: nothing can leave it turning if the next order is lost.
   * @param {'left'|'right'|'up'|'down'} direction
   */
  async ptzStep(direction) {
    if (!PTZ_DIRECTIONS.includes(direction)) {
      throw new YiError(YI_ERRORS.INVALID, `Unknown PTZ direction "${direction}"`);
    }
    await this.get(`/cgi-bin/ptz.sh?dir=${direction}`);
  }

  /** Move to a saved preset (0 to 7). */
  async goToPreset(num) {
    const preset = Number(num);
    if (!Number.isInteger(preset) || preset < 0 || preset > 7) {
      throw new YiError(YI_ERRORS.INVALID, `Preset ${num} does not exist (0 to 7)`);
    }
    const answer = await this.getJson(`/cgi-bin/preset.sh?action=go_preset&num=${preset}`);
    if (answer?.error === 'true') {
      throw new YiError(YI_ERRORS.REFUSED, `${this.host} refused to go to preset ${preset}`);
    }
  }

  /**
   * Relative path of the last recorded clip (`2026Y11M22D10H/E1M05S00P60.mp4`),
   * null when the SD card holds none.
   */
  async lastRecording() {
    const response = await this.get('/cgi-bin/getlastrecordedvideo.sh?type=1');
    const text = (await response.text()).trim();
    return /\.mp4$/i.test(text) ? text : null;
  }

  async reboot() {
    await this.get('/cgi-bin/reboot.sh');
  }
}

/**
 * yi-hack presets file -> labeled list. Lines read `"3": "Door,120,40"`; an
 * empty slot reads `"3": ""`.
 * @param {Record<string, string>} raw get_configs.sh?conf=ptz_presets
 * @returns {{ num: number, name: string }[]}
 */
export function parsePresets(raw = {}) {
  const presets = [];
  for (const [key, value] of Object.entries(raw)) {
    const num = Number(key);
    if (!Number.isInteger(num) || num < 0 || num > 7) {
      continue;
    }
    const name = String(value ?? '')
      .split(',')[0]
      .trim();
    if (name) {
      presets.push({ num, name });
    }
  }
  return presets.sort((a, b) => a.num - b.num);
}

/** "yes" -> 1, "no" -> 0, anything else -> null (setting unknown on this model). */
export function yesNo(value) {
  if (value === 'yes') {
    return 1;
  }
  if (value === 'no') {
    return 0;
  }
  return null;
}
