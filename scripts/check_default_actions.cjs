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
  defaultActionErrorMessage,
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
    'light.hall': { entity_id: 'light.hall', state: 'off', attributes: {} },
    'switch.pump': { entity_id: 'switch.pump', state: 'off', attributes: {} },
    'script.wake_up': { entity_id: 'script.wake_up', state: 'off', attributes: {} },
    'script.good_night': { entity_id: 'script.good_night', state: 'off', attributes: {} },
    'script.broken': { entity_id: 'script.broken', state: 'unavailable', attributes: {} },
  },
  services: {
    climate: {
      turn_on: service(),
      turn_off: service(),
      set_hvac_mode: service({ hvac_mode: {} }),
      set_temperature: service({ temperature: {}, target_temp_high: {}, target_temp_low: {}, hvac_mode: {} }),
    },
    light: { turn_on: service({ brightness: {} }), turn_off: service(), toggle: service() },
    // scripts are services without a target, next to the generic script services
    script: {
      wake_up: { name: '', description: '', fields: {} },
      good_night: { name: '', description: '', fields: {} },
      broken: { name: '', description: '', fields: {} },
      turn_on: service(),
      turn_off: service(),
      reload: { name: '', description: '', fields: {} },
    },
  },
};

const setTemperature = (entity_id, temperature = 21) => ({
  service: 'climate.set_temperature',
  entity_id,
  service_data: { temperature },
});
const climate = {
  include: ['climate.living_room', 'climate.attic', 'light.kitchen', 'light.hall', 'switch.pump'],
  default_actions: [setTemperature('climate.living_room')],
};

// the format of the actions of a timeslot in scheduler.add
let res = resolveDefaultAction(hass, climate);
assert.equal(res.error, undefined);
assert.deepEqual(res.action, {
  service: 'climate.set_temperature',
  service_data: { temperature: 21 },
  target: { entity_id: 'climate.living_room' },
});

// a single entry without a list, case-insensitive service
res = resolveDefaultAction(hass, {
  ...climate,
  default_actions: { ...setTemperature('climate.living_room', 19), service: 'Climate.Set_Temperature' },
});
assert.equal(res.action.service, 'climate.set_temperature');
assert.equal(res.action.service_data.temperature, 19);

// service_data is optional
res = resolveDefaultAction(hass, {
  ...climate,
  default_actions: [{ service: 'light.turn_on', entity_id: 'light.kitchen' }],
});
assert.deepEqual(res.action, { service: 'light.turn_on', service_data: {}, target: { entity_id: 'light.kitchen' } });

// several entities: one entry per entity, combined into one action as when a schedule is read from the storage
const lights = [
  { service: 'light.turn_on', entity_id: 'light.kitchen', service_data: { brightness: 128 } },
  { service: 'light.turn_on', entity_id: 'light.hall', service_data: { brightness: 128 } },
];
res = resolveDefaultAction(hass, { ...climate, default_actions: lights });
assert.deepEqual(res.action, {
  service: 'light.turn_on',
  service_data: { brightness: 128 },
  target: { entity_id: ['light.kitchen', 'light.hall'] },
});
// the same entity twice counts once
res = resolveDefaultAction(hass, { ...climate, default_actions: [lights[0], lights[0]] });
assert.deepEqual(res.action.target, { entity_id: 'light.kitchen' });

// the entries may only differ in entity_id
const error = (config) => resolveDefaultAction(hass, config).error;
assert.equal(
  error({ ...climate, default_actions: [lights[0], { ...lights[1], service_data: { brightness: 255 } }] }),
  'multiple_actions'
);
assert.equal(
  error({ ...climate, default_actions: [lights[0], { ...lights[1], service: 'light.turn_off' }] }),
  'multiple_actions'
);
assert.equal(
  error({ ...climate, default_actions: [lights[0], { ...lights[1], service_data: undefined }] }),
  'multiple_actions'
);
// the editor lets the user choose entities of one domain
res = resolveDefaultAction(hass, {
  ...climate,
  default_actions: [lights[0], { ...lights[0], entity_id: 'switch.pump' }],
});
assert.equal(res.error, 'action_entity_mismatch');
assert.equal(res.entity, 'switch.pump');

// scripts: the service is the script, there is no target, entity_id is optional and must be the script itself
const scripts = { include: ['script.wake_up', 'script.good_night', 'script.broken', 'light.kitchen'] };
const script = (service, entity_id) => ({
  ...scripts,
  default_actions: [{ service, ...(entity_id ? { entity_id } : {}) }],
});
res = resolveDefaultAction(hass, script('script.wake_up'));
assert.equal(res.error, undefined);
assert.deepEqual(res.action, { service: 'script.wake_up', service_data: {} });
res = resolveDefaultAction(hass, script('script.wake_up', 'script.wake_up'));
assert.deepEqual(
  res.action,
  { service: 'script.wake_up', service_data: {} },
  'the entity_id of a script is not stored'
);
res = resolveDefaultAction(hass, script('script.wake_up', 'script.good_night'));
assert.equal(res.error, 'action_entity_mismatch');
assert.equal(res.entity, 'script.good_night');
assert.equal(error(script('script.wake_up', 'light.kitchen')), 'action_entity_mismatch');
// generic script services are not in the action list
assert.equal(error(script('script.turn_on')), 'action_not_found');
assert.equal(error(script('script.turn_on', 'script.wake_up')), 'action_entity_mismatch');
// include / exclude: the script itself is its entity, with the same rules as everywhere in the card
assert.equal(error({ ...script('script.wake_up'), include: ['script.good_night'] }), 'entity_not_included');
assert.equal(error({ ...script('script.wake_up'), include: ['script'] }), undefined);
assert.equal(error({ ...script('script.wake_up'), include: ['script.*'] }), undefined);
assert.equal(error({ ...script('script.wake_up'), exclude: ['script.wake_up'] }), 'entity_not_included');
assert.equal(
  error({ ...script('script.wake_up'), include: undefined }),
  undefined,
  'without include, everything is included'
);
assert.equal(error(script('script.broken')), 'entity_unavailable');
assert.equal(
  error({ include: ['script.missing'], default_actions: [{ service: 'script.missing' }] }),
  'action_not_found'
);

// a custom action from customize is used when its service data matches
const customize = {
  ...climate,
  customize: {
    'climate.living_room': {
      actions: [{ service: 'set_temperature', service_data: { temperature: 21 }, name: 'Comfort', icon: 'mdi:sofa' }],
    },
  },
};
res = resolveDefaultAction(hass, customize);
assert.equal(res.action.name, 'Comfort');
assert.deepEqual(res.action.service_data, { temperature: 21 });
res = resolveDefaultAction(hass, { ...customize, default_actions: [setTemperature('climate.living_room', 19)] });
assert.equal(res.action.name, undefined);
assert.deepEqual(res.action.service_data, { temperature: 19 });
// reasons why there is no default action, with the entity involved
const failure = (config) => {
  const { error, service, entity } = resolveDefaultAction(hass, config);
  return { error, service, entity };
};
assert.deepEqual(failure({ ...climate, default_actions: undefined }), {
  error: 'no_default_actions',
  service: undefined,
  entity: undefined,
});
assert.equal(error({ ...climate, default_actions: [] }), 'no_default_actions');
assert.deepEqual(failure({ ...climate, default_actions: [{ service: 'climate.set_temperature' }] }), {
  error: 'missing_entity',
  service: 'climate.set_temperature',
  entity: undefined,
});
assert.deepEqual(failure({ ...climate, exclude: ['climate.living_room'] }), {
  error: 'entity_not_included',
  service: 'climate.set_temperature',
  entity: 'climate.living_room',
});
assert.equal(error({ ...climate, include: ['light.kitchen'] }), 'entity_not_included');
// the entity that is not included is named, also when it is not the first one
assert.equal(
  resolveDefaultAction(hass, { ...climate, exclude: ['light.hall'], default_actions: lights }).entity,
  'light.hall'
);
assert.equal(error({ ...climate, default_actions: [setTemperature('climate.attic')] }), 'entity_unavailable');
assert.equal(
  error({ ...climate, include: ['climate.missing'], default_actions: [setTemperature('climate.missing')] }),
  'entity_unavailable'
);
// a service of another domain than the entity
assert.equal(
  error({ ...climate, default_actions: [{ service: 'light.turn_on', entity_id: 'climate.living_room' }] }),
  'action_entity_mismatch'
);
// turn_on is not supported by the entity
assert.equal(
  error({ ...climate, default_actions: [{ service: 'climate.turn_on', entity_id: 'climate.living_room' }] }),
  'action_not_found'
);
assert.equal(
  error({ ...climate, default_actions: [{ service: 'climate.does_not_exist', entity_id: 'climate.living_room' }] }),
  'action_not_found'
);
// set_temperature without temperature
assert.equal(
  error({ ...climate, default_actions: [{ service: 'climate.set_temperature', entity_id: 'climate.living_room' }] }),
  'action_incomplete'
);

// the messages name the service and the entity; optional parts are left out without a value
const en = { locale: { language: 'en' } };
assert.equal(
  defaultActionErrorMessage(failure({ ...climate, exclude: ['climate.living_room'] }), en),
  'The entity of the default action climate.living_room is not included in the card (include / exclude).'
);
assert.equal(
  defaultActionErrorMessage({ error: 'action_not_found', service: 'script.turn_on' }, en),
  'The default action script.turn_on is not available.'
);
assert.equal(
  defaultActionErrorMessage(
    { error: 'action_not_found', service: 'climate.turn_on', entity: 'climate.living_room' },
    en
  ),
  'The default action climate.turn_on is not available for climate.living_room.'
);

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
// several entities are compared as a set
const lightsAction = resolveDefaultAction(hass, { ...climate, default_actions: lights }).action;
const lightsSchedule = applyDefaultAction(clone(defaultSingleTimerConfig), lightsAction);
assert.ok(defaultActionFitsSchedule(lightsSchedule, lightsAction));
lightsSchedule.entries[0].slots[1].actions[0].target.entity_id.reverse();
assert.ok(defaultActionFitsSchedule(lightsSchedule, lightsAction));
assert.deepEqual(lightsAction.target.entity_id, ['light.kitchen', 'light.hall'], 'the schedule got a copy of the list');
assert.ok(
  !defaultActionFitsSchedule(
    lightsSchedule,
    resolveDefaultAction(hass, { ...climate, default_actions: [lights[0]] }).action
  )
);
// scripts have no target, they are compared by their service
const wakeUp = resolveDefaultAction(hass, script('script.wake_up')).action;
const goodNight = applyDefaultAction(
  clone(defaultSingleTimerConfig),
  resolveDefaultAction(hass, script('script.good_night')).action
);
assert.ok(!defaultActionFitsSchedule(goodNight, wakeUp));
assert.ok(defaultActionFitsSchedule(applyDefaultAction(clone(defaultSingleTimerConfig), wakeUp), wakeUp));
assert.ok(!defaultActionFitsSchedule(goodNight, action));

// configuration validation
const valid = {
  show_actions: false,
  default_actions: [setTemperature('climate.living_room'), { service: 'script.wake_up' }],
};
assert.deepEqual(validateConfig(valid), valid);
assert.ok(validateConfig({ default_actions: { service: 'script.wake_up', entity_id: 'script.wake_up' } }));
const listMessage = `'default_actions' must be a list of actions`;
for (const [config, message] of [
  [{ show_actions: 'false' }, `'show_actions' must be a boolean`],
  [{ default_actions: 'light.turn_on' }, listMessage],
  [{ default_actions: [] }, listMessage],
  [{ default_actions: [2] }, listMessage],
  [{ default_actions: [{ service: 'turn_on', entity_id: 'light.kitchen' }] }, listMessage],
  [{ default_actions: [{ entity_id: 'light.kitchen' }] }, listMessage],
  [{ default_actions: [{ service: 'light.turn_on', entity_id: 'kitchen' }] }, listMessage],
  [{ default_actions: [{ service: 'light.turn_on', entity_id: ['light.kitchen', 'light.hall'] }] }, listMessage],
  [{ default_actions: [{ service: 'light.turn_on', service_data: 128 }] }, listMessage],
  [{ default_actions: { light: 'turn_on' } }, listMessage],
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
    'no_default_actions',
    'multiple_actions',
    'missing_entity',
    'action_entity_mismatch',
    'entity_not_included',
    'entity_unavailable',
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
