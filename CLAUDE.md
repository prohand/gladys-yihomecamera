# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human
contributors when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step) for
**Yi Home cameras running the yi-hack firmware** (yi-hack-MStar,
yi-hack-Allwinner, yi-hack-Allwinner-v2, yi-hack-v5). It runs in its own
sandboxed Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
Second runtime dependency: [`mqtt`](https://github.com/mqttjs/MQTT.js), for the
optional real-time events. Requires Gladys 5.3+ (keywords, countries).

Local only (`"transports": ["local"]`): the stock Yi firmware has no local API
and the Yi cloud has no public one, so the integration only speaks to the CGI
scripts of the yi-hack web server, on the LAN.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/cameras.test.js            # one file
node --test --test-name-pattern "MQTT"      # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node
22 and 24; pull requests also run the store checks and build the Docker image.
Run the three commands before pushing.

## Architecture

```
index.js                    SDK instance + createApp + connect (no logic)
src/app.js                  every SDK handler, the three timers (refresh, snapshots, recordings)
src/cameras.js              CameraManager: read, publish, snapshots, motion, MQTT routing, commands
src/yi/client.js            HTTP client of the yi-hack CGI scripts (+ presets / yes-no parsing)
src/yi/mqtt.js              MQTT listener; topics and messages read from each camera
src/devices/camera.js       the Gladys device of a camera: features, states, external ids
src/store.js                /data/cameras.json: identities kept across restarts
src/config.js               DEFAULT_CONFIG (mirrors the manifest) + normalization + address list
src/connection.js           connection status + "Test the connection" report
src/actions.js              Configuration screen buttons (manifest `actions`)
src/capabilities/triggers.js  scene trigger keys and values
src/capabilities/scenes.js  scene actions (manifest `scene_actions`)
src/capabilities/widgets.js dashboard widgets (manifest `widgets`) + widget images
src/i18n.js                 LANGUAGES = en, fr, de, es; localize / pick / t helpers
docs/{en,fr,de,es}.md       user documentation, re-hosted by Gladys
test/helpers/fakeCamera.js  fake yi-hack cameras behind `fetch`, fake clock, fake MQTT
```

### Invariants worth knowing

- **External ids are forever.** A camera is `gladys.externalIds('yi-camera',
<MAC without colons>)` (serial number as fallback), never the IP or the
  hostname: the IP changes with DHCP, the hostname is "yi-hack" on every
  camera. Feature keys (`image`, `enabled`, `motion`, `led`, `ir`, `signal`,
  `move`, `preset`), trigger, action, widget and config keys are stored by
  users: never rename them.
- **Every feature declares `name`, `min`, `max`, `read_only`, `has_feedback`**
  (NOT NULL in Gladys), image included (`0`/`0`).
- **`enabled` is yi-hack `SWITCH_ON`** (the camera's privacy mode), mapped on
  the SDK `camera/enabled` feature. Gladys stops using a camera at 0, so the
  integration reads the cameras with its own timer, never with `onPoll`.
- **Images**: `image/jpg;base64,...`, at most 150 KB as a string
  (`MAX_IMAGE_LENGTH`), at most 12 per minute per device (snapshot interval
  clamped to 10 s). High resolution falls back to low when too heavy. Widget
  images need a new key per frame (`snapshotKey`).
- **Motion**: over MQTT when the camera's topics are routed and the broker is
  connected; otherwise a new clip from `getlastrecordedvideo.sh` (only when the
  camera records on motion). One `motion_detected` event per 0 → 1 edge, plus
  one per AI detection kind; the same kind twice within 10 s is one event.
- **MQTT topics are read from each camera** (`get_configs.sh?conf=mqtt`); only
  prefix, topics and messages are kept — that file also holds the broker
  password. Two cameras on one prefix cannot be told apart: the second is left
  out and reported by "Test the connection".
- **PTZ moves are `ptz.sh` steps**: the camera stops by itself, so a lost order
  never leaves the motor running (the SDK watchdog rule). `move` 0 sends
  nothing. No zoom on Yi cameras: options 1–4 only.
- **A reboot asked from Gladys** suppresses `camera_offline` / `camera_online`
  for 3 minutes.
- **The container rootfs is read-only.** Write only under `/data`
  (`YI_DATA_DIR` in tests). Never log passwords, tokens or broker credentials
  (`redactUrl`).

## Rules

- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Every text is `{ en, fr, de, es }` — label, description and
  placeholder alike. Catalog description 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code (defaults, actions,
  scene triggers and their data keys, scene actions, widgets, languages,
  categories, keywords, countries, Gladys floor): change both sides together.
- **Widgets.** Every content must pass `validateWidgetContent(content)` with
  `[]` (see `test/widgets.test.js`). Widget form option values are strings.
- **User-facing text** is in the four languages, built with `src/i18n.js`;
  `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md` kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network: cameras are faked behind `fetch`,
  timers by `createFakeClock`, MQTT by `createFakeMqtt`, Gladys by the SDK's
  `createFakeGladys`.
