// -----------------------------------------------------------------------------
// A fake network of yi-hack cameras, behind an injected `fetch`.
//
// Each camera answers the CGI scripts the integration uses, the way yi-hack
// does (JSON of strings, `"NULL": "NULL"` closing get_configs, `error: "true"`
// on a refused request, a JPEG on snapshot.sh). No socket is opened: the tests
// never touch the network.
// -----------------------------------------------------------------------------

/** A minimal valid-looking JPEG of `size` bytes (starts with FF D8, ends FF D9). */
export function jpeg(size = 2048) {
  const buffer = Buffer.alloc(size, 0x11);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xe0;
  buffer[size - 2] = 0xff;
  buffer[size - 1] = 0xd9;
  return buffer;
}

const SETTING_KEYS = {
  switch_on: 'SWITCH_ON',
  led: 'LED',
  ir: 'IR',
  sensitivity: 'SENSITIVITY',
  save_video_on_motion: 'SAVE_VIDEO_ON_MOTION',
};

/**
 * @param {Record<string, object>} defs host -> overrides of the camera state
 */
export function createFakeCameras(defs = {}) {
  const cameras = new Map();
  const calls = [];

  const add = (host, overrides = {}) => {
    const index = cameras.size + 1;
    const camera = {
      reachable: true,
      auth: null,
      status: {
        name: 'yi-hack-allwinner-v2',
        hostname: `cam${index}`,
        fw_version: '0.4.1',
        home_version: '12.2.1',
        model_suffix: 'y623',
        ptz: 'no',
        serial_number: `SN0000000000000000${index}`,
        mac_addr: `AA:BB:CC:DD:EE:0${index}`,
        wlan_strength: '49',
        free_sd: '63%',
        local_ip: host,
        ...overrides.status,
      },
      settings: {
        SWITCH_ON: 'yes',
        SAVE_VIDEO_ON_MOTION: 'yes',
        SENSITIVITY: 'low',
        LED: 'no',
        IR: 'yes',
        ...overrides.settings,
      },
      presets: { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '', 6: '', 7: '', ...overrides.presets },
      mqtt: { MQTT_IP: '192.168.1.10', MQTT_PASSWORD: 'broker-secret', ...overrides.mqtt },
      lastRecording: overrides.lastRecording ?? '2026Y11M22D10H/E1M00S00P60.mp4',
      lowJpeg: overrides.lowJpeg ?? jpeg(4000),
      highJpeg: overrides.highJpeg ?? jpeg(20000),
      ptzMoves: [],
      presetsVisited: [],
      reboots: 0,
      ...overrides.extra,
    };
    if (overrides.reachable === false) {
      camera.reachable = false;
    }
    if (overrides.auth) {
      camera.auth = overrides.auth;
    }
    cameras.set(host, camera);
    return camera;
  };

  for (const [host, overrides] of Object.entries(defs)) {
    add(host, overrides);
  }

  const json = (body) =>
    new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

  async function fetch(url, { headers = {} } = {}) {
    const parsed = new URL(url);
    const host = parsed.host;
    calls.push({ host, path: parsed.pathname, query: Object.fromEntries(parsed.searchParams) });
    const camera = cameras.get(host);
    if (!camera || !camera.reachable) {
      throw new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
    }
    if (camera.auth) {
      const expected = `Basic ${Buffer.from(`${camera.auth.user}:${camera.auth.pass}`).toString('base64')}`;
      if (headers.Authorization !== expected) {
        return new Response('Unauthorized', { status: 401 });
      }
    }
    const query = Object.fromEntries(parsed.searchParams);
    switch (parsed.pathname) {
      case '/cgi-bin/status.json':
        return json(camera.status);
      case '/cgi-bin/get_configs.sh': {
        const source = { camera: camera.settings, ptz_presets: camera.presets, mqtt: camera.mqtt }[
          query.conf
        ];
        return source ? json({ ...source, NULL: 'NULL' }) : json({ error: 'true' });
      }
      case '/cgi-bin/camera_settings.sh': {
        for (const [param, value] of Object.entries(query)) {
          if (SETTING_KEYS[param]) {
            camera.settings[SETTING_KEYS[param]] = value;
          }
        }
        return json({ error: 'false' });
      }
      case '/cgi-bin/snapshot.sh':
        return new Response(query.res === 'high' ? camera.highJpeg : camera.lowJpeg, {
          headers: { 'Content-Type': 'image/jpeg' },
        });
      case '/cgi-bin/ptz.sh':
        camera.ptzMoves.push(query.dir);
        return new Response('', { headers: { 'Content-Type': 'application/json' } });
      case '/cgi-bin/preset.sh':
        camera.presetsVisited.push(Number(query.num));
        return json({ error: 'false' });
      case '/cgi-bin/getlastrecordedvideo.sh':
        return new Response(`${camera.lastRecording}\n`, {
          headers: { 'Content-Type': 'text/plain' },
        });
      case '/cgi-bin/reboot.sh':
        camera.reboots += 1;
        return new Response('');
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  return { fetch, cameras, calls, add };
}

/** Timers driven by hand: `advance(ms)` runs what is due. */
export function createFakeClock(start = Date.parse('2026-11-22T10:00:00Z')) {
  let now = start;
  let nextId = 1;
  const pending = new Map();
  return {
    now: () => now,
    timers: {
      setTimeout(fn, ms) {
        const id = nextId++;
        pending.set(id, { fn, at: now + ms, every: null });
        return id;
      },
      clearTimeout(id) {
        pending.delete(id);
      },
      setInterval(fn, ms) {
        const id = nextId++;
        pending.set(id, { fn, at: now + ms, every: ms });
        return id;
      },
      clearInterval(id) {
        pending.delete(id);
      },
    },
    sleep: async () => {},
    /** Move the clock forward and run every timer that falls due. */
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) {
          break;
        }
        const [id, timer] = due;
        now = timer.at;
        if (timer.every) {
          timer.at += timer.every;
        } else {
          pending.delete(id);
        }
        await timer.fn();
      }
      now = target;
    },
    pending: () => pending.size,
  };
}

/** An identity store in memory. */
export function createMemoryStore(initial = {}) {
  const identities = structuredClone(initial);
  return {
    identities,
    get: (host) => identities[host] ?? null,
    set: (host, identity) => {
      identities[host] = {
        id: identity.id,
        name: identity.name,
        model: identity.model,
        firmware: identity.firmware,
        ptz: identity.ptz,
        presets: identity.presets,
      };
    },
  };
}

/** A fake mqtt.connect: an EventEmitter-like client the test drives. */
export function createFakeMqtt() {
  const clients = [];
  function connect(url, options) {
    const handlers = {};
    const client = {
      url,
      options,
      subscribed: new Set(),
      ended: false,
      on(event, handler) {
        (handlers[event] ??= []).push(handler);
        return client;
      },
      emit(event, ...args) {
        for (const handler of handlers[event] ?? []) {
          handler(...args);
        }
      },
      subscribe(topics, _options, callback) {
        for (const topic of [].concat(topics)) {
          client.subscribed.add(topic);
        }
        callback?.(null);
      },
      unsubscribe(topics) {
        for (const topic of [].concat(topics)) {
          client.subscribed.delete(topic);
        }
      },
      end(_force, _options, callback) {
        client.ended = true;
        callback?.();
      },
      /** Simulate a message from the broker. */
      publish(topic, message) {
        client.emit('message', topic, Buffer.from(message));
      },
    };
    clients.push(client);
    return client;
  }
  return { connect, clients };
}
