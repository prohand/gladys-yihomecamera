// -----------------------------------------------------------------------------
// The integration, wired to the SDK.
//
// `createApp({ gladys })` registers every handler on the SDK instance it is
// given — before connect(), as the SDK requires — and owns the three timers:
//
//   refresh     read every camera at the configured interval
//   snapshots   push a snapshot of every camera (when the interval is not 0)
//   recordings  without MQTT, look for new clips every 10 s (motion)
//
// index.js passes the real SDK; the tests pass the SDK's fake Gladys
// (`createFakeGladys`) and drive the timers by hand.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { CameraManager, isOff } from './cameras.js';
import { createIdentityStore } from './store.js';
import { featureKeyOf } from './devices/camera.js';
import { ACTIONS } from './actions.js';
import { connectionStatus } from './connection.js';
import { SCENE_ACTIONS } from './capabilities/scenes.js';
import { WIDGETS, refreshWidgets, widgetImage } from './capabilities/widgets.js';

const logger = createLogger({ name: 'app' });

/** How often the recordings are looked at when motion does not come over MQTT. */
export const RECORDINGS_INTERVAL_MS = 10_000;

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the fake one)
 * @param {object} [options.store] identity store, /data/cameras.json by default
 * @param {typeof fetch} [options.fetch]
 * @param {Function} [options.connectMqtt]
 * @param {{ setInterval: Function, clearInterval: Function, setTimeout: Function, clearTimeout: Function }} [options.timers]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.now]
 */
export function createApp({ gladys, store, fetch, connectMqtt, timers, sleep, now }) {
  const clock = timers ?? { setInterval, clearInterval, setTimeout, clearTimeout };
  const manager = new CameraManager({
    gladys,
    store: store ?? createIdentityStore(),
    fetch,
    connectMqtt,
    timers: clock,
    sleep,
    now,
  });
  // Every change a widget shows (motion, snapshot, online…) nudges the
  // dashboards: fire-and-forget, rate-limited by the core.
  manager.onChange = () => refreshWidgets(gladys);

  let intervals = [];
  let lastStatus = '';

  /** One run at a time per task: a slow camera never piles up requests. */
  function task(name, work) {
    let running = false;
    return async () => {
      if (running) {
        return;
      }
      running = true;
      try {
        await work();
      } catch (err) {
        logger.error(`${name} failed`, err);
      } finally {
        running = false;
      }
    };
  }

  async function reportStatus() {
    const status = connectionStatus(manager);
    const key = JSON.stringify(status);
    if (key !== lastStatus) {
      await gladys.setConnectionStatus(status.connected, status.message);
      lastStatus = key;
    }
  }

  const tasks = {
    refresh: task('Refresh', async () => {
      await manager.refreshAll();
      await reportStatus();
    }),
    snapshots: task('Snapshots', () => manager.pushSnapshots()),
    recordings: task('Recordings', () => manager.checkRecordings()),
  };

  function stopTimers() {
    for (const interval of intervals) {
      clock.clearInterval(interval);
    }
    intervals = [];
  }

  function startTimers(config) {
    stopTimers();
    intervals.push(clock.setInterval(tasks.refresh, config.poll_frequency * 1000));
    intervals.push(clock.setInterval(tasks.recordings, RECORDINGS_INTERVAL_MS));
    if (config.snapshot_interval > 0) {
      intervals.push(clock.setInterval(tasks.snapshots, config.snapshot_interval * 1000));
    }
  }

  /** (Re)start everything from a configuration. */
  async function apply(config) {
    stopTimers();
    manager.configure(config);
    // Always re-published once on (re)connection and config change: the list
    // is an upsert by external_id, and it refreshes the host/firmware params.
    manager.discoverySignature = '';
    await manager.refreshAll({ full: true });
    lastStatus = '';
    await reportStatus();
    startTimers(config);
    if (config.snapshot_interval > 0) {
      // The first snapshots without waiting a whole interval; not awaited, a
      // slow camera must not hold the connection handler.
      tasks.snapshots();
    }
  }

  // --- Discovery ------------------------------------------------------------
  gladys.onScanRequest(async () => {
    manager.discoverySignature = '';
    await manager.refreshAll({ full: true });
  });

  // --- Commands -------------------------------------------------------------
  gladys.onSetValue(async (device, feature, value) => {
    const camera = manager.byDeviceExternalId(device.external_id);
    const key = camera ? featureKeyOf(gladys, camera, feature.external_id) : null;
    if (!key) {
      // Throw: the SDK acks success:false to Gladys.
      throw new Error(`Unknown camera feature ${feature.external_id}`);
    }
    logger.info(`${camera.host}: ${key} <- ${value}`);
    await manager.setValue(camera, key, value);
  });

  // --- Fresh image (dashboard live view, chat "show me the camera") ---------
  gladys.onGetImage(async (device) => {
    const camera = manager.byDeviceExternalId(device.external_id);
    if (!camera) {
      throw new Error(`Unknown camera ${device.external_id}`);
    }
    if (isOff(camera)) {
      throw new Error(`${camera.name} is turned off`);
    }
    return manager.capture(camera);
  });

  // --- Configuration screen buttons -----------------------------------------
  for (const [key, handler] of Object.entries(ACTIONS)) {
    gladys.onAction(key, (fields) => handler(manager, fields ?? {}));
  }

  // --- Scene actions --------------------------------------------------------
  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => handler(manager, { fields: fields ?? {} }));
  }

  // --- Dashboard widgets ----------------------------------------------------
  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(manager, request ?? {}));
    gladys.onWidgetAction(key, (actionKey, params, { settings, values } = {}) =>
      widget.action(manager, { actionKey, params: params ?? {}, settings, values }),
    );
  }
  gladys.onWidgetGetImage(async (key) => widgetImage(manager, key));

  // --- Configuration --------------------------------------------------------
  gladys.onConfigUpdated(async (raw) => {
    logger.info('Configuration updated');
    await apply(normalizeConfig(raw));
  });

  // --- Connection lifecycle -------------------------------------------------
  gladys.on('connected', async () => {
    try {
      await apply(normalizeConfig(await gladys.getConfig()));
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
          de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Protokolle der Integration.',
          es: 'La inicialización ha fallado, consulte los registros de la integración.',
        })
        .catch(() => {});
    }
  });

  gladys.on('disconnected', () => stopTimers());

  return {
    manager,
    apply,
    tasks,
    async stop() {
      stopTimers();
      await manager.stop();
    },
  };
}
