// -----------------------------------------------------------------------------
// What the integration remembers about each camera between two restarts.
//
// A camera's external id is built from its MAC address, which only the camera
// itself can tell. A camera that is unplugged when the integration starts
// would otherwise vanish from the discovery list — and its transport badge
// could not say "unreachable". So the identity read on the last successful
// contact (id, name, model, PTZ, presets) is kept in /data/cameras.json, the
// one writable path of the container, keyed by the address the user typed.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

/** The writable volume of the container; overridable for the tests. */
export const DATA_DIR = process.env.YI_DATA_DIR || '/data';

const IDENTITY_KEYS = ['id', 'name', 'model', 'firmware', 'ptz', 'presets'];

/**
 * @param {object} [options]
 * @param {string} [options.dir] directory of cameras.json
 */
export function createIdentityStore({ dir = DATA_DIR } = {}) {
  const file = join(dir, 'cameras.json');
  let identities = {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      identities = parsed;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn(`Could not read ${file}, starting from scratch: ${err.message}`);
    }
  }

  function save() {
    try {
      mkdirSync(dir, { recursive: true });
      // Write then rename: a container stopped mid-write never leaves half a
      // JSON file behind.
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(identities, null, 2)}\n`);
      renameSync(tmp, file);
    } catch (err) {
      logger.warn(`Could not write ${file}: ${err.message}`);
    }
  }

  return {
    /** The identity last seen at this address, or null. */
    get(host) {
      return identities[host] ?? null;
    },

    /** Remember an identity; written only when something changed. */
    set(host, identity) {
      const next = Object.fromEntries(
        IDENTITY_KEYS.filter((key) => identity[key] !== undefined).map((key) => [
          key,
          identity[key],
        ]),
      );
      if (JSON.stringify(identities[host]) === JSON.stringify(next)) {
        return;
      }
      identities[host] = next;
      save();
    },
  };
}
