// -----------------------------------------------------------------------------
// The connection status shown in the Configuration screen, and the "Test the
// connection" report.
//
// Both are written for the person in front of the screen: which camera, what
// went wrong, and what to do about it — in their language.
// -----------------------------------------------------------------------------

import { YI_ERRORS } from './yi/client.js';
import { redactUrl } from './yi/mqtt.js';
import { localize, pick, t } from './i18n.js';

/** What to do about each kind of failure. */
const ADVICE = {
  [YI_ERRORS.AUTH]: t(
    'wrong user name or password (yi-hack web interface)',
    "nom d'utilisateur ou mot de passe incorrect (interface web yi-hack)",
    'falscher Benutzername oder falsches Passwort (yi-hack-Weboberfläche)',
    'usuario o contraseña incorrectos (interfaz web de yi-hack)',
  ),
  [YI_ERRORS.TIMEOUT]: t(
    'no answer in time: is the camera powered and on the network?',
    'pas de réponse à temps : la caméra est-elle alimentée et sur le réseau ?',
    'keine Antwort: Ist die Kamera eingeschaltet und im Netzwerk?',
    'sin respuesta a tiempo: ¿la cámara está encendida y en la red?',
  ),
  [YI_ERRORS.UNREACHABLE]: t(
    'unreachable: check the address and that the camera is on',
    "injoignable : vérifiez l'adresse et que la caméra est allumée",
    'nicht erreichbar: Adresse prüfen und ob die Kamera eingeschaltet ist',
    'inaccesible: compruebe la dirección y que la cámara esté encendida',
  ),
  [YI_ERRORS.INVALID]: t(
    'answers, but is not a camera with the yi-hack firmware',
    "répond, mais ce n'est pas une caméra avec le firmware yi-hack",
    'antwortet, ist aber keine Kamera mit der yi-hack-Firmware',
    'responde, pero no es una cámara con el firmware yi-hack',
  ),
  [YI_ERRORS.HTTP]: t(
    'the web server of the camera answered with an error',
    'le serveur web de la caméra a répondu par une erreur',
    'der Webserver der Kamera hat mit einem Fehler geantwortet',
    'el servidor web de la cámara respondió con un error',
  ),
  [YI_ERRORS.REFUSED]: t(
    'the camera refused the request',
    'la caméra a refusé la demande',
    'die Kamera hat die Anfrage abgelehnt',
    'la cámara rechazó la solicitud',
  ),
};

function advice(error) {
  return ADVICE[error?.code] ?? ADVICE[YI_ERRORS.UNREACHABLE];
}

/**
 * The status of the Configuration screen: connected as soon as one camera
 * answers, with the list of the ones that do not.
 *
 * @param {import('./cameras.js').CameraManager} manager
 * @returns {{ connected: boolean, message?: Record<string, string> }}
 */
export function connectionStatus(manager) {
  const cameras = manager.list();
  if (cameras.length === 0) {
    return {
      connected: false,
      message: t(
        'Type the address of at least one camera in the configuration.',
        "Indiquez l'adresse d'au moins une caméra dans la configuration.",
        'Gib in der Konfiguration die Adresse mindestens einer Kamera ein.',
        'Indique la dirección de al menos una cámara en la configuración.',
      ),
    };
  }
  const down = cameras.filter((camera) => camera.online === false);
  if (down.length === 0) {
    return { connected: true };
  }
  const list = down.map((camera) => camera.host).join(', ');
  if (down.length === cameras.length) {
    return {
      connected: false,
      message: localize((language) =>
        pick(language, {
          en: `No camera answers (${list}): ${pick('en', advice(down[0].error))}.`,
          fr: `Aucune caméra ne répond (${list}) : ${pick('fr', advice(down[0].error))}.`,
          de: `Keine Kamera antwortet (${list}): ${pick('de', advice(down[0].error))}.`,
          es: `Ninguna cámara responde (${list}): ${pick('es', advice(down[0].error))}.`,
        }),
      ),
    };
  }
  return {
    connected: true,
    message: localize((language) =>
      pick(language, {
        en: `Not answering: ${list}.`,
        fr: `Ne répondent pas : ${list}.`,
        de: `Antworten nicht: ${list}.`,
        es: `No responden: ${list}.`,
      }),
    ),
  };
}

/** Publish the status of the Configuration screen. */
export async function reportConnectionStatus(manager) {
  const { connected, message } = connectionStatus(manager);
  await manager.gladys.setConnectionStatus(connected, message);
}

function cameraLine(camera, language) {
  if (camera.online) {
    const details = [camera.model, camera.firmware && `yi-hack ${camera.firmware}`]
      .filter(Boolean)
      .join(', ');
    const ptz = camera.ptz
      ? pick(language, {
          en: `, PTZ, ${camera.presets.length} preset(s)`,
          fr: `, motorisée, ${camera.presets.length} position(s) enregistrée(s)`,
          de: `, schwenkbar, ${camera.presets.length} Position(en)`,
          es: `, motorizada, ${camera.presets.length} posición(es)`,
        })
      : '';
    return `✓ ${camera.host} — ${camera.name} (${details}${ptz})`;
  }
  return `✗ ${camera.host} — ${pick(language, advice(camera.error))}`;
}

function motionLine(manager, camera, language) {
  if (!camera.online) {
    return null;
  }
  if (manager.mqttActive(camera)) {
    return pick(language, {
      en: `   motion: MQTT, real time (prefix ${camera.mqttTopics.prefix})`,
      fr: `   mouvement : MQTT, en temps réel (préfixe ${camera.mqttTopics.prefix})`,
      de: `   Bewegung: MQTT, in Echtzeit (Präfix ${camera.mqttTopics.prefix})`,
      es: `   movimiento: MQTT, en tiempo real (prefijo ${camera.mqttTopics.prefix})`,
    });
  }
  if (manager.mqttClashes.includes(camera.host)) {
    return pick(language, {
      en: '   motion: MQTT prefix already used by another camera, give each camera its own',
      fr: '   mouvement : préfixe MQTT déjà pris par une autre caméra, donnez-en un à chacune',
      de: '   Bewegung: MQTT-Präfix schon von einer anderen Kamera belegt, jeder Kamera ein eigenes geben',
      es: '   movimiento: prefijo MQTT ya usado por otra cámara, dé uno propio a cada cámara',
    });
  }
  if (camera.settings?.SAVE_VIDEO_ON_MOTION === 'yes') {
    return pick(language, {
      en: '   motion: from the recordings (up to a minute late; MQTT is faster)',
      fr: "   mouvement : d'après les enregistrements (jusqu'à une minute de retard ; MQTT est plus rapide)",
      de: '   Bewegung: aus den Aufnahmen (bis zu einer Minute Verzögerung; MQTT ist schneller)',
      es: '   movimiento: a partir de las grabaciones (hasta un minuto de retraso; MQTT es más rápido)',
    });
  }
  return pick(language, {
    en: '   motion: not detected — turn on "Save video on motion" on the camera, or set up MQTT',
    fr: '   mouvement : non détecté — activez « Enregistrer sur mouvement » sur la caméra, ou configurez MQTT',
    de: '   Bewegung: nicht erkannt — „Video bei Bewegung speichern“ an der Kamera einschalten oder MQTT einrichten',
    es: '   movimiento: no detectado — active «Guardar vídeo con movimiento» en la cámara, o configure MQTT',
  });
}

function mqttLine(manager, language) {
  const { mqtt_url: url } = manager.config;
  if (!url) {
    return null;
  }
  const safe = redactUrl(url);
  if (manager.mqtt?.connected) {
    return pick(language, {
      en: `MQTT broker ${safe}: connected`,
      fr: `Broker MQTT ${safe} : connecté`,
      de: `MQTT-Broker ${safe}: verbunden`,
      es: `Broker MQTT ${safe}: conectado`,
    });
  }
  const reason = manager.mqtt?.lastError ? ` (${manager.mqtt.lastError})` : '';
  return pick(language, {
    en: `MQTT broker ${safe}: not connected${reason}`,
    fr: `Broker MQTT ${safe} : non connecté${reason}`,
    de: `MQTT-Broker ${safe}: nicht verbunden${reason}`,
    es: `Broker MQTT ${safe}: no conectado${reason}`,
  });
}

/**
 * The "Test the connection" action: re-read every camera (presets and MQTT
 * topics included), publish the result, and say what was found.
 *
 * @param {import('./cameras.js').CameraManager} manager
 */
export async function testConnection(manager) {
  const cameras = manager.list();
  if (cameras.length === 0) {
    return connectionStatus(manager).message;
  }
  await manager.refreshAll({ full: true });
  await reportConnectionStatus(manager);
  return localize((language) =>
    [
      ...cameras.flatMap((camera) => [
        cameraLine(camera, language),
        motionLine(manager, camera, language),
      ]),
      mqttLine(manager, language),
    ]
      .filter(Boolean)
      .join('\n'),
  );
}
