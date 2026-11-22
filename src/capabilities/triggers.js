// -----------------------------------------------------------------------------
// Scene triggers (SDK v0.14+, Gladys 5.1+): what the cameras tell the scenes.
//
// Fired by src/cameras.js with `gladys.publishSceneEvent(key, data)`. Each key
// is declared in the manifest `scene_triggers` field, and so is every value of
// `detection` / `sound` (the options of the scene filters). Keys and values
// are stored in the users' scenes: they are never renamed.
//
// One event per transition, never one per poll: the core admits 300 events a
// minute per integration, and a scene bound to "motion" must run once per
// motion, not once per message.
// -----------------------------------------------------------------------------

export const SCENE_TRIGGERS = {
  MOTION_DETECTED: 'motion_detected',
  SOUND_DETECTED: 'sound_detected',
  CAMERA_OFFLINE: 'camera_offline',
  CAMERA_ONLINE: 'camera_online',
};

/** What a camera saw: plain motion, or what its AI recognized. */
export const DETECTIONS = {
  MOTION: 'motion',
  HUMAN: 'human',
  VEHICLE: 'vehicle',
  ANIMAL: 'animal',
};

/** What a camera heard. */
export const SOUNDS = {
  SOUND: 'sound',
  CRYING: 'crying',
};
