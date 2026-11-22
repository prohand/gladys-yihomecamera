// -----------------------------------------------------------------------------
// Buttons of the Configuration screen (manifest `actions`).
//
// Each handler resolves the multi-language message shown under the button.
// The device fields declare `"source": "devices"`: the screen lists the
// cameras the user created, and the handler receives the device external_id.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { testConnection } from './connection.js';
import { localize, pick, t } from './i18n.js';

const logger = createLogger({ name: 'actions' });

const UNKNOWN_CAMERA = t(
  'This camera is not in the configuration any more.',
  "Cette caméra n'est plus dans la configuration.",
  'Diese Kamera ist nicht mehr in der Konfiguration.',
  'Esta cámara ya no está en la configuración.',
);

function unreachable(camera) {
  return localize((language) =>
    pick(language, {
      en: `${camera.name ?? camera.host} does not answer: try "Test the connection".`,
      fr: `${camera.name ?? camera.host} ne répond pas : essayez « Tester la connexion ».`,
      de: `${camera.name ?? camera.host} antwortet nicht: „Verbindung testen“ ausprobieren.`,
      es: `${camera.name ?? camera.host} no responde: pruebe «Probar la conexión».`,
    }),
  );
}

/** Run `work` on the camera of a device field, or say why it cannot be done. */
async function withCamera(manager, fields, work) {
  const camera = manager.byDeviceExternalId(fields.device);
  if (!camera) {
    return UNKNOWN_CAMERA;
  }
  if (camera.online !== true) {
    return unreachable(camera);
  }
  try {
    return await work(camera);
  } catch (err) {
    logger.warn(`${camera.host}: ${err.message}`);
    return unreachable(camera);
  }
}

export const ACTIONS = {
  test_connection: (manager) => testConnection(manager),

  identify: (manager, fields) =>
    withCamera(manager, fields, async (camera) => {
      await manager.identify(camera);
      return localize((language) =>
        pick(language, {
          en: `The LED of ${camera.name} blinked three times.`,
          fr: `La LED de ${camera.name} a clignoté trois fois.`,
          de: `Die LED von ${camera.name} hat dreimal geblinkt.`,
          es: `El LED de ${camera.name} parpadeó tres veces.`,
        }),
      );
    }),

  reboot: (manager, fields) =>
    withCamera(manager, fields, async (camera) => {
      await manager.reboot(camera);
      return localize((language) =>
        pick(language, {
          en: `${camera.name} is rebooting, back in about a minute.`,
          fr: `${camera.name} redémarre, de retour dans une minute environ.`,
          de: `${camera.name} startet neu, in etwa einer Minute zurück.`,
          es: `${camera.name} se está reiniciando, vuelve en un minuto aproximadamente.`,
        }),
      );
    }),
};
