# Gladys integration — Yi Home Cameras

External integration for [Gladys Assistant](https://gladysassistant.com) that
brings **Yi Home cameras running the yi-hack firmware** into Gladys: snapshots,
motion detection, privacy mode, LED, night vision, pan/tilt and presets, scene
triggers and actions, and dashboard widgets. **Local only**: no Yi account, no
cloud. Built with the official
[JavaScript SDK](https://github.com/GladysAssistant/integration-sdk-js), from the
[official template](https://github.com/GladysAssistant/integration-template-js).

![Cover](cover.png)

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md)

## Why yi-hack, and why local only

The stock Yi Home firmware offers no local API, and the Yi cloud offers no
public one: the app talks to the cameras through a proprietary peer-to-peer
service. The community firmwares
[yi-hack-Allwinner-v2](https://github.com/roleoroleo/yi-hack-Allwinner-v2),
[yi-hack-Allwinner](https://github.com/roleoroleo/yi-hack-Allwinner),
[yi-hack-MStar](https://github.com/roleoroleo/yi-hack-MStar) and
[yi-hack-v5](https://github.com/alienatedsec/yi-hack-v5) add a web server with
the same CGI scripts on every model. This integration uses only those scripts,
on the LAN, hence the manifest `"transports": ["local"]` and the per-camera
`local` / `unreachable` badge.

## What it does

| Surface               | Content                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Devices               | One per camera (id = MAC): image, camera on/off (privacy), motion, LED, night vision, Wi-Fi, PTZ move & presets |
| Images                | Periodic push (`publishCameraImage`) + fresh capture on demand (`onGetImage`), ≤ 150 KB, high → low fallback    |
| Motion                | MQTT in real time (motion, person, vehicle, animal, sound, baby crying), or new recordings without MQTT         |
| Scene triggers        | `motion_detected`, `sound_detected`, `camera_offline`, `camera_online`                                          |
| Scene actions         | `take_snapshot`, `go_to_preset`, `set_motion_sensitivity`, `reboot_camera`                                      |
| Widgets               | `yi_camera` (one camera: image, state, buttons), `yi_cameras` (all cameras at a glance)                         |
| Configuration buttons | `test_connection`, `identify` (LED blinks), `reboot`                                                            |
| Languages             | English, French, German, Spanish — manifest, messages, widgets, docs                                            |
| Catalog               | `categories`: security, multimedia · `keywords` · `countries` (20) · Gladys ≥ 5.3.0                             |

## Project structure

```
.
├─ index.js                          # SDK bootstrap only
├─ src/
│  ├─ app.js                         # every SDK handler + the timers
│  ├─ cameras.js                     # CameraManager: read, publish, snapshots, motion, commands
│  ├─ yi/client.js                   # yi-hack HTTP client (CGI scripts)
│  ├─ yi/mqtt.js                     # MQTT listener, topics read from each camera
│  ├─ devices/camera.js              # the Gladys device of a camera
│  ├─ capabilities/                  # scene triggers, scene actions, widgets
│  ├─ actions.js                     # Configuration screen buttons
│  ├─ connection.js                  # connection status + test report
│  ├─ store.js                       # /data/cameras.json
│  ├─ config.js                      # defaults + normalization
│  └─ i18n.js                        # en, fr, de, es
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, fake cameras + SDK fake Gladys
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md · SECURITY.md · CLAUDE.md
└─ .github/                          # CI, Release, Build, GitHub releases, Dependabot
```

## Run it locally

```bash
npm install
```

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="yi-home-cameras" \
YI_DATA_DIR=./data \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor inside the
sandboxed container. `YI_DATA_DIR` replaces `/data` outside the container.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test
```

The CI runs them on Node 22 and 24 for every push and pull request; pull
requests also run the store admission checks (`npx
github:GladysAssistant/integration-store --skip-image-check .`) and build the
Docker image. The tests never touch the network: the cameras are faked behind
`fetch` (`test/helpers/fakeCamera.js`), MQTT and timers too, and Gladys is the
SDK's `createFakeGladys()`. Every widget content is checked with
`validateWidgetContent`.

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`.

The workflow bumps `package.json`, `package-lock.json` and the manifest
(`version` + `docker_image`), rolls the changelog, tags `vX.Y.Z`, builds the
`linux/amd64` + `linux/arm64` image to `ghcr.io/prohand/gladys-yihomecamera`
(`:X.Y.Z` and `:latest`), publishes the GitHub Release and runs the full store
checks. The repository needs the GitHub topic `gladys-assistant-integration` to
be indexed by the store.

## License

Apache-2.0
