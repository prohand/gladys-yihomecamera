# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version of the Yi Home Cameras integration, for Yi Home cameras running
  the yi-hack firmware (MStar, Allwinner, Allwinner-v2, v5), over the local
  network only: no Yi account, no cloud.
- One Gladys device per camera, keyed on its MAC address: image, camera on/off
  (privacy mode), motion, status LED, night vision, Wi-Fi signal, and pan/tilt
  steps and saved presets on PTZ models.
- Snapshots pushed to Gladys at a configurable interval, and a fresh image on
  demand for the dashboard and the chat. A high resolution image too heavy for
  Gladys falls back to the low one.
- Motion detection from the recordings of the camera, or in real time over MQTT
  with the AI detections (person, vehicle, animal), loud sounds and baby crying.
- Scene triggers: motion detected, sound detected, camera offline, camera back
  online.
- Scene actions: take a snapshot, go to a preset, set the motion sensitivity,
  reboot a camera.
- Dashboard widgets: one camera (image, state, buttons) and all the cameras at a
  glance.
- Configuration screen buttons: test the connection, identify a camera (its LED
  blinks), reboot a camera.
- English, French, German and Spanish everywhere: configuration, messages,
  widgets, scenes and documentation.
- CI (Prettier, ESLint, tests on Node 22 and 24, store checks, Docker build),
  UI-driven Release workflow, GitHub Releases, Dependabot.

[Unreleased]: https://github.com/prohand/gladys-yihomecamera/commits/main
