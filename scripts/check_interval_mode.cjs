// Run with: node scripts/check_interval_mode.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');

// Load the real schedule helpers and their dependencies without adding a test framework.
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};
const { convertToInterval, detectEditorMode, setIntervalTime } = require('../src/data/schedule/interval.ts');

const hass = { locale: { language: 'en', time_format: '24' }, states: {} };
const conditions = { type: 'or', items: [], track_changes: false };
const action = { service: 'light.turn_on', service_data: {}, target: { entity_id: 'light.a' } };
const slot = (start, stop, actions = []) => ({ start, ...(stop !== undefined ? { stop } : {}), actions, conditions });
const entry = (slots) => ({ weekdays: ['daily'], slots });
const schedule = (slots) => ({
  entries: [entry(slots)],
  next_entries: [],
  timestamps: [],
  repeat_type: 'repeat',
  enabled: true,
});
const times = (slots) => slots.map((e) => [e.start, e.stop, e.actions.length]);
const fixed = (hours, minutes) => ({ mode: 'fixed', hours, minutes });

let checks = 0;
const failures = [];
const check = (name, fn) => {
  checks++;
  try {
    fn();
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};

// choosing the editor for an existing schedule
check('checkpoint opens in single mode', () =>
  assert.equal(
    detectEditorMode(
      entry([slot('00:00:00', '08:00:00'), slot('08:00:00', undefined, [action]), slot('08:01:00', '00:00:00')])
    ),
    'single'
  )
);
check('one timeslot with end time opens in interval mode', () =>
  assert.equal(
    detectEditorMode(
      entry([slot('00:00:00', '08:00:00'), slot('08:00:00', '09:00:00', [action]), slot('09:00:00', '00:00:00')])
    ),
    'interval'
  )
);
check('one timeslot among many empty slots opens in interval mode', () =>
  assert.equal(
    detectEditorMode(
      entry([
        slot('00:00:00', '04:00:00'),
        slot('04:00:00', '08:00:00'),
        slot('08:00:00', '09:00:00', [action]),
        slot('09:00:00', '00:00:00'),
      ])
    ),
    'interval'
  )
);
check('two timeslots open in scheme mode', () =>
  assert.equal(
    detectEditorMode(entry([slot('00:00:00', '08:00:00', [action]), slot('08:00:00', '00:00:00', [action])])),
    'scheme'
  )
);
check('new schedule uses default_editor', () =>
  assert.equal(
    detectEditorMode(
      entry([slot('00:00:00', '12:00:00'), slot('12:00:00', '13:00:00'), slot('13:00:00', '00:00:00')]),
      'interval'
    ),
    'interval'
  )
);
check('scheme default_editor keeps a timeslot with end time in scheme mode', () =>
  assert.equal(
    detectEditorMode(
      entry([slot('00:00:00', '08:00:00'), slot('08:00:00', '09:00:00', [action]), slot('09:00:00', '00:00:00')]),
      'scheme'
    ),
    'scheme'
  )
);
check('scheme default_editor keeps a checkpoint in scheme mode', () =>
  assert.equal(
    detectEditorMode(
      entry([slot('00:00:00', '08:00:00'), slot('08:00:00', undefined, [action]), slot('08:01:00', '00:00:00')]),
      'scheme'
    ),
    'scheme'
  )
);
check('interval default_editor opens a checkpoint in single mode', () =>
  assert.equal(
    detectEditorMode(
      entry([slot('00:00:00', '08:00:00'), slot('08:00:00', undefined, [action]), slot('08:01:00', '00:00:00')]),
      'interval'
    ),
    'single'
  )
);
check('single default_editor opens a timeslot with end time in interval mode', () =>
  assert.equal(
    detectEditorMode(
      entry([slot('00:00:00', '08:00:00'), slot('08:00:00', '09:00:00', [action]), slot('09:00:00', '00:00:00')]),
      'single'
    ),
    'interval'
  )
);
check('interval default_editor opens two timeslots in scheme mode', () =>
  assert.equal(
    detectEditorMode(
      entry([slot('00:00:00', '08:00:00', [action]), slot('08:00:00', '00:00:00', [action])]),
      'interval'
    ),
    'scheme'
  )
);
check('new schedule without default_editor uses single mode', () =>
  assert.equal(
    detectEditorMode(entry([slot('00:00:00', '12:00:00'), slot('12:00:00', undefined), slot('12:01:00', '00:00:00')])),
    'single'
  )
);

// switching modes
check('single to interval adds one hour', () => {
  const [out, idx] = convertToInterval(
    schedule([slot('00:00:00', '08:00:00'), slot('08:00:00', undefined, [action]), slot('08:01:00', '00:00:00')]),
    hass,
    0,
    1
  );
  assert.deepEqual(times(out.entries[0].slots), [
    ['00:00:00', '08:00:00', 0],
    ['08:00:00', '09:00:00', 1],
    ['09:00:00', '00:00:00', 0],
  ]);
  assert.equal(idx, 1);
});
check('single to interval near midnight ends at midnight', () => {
  const [out, idx] = convertToInterval(
    schedule([slot('00:00:00', '23:30:00'), slot('23:30:00', undefined, [action]), slot('23:31:00', '00:00:00')]),
    hass,
    0,
    1
  );
  assert.deepEqual(times(out.entries[0].slots), [
    ['00:00:00', '23:30:00', 0],
    ['23:30:00', '00:00:00', 1],
  ]);
  assert.equal(idx, 1);
});
check('single at midnight to interval selects the first slot', () => {
  const [out, idx] = convertToInterval(
    schedule([slot('00:00:00', undefined, [action]), slot('00:01:00', '00:00:00')]),
    hass,
    0,
    0
  );
  assert.deepEqual(times(out.entries[0].slots), [
    ['00:00:00', '01:00:00', 1],
    ['01:00:00', '00:00:00', 0],
  ]);
  assert.equal(idx, 0);
});
check('scheme to interval keeps the first action and its times', () => {
  const [out, idx] = convertToInterval(
    schedule([
      slot('00:00:00', '06:00:00'),
      slot('06:00:00', '10:00:00', [action]),
      slot('10:00:00', '18:00:00', [action]),
      slot('18:00:00', '00:00:00'),
    ]),
    hass,
    0,
    2
  );
  assert.deepEqual(times(out.entries[0].slots), [
    ['00:00:00', '06:00:00', 0],
    ['06:00:00', '10:00:00', 1],
    ['10:00:00', '00:00:00', 0],
  ]);
  assert.equal(idx, 1);
});
check('scheme without actions to interval keeps the selected slot', () => {
  const [out, idx] = convertToInterval(
    schedule([slot('00:00:00', '08:00:00'), slot('08:00:00', '16:00:00'), slot('16:00:00', '00:00:00')]),
    hass,
    0,
    2
  );
  assert.deepEqual(times(out.entries[0].slots), [
    ['00:00:00', '16:00:00', 0],
    ['16:00:00', '00:00:00', 0],
  ]);
  assert.equal(idx, 1);
});

// changing times
const interval = () => [
  slot('00:00:00', '08:00:00'),
  slot('08:00:00', '09:00:00', [action]),
  slot('09:00:00', '00:00:00'),
];
check('end time can be moved', () => {
  const [out, idx] = setIntervalTime(interval(), 1, { stop: fixed(10, 30) }, hass);
  assert.deepEqual(times(out), [
    ['00:00:00', '08:00:00', 0],
    ['08:00:00', '10:30:00', 1],
    ['10:30:00', '00:00:00', 0],
  ]);
  assert.equal(idx, 1);
});
check('end time at midnight closes the day', () => {
  const [out] = setIntervalTime(interval(), 1, { stop: fixed(0, 0) }, hass);
  assert.deepEqual(times(out), [
    ['00:00:00', '08:00:00', 0],
    ['08:00:00', '00:00:00', 1],
  ]);
});
check('end time 24:00 from the picker closes the day', () => {
  const stop = fixed(24, 0);
  const [out] = setIntervalTime(interval(), 1, { stop }, hass);
  assert.deepEqual(times(out), [
    ['00:00:00', '08:00:00', 0],
    ['08:00:00', '00:00:00', 1],
  ]);
  assert.deepEqual(stop, fixed(24, 0));
});
check('end time 24:00 with start 23:59', () => {
  const [out] = setIntervalTime(interval(), 1, { start: fixed(23, 59), stop: fixed(24, 0) }, hass);
  assert.deepEqual(times(out), [
    ['00:00:00', '23:59:00', 0],
    ['23:59:00', '00:00:00', 1],
  ]);
});
check('end time before start is limited to one minute after start', () => {
  const [out] = setIntervalTime(interval(), 1, { stop: fixed(7, 0) }, hass);
  assert.deepEqual(times(out), [
    ['00:00:00', '08:00:00', 0],
    ['08:00:00', '08:01:00', 1],
    ['08:01:00', '00:00:00', 0],
  ]);
});
check('start moved past end is limited to one minute before end', () => {
  const [out, idx] = setIntervalTime(interval(), 1, { start: fixed(12, 0) }, hass);
  assert.deepEqual(times(out), [
    ['00:00:00', '08:59:00', 0],
    ['08:59:00', '09:00:00', 1],
    ['09:00:00', '00:00:00', 0],
  ]);
  assert.equal(idx, 1);
});
check('start at midnight selects the first slot', () => {
  const [out, idx] = setIntervalTime(interval(), 1, { start: fixed(0, 0) }, hass);
  assert.deepEqual(times(out), [
    ['00:00:00', '09:00:00', 1],
    ['09:00:00', '00:00:00', 0],
  ]);
  assert.equal(idx, 0);
});
check('slot without action keeps working', () => {
  const [out, idx] = setIntervalTime(
    [slot('00:00:00', '12:00:00'), slot('12:00:00', '13:00:00'), slot('13:00:00', '00:00:00')],
    1,
    { stop: fixed(14, 0) },
    hass
  );
  assert.deepEqual(times(out), [
    ['00:00:00', '12:00:00', 0],
    ['12:00:00', '14:00:00', 0],
    ['14:00:00', '00:00:00', 0],
  ]);
  assert.equal(idx, 1);
});

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`${checks} checks passed`);
