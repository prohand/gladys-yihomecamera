// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+): what a scene can ask a camera.
//
// Each key is declared in the manifest `scene_actions` field and registered by
// index.js with `gladys.onSceneAction(key, ...)`. The handler receives the
// RESOLVED fields (a `"source": "devices"` field is the device external_id)
// and resolves the declared outputs.
//
// A scene action is never a condition: a camera that cannot do it is an
// output (`false`), not an error — the scene author gates on the output. And
// no action ever fires a scene event: a scene bound to that event would loop.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { SENSITIVITIES } from '../yi/client.js';
import { isOff } from '../cameras.js';

const logger = createLogger({ name: 'scenes' });

/** Run `work` on the camera of a device field; false when it cannot be done. */
async function onCamera(manager, fields, label, work) {
  const camera = manager.byDeviceExternalId(fields.device);
  if (!camera || camera.online !== true) {
    logger.info(`Scene action ${label}: camera ${fields.device} not available`);
    return false;
  }
  try {
    return (await work(camera)) !== false;
  } catch (err) {
    logger.warn(`Scene action ${label} on ${camera.host} failed: ${err.message}`);
    return false;
  }
}

export const SCENE_ACTIONS = {
  /** Push a fresh image to Gladys right now (e.g. before a notification). */
  async take_snapshot(manager, { fields }) {
    const captured = await onCamera(manager, fields, 'take_snapshot', async (camera) => {
      if (isOff(camera)) {
        return false;
      }
      await manager.capture(camera, { publish: true });
      return true;
    });
    return { captured };
  },

  /** Turn a PTZ camera to one of its saved positions. */
  async go_to_preset(manager, { fields }) {
    const moved = await onCamera(manager, fields, 'go_to_preset', async (camera) => {
      if (!camera.ptz) {
        return false;
      }
      await camera.client.goToPreset(Number(fields.preset));
      return true;
    });
    return { moved };
  },

  /** Change how sensitive the motion detection is. */
  async set_motion_sensitivity(manager, { fields }) {
    const applied = await onCamera(manager, fields, 'set_motion_sensitivity', async (camera) => {
      if (!SENSITIVITIES.includes(fields.sensitivity)) {
        return false;
      }
      await manager.setSensitivity(camera, fields.sensitivity);
      return true;
    });
    return { applied };
  },

  /** Restart the camera (it is back about a minute later). */
  async reboot_camera(manager, { fields }) {
    const rebooted = await onCamera(manager, fields, 'reboot_camera', async (camera) => {
      await manager.reboot(camera);
      return true;
    });
    return { rebooted };
  },
};
