// Run with: node scripts/check_default_actions.cjs
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

const {
  resolveDefaultAction,
  applyDefaultAction,
  defaultActionFitsSchedule,
} = require('../src/data/actions/default_action.ts');
const { validateConfig } = require('../src/data/validate_config.ts');
const { localize } = require('../src/localize/localize.ts');
const { defaultSingleTimerConfig, defaultTimeSchemeConfig } = require('../src/const.ts');

const service = (fields = {}) => ({ name: '', description: '', target: { entity: [{}] }, fields });
const hass = {
  localize: () => '',
  locale: { language: 'en' },
  language: 'en',
  entities: {},
  config: { unit_system: { temperature: '°C' } },
  devices: {},
  areas: {},
  states: {
    // heating only: target temperature, no turn_on / turn_off
    'climate.living_room': {
      entity_id: 'climate.living_room',
      state: 'heat',
      attributes: { supported_features: 1, hvac_modes: ['heat', 'off'], min_temp: 7, max_temp: 35 },
    },
    'climate.attic': { entity_id: 'climate.attic', state: 'unavailable', attributes: { supported_features: 1 } },
    'light.kitchen': { entity_id: 'light.kitchen', state: 'off', attributes: {} },
  },
  services: {
    climate: {
      turn_on: service(),
      turn_off: service(),
      set_hvac_mode: service({ hvac_mode: {} }),
      set_temperature: service({ temperature: {}, target_temp_high: {}, target_temp_low: {}, hvac_mode: {} }),
    },
    light: { turn_on: service({ brightness: {} }), turn_off: service(), toggle: service() },
  },
};

const climate = {
  include: ['climate.living_room', 'climate.attic', 'light.kitchen'],
  default_entity: 'climate.living_room',
  default_actions: { climate: { action: 'set_temperature', data: { temperature: 21 } } },
};

// full form: action name with data
let res = resolveDefaultAction(hass, climate);
assert.equal(res.error, undefined);
assert.deepEqual(res.action, {
  service: 'climate.set_temperature',
  service_data: { temperature: 21 },
  target: { entity_id: 'climate.living_room' },
});

// also accepted: full service name, case-insensitive
res = resolveDefaultAction(hass, {
  ...climate,
  default_actions: { climate: { action: 'Climate.Set_Temperature', data: { temperature: 19 } } },
});
assert.equal(res.action.service, 'climate.set_temperature');

// short form
res = resolveDefaultAction(hass, {
  ...climate,
  default_entity: 'light.kitchen',
  default_actions: { light: 'turn_on' },
});
assert.deepEqual(res.action, { service: 'light.turn_on', service_data: {}, target: { entity_id: 'light.kitchen' } });

// index counts in the action list of the entity: without turn_off / turn_on, set_hvac_mode is the first one
res = resolveDefaultAction(hass, {
  ...climate,
  default_actions: { climate: { action: 0, data: { hvac_mode: 'heat' } } },
});
assert.equal(res.action.service, 'climate.set_hvac_mode');

// reasons why there is no default action
const error = (config) => resolveDefaultAction(hass, config).error;
assert.equal(error({ ...climate, default_entity: undefined }), 'no_default_entity');
assert.equal(error({ ...climate, exclude: ['climate.living_room'] }), 'entity_not_included');
assert.equal(error({ ...climate, include: ['light.kitchen'] }), 'entity_not_included');
assert.equal(error({ ...climate, default_entity: 'climate.attic' }), 'entity_unavailable');
assert.equal(
  error({ ...climate, include: ['climate.missing'], default_entity: 'climate.missing' }),
  'entity_unavailable'
);
assert.equal(error({ ...climate, default_actions: { light: 'turn_on' } }), 'no_default_action');
assert.equal(error({ ...climate, default_actions: undefined }), 'no_default_action');
// turn_on is not supported by the entity
assert.equal(error({ ...climate, default_actions: { climate: 'turn_on' } }), 'action_not_found');
assert.equal(error({ ...climate, default_actions: { climate: 'does_not_exist' } }), 'action_not_found');
// set_temperature without temperature
assert.equal(error({ ...climate, default_actions: { climate: 'set_temperature' } }), 'action_incomplete');

// applying the default action to new schedules
const action = resolveDefaultAction(hass, climate).action;
const clone = (e) => JSON.parse(JSON.stringify(e));

const single = applyDefaultAction(clone(defaultSingleTimerConfig), action);
assert.deepEqual(
  single.entries[0].slots.map((e) => e.actions.length),
  [0, 1, 0],
  'single mode: only the timeslot without a stop time gets the action'
);
assert.deepEqual(
  applyDefaultAction(clone(defaultSingleTimerConfig), action, 'single').entries[0].slots.map((e) => e.actions.length),
  [0, 1, 0]
);
const scheme = applyDefaultAction(clone(defaultTimeSchemeConfig), action);
assert.deepEqual(
  applyDefaultAction(clone(defaultTimeSchemeConfig), action, 'scheme').entries[0].slots.map((e) => e.actions.length),
  [1, 1, 1]
);
assert.deepEqual(
  scheme.entries[0].slots.map((e) => e.actions.length),
  [1, 1, 1],
  'scheme mode: every timeslot'
);
// the actions are copies, editing one doesn't change the others
scheme.entries[0].slots[0].actions[0].service_data.temperature = 17;
assert.equal(scheme.entries[0].slots[1].actions[0].service_data.temperature, 21);
assert.equal(action.service_data.temperature, 21);
// the original schedule is not changed
assert.deepEqual(defaultSingleTimerConfig.entries[0].slots[1].actions, []);

// the default action is only offered for schedules without actions for other entities
assert.ok(defaultActionFitsSchedule(clone(defaultTimeSchemeConfig), action));
assert.ok(defaultActionFitsSchedule(single, action));
const other = clone(single);
other.entries[0].slots[1].actions[0].target = { entity_id: 'climate.attic' };
assert.ok(!defaultActionFitsSchedule(other, action));

// configuration validation
const valid = {
  show_actions: false,
  default_entity: 'climate.living_room',
  default_actions: { climate: { action: 'set_temperature', data: { temperature: 21 } }, light: 'turn_on', fan: 2 },
};
assert.deepEqual(validateConfig(valid), valid);
for (const [config, message] of [
  [{ show_actions: 'false' }, `'show_actions' must be a boolean`],
  [{ default_entity: 'living_room' }, `'default_entity' must be an entity ID`],
  [{ default_entity: ['climate.living_room'] }, `'default_entity' must be an entity ID`],
  [{ default_actions: 'set_temperature' }, `'default_actions' must be a struct`],
  [{ default_actions: { climate: { data: {} } } }, `in 'default_actions': 'climate'`],
  [{ default_actions: { climate: { action: 'set_temperature', data: 21 } } }, `in 'default_actions': 'climate'`],
  [{ default_actions: { climate: '' } }, `in 'default_actions': 'climate'`],
]) {
  assert.throws(
    () => validateConfig(config),
    (e) => String(e.message || e).includes(message),
    JSON.stringify(config)
  );
}

// translations: resolve in every language, defined in en and pl
const keys = [
  'ui.panel.card_editor.fields.show_actions.heading',
  'ui.panel.card_editor.fields.show_actions.missing_default',
  ...[
    'no_default_entity',
    'entity_not_included',
    'entity_unavailable',
    'no_default_action',
    'action_not_found',
    'action_incomplete',
  ].map((e) => `ui.panel.editor.default_action_errors.${e}`),
];
const languagesDir = path.join(__dirname, '../src/localize/languages');
const languages = readdirSync(languagesDir).map((e) => path.basename(e, '.json'));
for (const language of languages) {
  for (const key of keys) {
    const label = localize(key, { locale: { language } });
    assert.ok(typeof label == 'string' && label.length && label != key, `'${key}' is missing for '${language}'`);
  }
}
for (const language of ['en', 'pl']) {
  const translations = JSON.parse(readFileSync(path.join(languagesDir, `${language}.json`), 'utf8'));
  for (const key of keys) {
    const value = key.split('.').reduce((o, i) => (o ? o[i] : undefined), translations);
    assert.equal(typeof value, 'string', `'${key}' is not defined in ${language}.json`);
  }
}

console.log(`PASS: default action checks (${languages.length} languages)`);
