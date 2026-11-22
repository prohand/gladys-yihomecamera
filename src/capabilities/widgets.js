// -----------------------------------------------------------------------------
// Dashboard widgets (SDK v0.14+, Gladys 5.1+).
//
// Two widgets, declared in the manifest `widgets` field:
//
//   yi_camera   one camera (picked in the widget settings): its last snapshot,
//               its state, and buttons — snapshot, on/off, preset, reboot;
//   yi_cameras  every camera at a glance: online, off, motion.
//
// The content is declarative (`image`, `status`, `button`, `text`…): the core
// renders it with its own theme, dark mode and translations. Button `params`
// are written HERE and sent back as they are, never typed by a user (a
// dashboard can hang on a public wall); the preset form is the one exception,
// and its value is checked before use.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { localize, pick, t } from '../i18n.js';
import { FEATURES, signalPercent } from '../devices/camera.js';
import { isOff } from '../cameras.js';

const logger = createLogger({ name: 'widgets' });

export const WIDGET_KEYS = {
  CAMERA: 'yi_camera',
  CAMERAS: 'yi_cameras',
};

const ACTIONS = {
  SNAPSHOT: 'snapshot',
  POWER: 'power',
  PRESET: 'preset',
  REBOOT: 'reboot',
  REFRESH: 'refresh',
};

const DETECTION_LABELS = {
  motion: t('motion', 'mouvement', 'Bewegung', 'movimiento'),
  human: t('person', 'personne', 'Person', 'persona'),
  vehicle: t('vehicle', 'véhicule', 'Fahrzeug', 'vehículo'),
  animal: t('animal', 'animal', 'Tier', 'animal'),
};

/** "just now", "5 min ago", "3 h ago"… in every language. */
export function ago(now, at) {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) {
    return t('just now', "à l'instant", 'gerade eben', 'ahora mismo');
  }
  if (minutes < 60) {
    return localize((language) =>
      pick(language, {
        en: `${minutes} min ago`,
        fr: `il y a ${minutes} min`,
        de: `vor ${minutes} Min.`,
        es: `hace ${minutes} min`,
      }),
    );
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return localize((language) =>
      pick(language, {
        en: `${hours} h ago`,
        fr: `il y a ${hours} h`,
        de: `vor ${hours} Std.`,
        es: `hace ${hours} h`,
      }),
    );
  }
  const days = Math.floor(hours / 24);
  return localize((language) =>
    pick(language, {
      en: `${days} days ago`,
      fr: `il y a ${days} jours`,
      de: `vor ${days} Tagen`,
      es: `hace ${days} días`,
    }),
  );
}

/** A status value cut to the 40 characters the core keeps. */
function short(text, max = 40) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function connectionRow(camera) {
  return camera.online
    ? {
        label: t('Connection', 'Connexion', 'Verbindung', 'Conexión'),
        icon: 'wifi',
        value: t('Online', 'En ligne', 'Online', 'En línea'),
        color: WIDGET_COLORS.SUCCESS,
      }
    : {
        label: t('Connection', 'Connexion', 'Verbindung', 'Conexión'),
        icon: 'wifi-off',
        value: t('Unreachable', 'Injoignable', 'Nicht erreichbar', 'Inaccesible'),
        color: WIDGET_COLORS.DANGER,
      };
}

function motionRow(manager, camera) {
  const label = t('Motion', 'Mouvement', 'Bewegung', 'Movimiento');
  if (camera.motion === 1) {
    const what = DETECTION_LABELS[camera.lastMotion?.detection] ?? DETECTION_LABELS.motion;
    return {
      label,
      icon: 'alert-triangle',
      value: localize((language) =>
        pick(language, {
          en: `Now (${pick('en', what)})`,
          fr: `En cours (${pick('fr', what)})`,
          de: `Jetzt (${pick('de', what)})`,
          es: `Ahora (${pick('es', what)})`,
        }),
      ),
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (camera.lastMotion) {
    return {
      label,
      icon: 'activity',
      value: ago(manager.now(), camera.lastMotion.at),
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  return {
    label,
    icon: 'activity',
    value: t('None yet', 'Aucun pour le moment', 'Noch keine', 'Ninguno por ahora'),
    color: WIDGET_COLORS.NEUTRAL,
  };
}

function cameraRows(manager, camera) {
  const rows = [connectionRow(camera)];
  if (!camera.online) {
    return rows;
  }
  rows.push(
    isOff(camera)
      ? {
          label: t('Camera', 'Caméra', 'Kamera', 'Cámara'),
          icon: 'eye-off',
          value: t(
            'Off (privacy)',
            'Éteinte (vie privée)',
            'Aus (Privatsphäre)',
            'Apagada (privacidad)',
          ),
          color: WIDGET_COLORS.WARNING,
        }
      : {
          label: t('Camera', 'Caméra', 'Kamera', 'Cámara'),
          icon: 'eye',
          value: t('On', 'Allumée', 'An', 'Encendida'),
          color: WIDGET_COLORS.SUCCESS,
        },
    motionRow(manager, camera),
  );
  const signal = signalPercent(camera.status);
  if (signal !== null) {
    rows.push({
      label: t('Wi-Fi signal', 'Signal Wi-Fi', 'WLAN-Signal', 'Señal Wi-Fi'),
      icon: 'bar-chart-2',
      value: `${signal} %`,
      color: signal >= 40 ? WIDGET_COLORS.NEUTRAL : WIDGET_COLORS.WARNING,
    });
  }
  const freeSd = String(camera.status?.free_sd ?? '');
  if (/^\d+%$/.test(freeSd)) {
    rows.push({
      label: t('SD card free', 'Carte SD libre', 'SD-Karte frei', 'Tarjeta SD libre'),
      icon: 'hard-drive',
      value: freeSd.replace('%', ' %'),
      color: Number.parseInt(freeSd, 10) < 10 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (camera.firmware) {
    rows.push({
      label: t('Firmware', 'Firmware', 'Firmware', 'Firmware'),
      icon: 'cpu',
      value: short(`yi-hack ${camera.firmware}`),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  return rows;
}

function cameraButtons(camera) {
  const params = { device: camera.deviceExternalId };
  const buttons = [];
  if (!camera.online) {
    return buttons;
  }
  if (!isOff(camera)) {
    buttons.push({
      type: 'button',
      label: t('Snapshot', 'Photo', 'Schnappschuss', 'Captura'),
      icon: 'camera',
      style: 'primary',
      action: { key: ACTIONS.SNAPSHOT, params },
    });
  }
  buttons.push({
    type: 'button',
    label: isOff(camera)
      ? t('Turn on', 'Allumer', 'Einschalten', 'Encender')
      : t('Turn off', 'Éteindre', 'Ausschalten', 'Apagar'),
    icon: isOff(camera) ? 'eye' : 'eye-off',
    style: 'secondary',
    action: { key: ACTIONS.POWER, params: { ...params, on: isOff(camera) ? 1 : 0 } },
  });
  if (camera.ptz && camera.presets.length > 0) {
    buttons.push({
      type: 'button',
      label: t('Go to preset', 'Aller à une position', 'Position anfahren', 'Ir a posición'),
      icon: 'crosshair',
      style: 'secondary',
      action: {
        key: ACTIONS.PRESET,
        params,
        fields: [
          {
            key: 'preset',
            type: 'select',
            label: t('Preset', 'Position', 'Position', 'Posición'),
            required: true,
            // Option values of a widget form are strings; read back with Number().
            options: camera.presets.map(({ num, name }) => ({
              value: String(num),
              label: { en: short(name), fr: short(name), de: short(name), es: short(name) },
            })),
          },
        ],
      },
    });
  }
  buttons.push({
    type: 'button',
    label: t('Reboot', 'Redémarrer', 'Neustart', 'Reiniciar'),
    icon: 'refresh-cw',
    style: 'danger',
    action: { key: ACTIONS.REBOOT, params, confirm: true },
  });
  return buttons;
}

/** The camera a widget instance is bound to, null when none / unknown. */
function boundCamera(manager, settings) {
  return settings?.device ? (manager.byDeviceExternalId(settings.device) ?? null) : null;
}

function ttl(manager) {
  const { snapshot_interval: interval } = manager.config;
  return interval > 0 ? Math.min(3600, Math.max(30, interval)) : 300;
}

export const WIDGETS = {
  [WIDGET_KEYS.CAMERA]: {
    async get(manager, { settings }) {
      const camera = boundCamera(manager, settings);
      if (!camera) {
        return {
          ttl_seconds: 300,
          components: [
            {
              type: 'text',
              text: t(
                'Pick a camera in the settings of this widget.',
                'Choisissez une caméra dans les réglages de ce widget.',
                'Wähle in den Einstellungen dieses Widgets eine Kamera aus.',
                'Elija una cámara en los ajustes de este widget.',
              ),
            },
          ],
        };
      }
      const components = [];
      if (camera.snapshot) {
        components.push({
          type: 'image',
          key: camera.snapshot.key,
          alt: short(camera.name ?? camera.host, 100),
          fit: 'cover',
        });
      }
      components.push({ type: 'status', items: cameraRows(manager, camera) });
      components.push(
        ...cameraButtons({ ...camera, deviceExternalId: settings.device }).slice(0, 4),
      );
      return { ttl_seconds: ttl(manager), components };
    },

    async action(manager, { actionKey, params, values }) {
      const camera = manager.byDeviceExternalId(params?.device);
      if (!camera) {
        throw new Error('Unknown camera');
      }
      logger.info(`Widget action ${actionKey} on ${camera.host}`);
      switch (actionKey) {
        case ACTIONS.SNAPSHOT:
          await manager.capture(camera, { publish: true });
          return t('Snapshot taken.', 'Photo prise.', 'Schnappschuss erstellt.', 'Captura hecha.');
        case ACTIONS.POWER:
          await manager.setValue(camera, FEATURES.ENABLED, params.on ? 1 : 0);
          return params.on
            ? t(
                'Camera turned on.',
                'Caméra allumée.',
                'Kamera eingeschaltet.',
                'Cámara encendida.',
              )
            : t(
                'Camera turned off.',
                'Caméra éteinte.',
                'Kamera ausgeschaltet.',
                'Cámara apagada.',
              );
        case ACTIONS.PRESET: {
          const preset = Number(values?.preset);
          if (!camera.presets.some(({ num }) => num === preset)) {
            throw new Error('Unknown preset');
          }
          await camera.client.goToPreset(preset);
          return t('On its way.', 'En route.', 'Unterwegs.', 'En camino.');
        }
        case ACTIONS.REBOOT:
          await manager.reboot(camera);
          return t(
            'Rebooting, back in about a minute.',
            'Redémarrage, de retour dans une minute environ.',
            'Neustart, in etwa einer Minute zurück.',
            'Reiniciando, vuelve en un minuto aproximadamente.',
          );
        default:
          throw new Error(`Unknown widget action: ${actionKey}`);
      }
    },
  },

  [WIDGET_KEYS.CAMERAS]: {
    async get(manager) {
      const cameras = manager.list();
      if (cameras.length === 0) {
        return {
          ttl_seconds: 300,
          components: [
            {
              type: 'text',
              text: t(
                'No camera configured yet.',
                'Aucune caméra configurée pour le moment.',
                'Noch keine Kamera konfiguriert.',
                'Todavía no hay ninguna cámara configurada.',
              ),
            },
          ],
        };
      }
      const online = cameras.filter((camera) => camera.online).length;
      return {
        ttl_seconds: 300,
        components: [
          {
            type: 'text',
            variant: 'heading',
            text: localize((language) =>
              pick(language, {
                en: `${online} / ${cameras.length} cameras online`,
                fr: `${online} / ${cameras.length} caméras en ligne`,
                de: `${online} / ${cameras.length} Kameras online`,
                es: `${online} / ${cameras.length} cámaras en línea`,
              }),
            ),
          },
          {
            type: 'status',
            items: cameras.slice(0, 10).map((camera) => overviewRow(manager, camera)),
          },
          {
            type: 'button',
            label: t('Refresh', 'Actualiser', 'Aktualisieren', 'Actualizar'),
            icon: 'refresh-cw',
            style: 'secondary',
            action: { key: ACTIONS.REFRESH },
          },
        ],
      };
    },

    async action(manager, { actionKey }) {
      if (actionKey !== ACTIONS.REFRESH) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      await manager.refreshAll();
      return t(
        'Cameras refreshed.',
        'Caméras actualisées.',
        'Kameras aktualisiert.',
        'Cámaras actualizadas.',
      );
    },
  },
};

function overviewRow(manager, camera) {
  const label = short(camera.name ?? camera.host);
  if (!camera.online) {
    return {
      label,
      icon: 'wifi-off',
      value:
        camera.online === null
          ? t('Not read yet', 'Pas encore lue', 'Noch nicht gelesen', 'Aún no leída')
          : t('Unreachable', 'Injoignable', 'Nicht erreichbar', 'Inaccesible'),
      color: camera.online === null ? WIDGET_COLORS.NEUTRAL : WIDGET_COLORS.DANGER,
    };
  }
  if (isOff(camera)) {
    return {
      label,
      icon: 'eye-off',
      value: t(
        'Off (privacy)',
        'Éteinte (vie privée)',
        'Aus (Privatsphäre)',
        'Apagada (privacidad)',
      ),
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (camera.motion === 1) {
    return { label, ...motionRow(manager, camera), icon: 'alert-triangle' };
  }
  return {
    label,
    icon: 'video',
    value: t('On', 'Allumée', 'An', 'Encendida'),
    color: WIDGET_COLORS.SUCCESS,
  };
}

/**
 * The raw base64 of a snapshot image key (onWidgetGetImage). Gladys caches it
 * one hour by key; the key changes with every new frame.
 */
export function widgetImage(manager, key) {
  const camera = manager.list().find((candidate) => candidate.snapshot?.key === key);
  if (!camera) {
    throw new Error(`Image ${key} is no longer available`);
  }
  return camera.snapshot.buffer.toString('base64');
}

/** Ask the core to re-pull every widget now (rate-limited core-side). */
export function refreshWidgets(gladys) {
  for (const key of Object.values(WIDGET_KEYS)) {
    gladys.requestWidgetRefresh(key);
  }
}
