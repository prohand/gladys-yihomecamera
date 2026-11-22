// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest shape, but nothing there can know
// which handlers the code registers, nor the rules that are easy to miss
// (languages, lengths, version couplings): these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { ACTIONS } from '../src/actions.js';
import { SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { DETECTIONS, SCENE_TRIGGERS, SOUNDS } from '../src/capabilities/triggers.js';
import { WIDGET_KEYS } from '../src/capabilities/widgets.js';
import { LANGUAGES } from '../src/i18n.js';

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('../package.json'));

const allFields = () => [
  ...manifest.config_schema,
  ...(manifest.actions ?? []).flatMap((a) => a.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((w) => w.settings ?? []),
  ...(manifest.scene_triggers ?? []).flatMap((t) => t.fields ?? []),
  ...(manifest.scene_actions ?? []).flatMap((a) => a.fields ?? []),
];

test('the version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-yihomecamera:${pkg.version}`);
});

test('name and catalog description fit what the store allows', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const language of LANGUAGES) {
    const { length } = manifest.description[language];
    assert.ok(length >= 10 && length <= 100, `description.${language}: ${length} characters`);
  }
});

test('every manifest action has a handler, and every handler an action', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.keys(ACTIONS).sort());
});

test('every scene action has a handler, and every handler a scene action', () => {
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.keys(SCENE_ACTIONS).sort(),
  );
});

test('the scene triggers the code fires are the ones the manifest declares', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  const options = (trigger, field) =>
    manifest.scene_triggers
      .find((t) => t.key === trigger)
      .fields.find((f) => f.key === field)
      .options.map((o) => o.value)
      .sort();
  assert.deepEqual(
    options(SCENE_TRIGGERS.MOTION_DETECTED, 'detection'),
    Object.values(DETECTIONS).sort(),
  );
  assert.deepEqual(options(SCENE_TRIGGERS.SOUND_DETECTED, 'sound'), Object.values(SOUNDS).sort());
});

test('the event data the code sends covers every declared filter and variable', () => {
  // What src/cameras.js puts in each publishSceneEvent; the core drops any
  // key not declared, and a declared key never sent stays empty in scenes.
  const sent = {
    [SCENE_TRIGGERS.MOTION_DETECTED]: ['device', 'device_name', 'detection'],
    [SCENE_TRIGGERS.SOUND_DETECTED]: ['device', 'device_name', 'sound'],
    [SCENE_TRIGGERS.CAMERA_OFFLINE]: ['device', 'device_name', 'host'],
    [SCENE_TRIGGERS.CAMERA_ONLINE]: ['device', 'device_name', 'host'],
  };
  for (const trigger of manifest.scene_triggers) {
    const declared = [...trigger.fields, ...(trigger.variables ?? [])]
      .filter((f) => f.type !== 'section')
      .map((f) => f.key);
    for (const key of declared) {
      assert.ok(sent[trigger.key].includes(key), `${trigger.key}.${key} is never sent`);
    }
  }
});

test('every widget is served by the code', () => {
  assert.deepEqual(manifest.widgets.map((w) => w.key).sort(), Object.values(WIDGET_KEYS).sort());
});

// The store schema is the admission authority: a type outside this list, or a
// placeholder that is not a multi-language object, gets the integration rejected.
const FIELD_TYPES = ['string', 'number', 'boolean', 'select', 'multi_select', 'secret', 'section'];

test('every field uses a type, a key and a placeholder the store accepts', () => {
  for (const field of allFields()) {
    assert.ok(FIELD_TYPES.includes(field.type), `field "${field.key}": type "${field.type}"`);
    assert.match(field.key, /^[a-z0-9_]+$/, `field key "${field.key}" must be snake_case`);
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder object`);
      assert.ok(['string', 'number', 'secret'].includes(field.type), `field "${field.key}"`);
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `field "${field.key}": min/max are number-only`);
      assert.ok(field.min <= field.max, `field "${field.key}": min <= max`);
    }
    if (field.default !== undefined && field.type === 'select') {
      assert.ok(
        field.options.some((o) => o.value === field.default),
        `field "${field.key}"`,
      );
    }
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config key "${field.key}" unknown to the code`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of "${field.key}"`);
    }
  }
});

test('section fields are purely presentational', () => {
  for (const section of allFields().filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, section.key);
    assert.equal(section.default, undefined, section.key);
    assert.equal(section.placeholder, undefined, section.key);
    assert.ok(!(section.key in DEFAULT_CONFIG), section.key);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
    for (const language of LANGUAGES) {
      assert.ok((section.description?.[language] ?? '').length <= 1000, section.key);
    }
  }
});

test('dynamic selects pick one of the cameras, never with static options or a default', () => {
  const dynamic = allFields().filter((f) => f.source !== undefined);
  assert.ok(dynamic.length > 0);
  for (const field of dynamic) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, field.key);
    assert.equal(field.default, undefined, field.key);
  }
});

// The vocabulary the store indexes. An unknown key is not an error: it is
// silently dropped, and the integration disappears from that shelf.
const CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('the categories stay inside the store vocabulary', () => {
  const { categories } = manifest;
  assert.ok(categories.length >= 1 && categories.length <= 3);
  assert.equal(new Set(categories).size, categories.length);
  for (const category of categories) {
    assert.ok(CATEGORIES.includes(category), `unknown category "${category}"`);
  }
});

test('the Gladys floor covers every field the manifest declares', () => {
  // categories: 4.86; widgets and scenes: 5.1; keywords and countries: 5.3.
  const [major, minor] = manifest.gladys_version.replace(/^>=/, '').split('.').map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 3), manifest.gladys_version);
});

test('the search keywords follow the store rules', () => {
  const { keywords } = manifest;
  assert.ok(keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((k) => k.trim().toLowerCase());
  assert.equal(new Set(normalized).size, keywords.length, 'keywords must be unique');
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword);
  }
});

test('the countries are unique ISO 3166-1 alpha-2 codes, 20 at most', () => {
  const { countries } = manifest;
  assert.ok(Array.isArray(countries) && countries.length >= 1 && countries.length <= 20);
  assert.equal(new Set(countries).size, countries.length);
  for (const country of countries) {
    assert.match(country, /^[A-Z]{2}$/);
  }
  // Where the four languages of the integration are spoken, at least.
  for (const country of ['FR', 'BE', 'CH', 'CA', 'DE', 'AT', 'ES', 'US', 'GB']) {
    assert.ok(countries.includes(country), country);
  }
});

test('the integration is local only: yi-hack is a LAN API, Yi has no public cloud API', () => {
  assert.deepEqual(manifest.transports, ['local']);
});

/** Every multi-language object of the manifest, with where it sits. */
function multiLanguageTexts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => multiLanguageTexts(child, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  const keys = Object.keys(node);
  if (keys.includes('en') && keys.every((key) => /^[a-z]{2}$/.test(key))) {
    return [{ path, text: node }];
  }
  return keys.flatMap((key) => multiLanguageTexts(node[key], `${path}.${key}`));
}

test('every multi-language text carries en, fr, de and es', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 80, `only ${texts.length} texts found`);
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path}: languages`);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

test('widget labels and descriptions fit in every language', () => {
  for (const widget of manifest.widgets) {
    for (const language of LANGUAGES) {
      const label = widget.label[language].length;
      assert.ok(label >= 3 && label <= 30, `${widget.key} label.${language}`);
      assert.ok(widget.description[language].length <= 100, `${widget.key} description`);
    }
  }
});

test('the user documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    await access(new URL(`../docs/${language}.md`, import.meta.url));
  }
});
