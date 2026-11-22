// Run with: node scripts/check_entity_icon.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

const { getEntityIcon, updateEntityIcon } = require('../src/data/store/entity_icon.ts');
const { validateConfig } = require('../src/data/validate_config.ts');

const entityId = 'switch.schedule_123456';

(async () => {
  // display_options.icon accepts schedule next to action and entity
  for (const icon of ['action', 'entity', 'schedule']) {
    assert.deepEqual(validateConfig({ display_options: { icon } }), { display_options: { icon } });
  }
  assert.throws(() => validateConfig({ display_options: { icon: 'custom' } }), /'icon'/);

  // only an icon set in the entity registry counts as custom icon
  assert.equal(getEntityIcon({}, entityId), undefined);
  assert.equal(getEntityIcon({ entities: { [entityId]: { entity_id: entityId } } }, entityId), undefined);
  assert.equal(getEntityIcon({ entities: { [entityId]: { entity_id: entityId, icon: '' } } }, entityId), undefined);
  assert.equal(
    getEntityIcon({ entities: { [entityId]: { entity_id: entityId, icon: 'mdi:beach' } } }, entityId),
    'mdi:beach'
  );

  // the icon is written to (or with null: removed from) the entity registry
  const calls = [];
  const hass = { callWS: async (msg) => calls.push(msg) };
  await updateEntityIcon(hass, entityId, 'mdi:beach');
  await updateEntityIcon(hass, entityId, null);
  assert.deepEqual(calls, [
    { type: 'config/entity_registry/update', entity_id: entityId, icon: 'mdi:beach' },
    { type: 'config/entity_registry/update', entity_id: entityId, icon: null },
  ]);

  // websocket errors are converted to the format of the shared error dialog
  const failingHass = { callWS: async () => Promise.reject({ code: 'unauthorized', message: 'Unauthorized' }) };
  await assert.rejects(updateEntityIcon(failingHass, entityId, 'mdi:beach'), {
    body: { message: 'Unauthorized' },
    error: 'unauthorized',
  });

  console.log('PASS: schedule entity icon checks');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
