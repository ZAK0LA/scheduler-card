import { computeDomain, computeEntity } from '../../lib/entity';
import { HomeAssistant } from '../../lib/types';
import { Action, CardConfig, CustomActionConfig, EditorMode, Schedule, Timeslot } from '../../types';
import { validateAction } from '../schedule/validate_schedule';
import { actionSupportsEntity } from './action_supports_entity';
import { computeActionsForDomain } from './compute_actions_for_domain';
import { entityIncludedByConfig } from './entity_included_by_config';

export enum DefaultActionError {
  NoDefaultEntity = 'no_default_entity',
  EntityNotIncluded = 'entity_not_included',
  EntityUnavailable = 'entity_unavailable',
  NoDefaultAction = 'no_default_action',
  ActionNotFound = 'action_not_found',
  ActionIncomplete = 'action_incomplete',
}

export type DefaultActionResult =
  { action: Action; error?: undefined } | { action?: undefined; error: DefaultActionError };

// Computes the action for new schedules from 'default_entity' and 'default_actions'.
export const resolveDefaultAction = (hass: HomeAssistant, config: CardConfig): DefaultActionResult => {
  const entity = config.default_entity;
  if (!entity) return { error: DefaultActionError.NoDefaultEntity };
  if (!entityIncludedByConfig(entity, config)) return { error: DefaultActionError.EntityNotIncluded };

  const stateObj = hass.states[entity];
  if (!stateObj || stateObj.state == 'unavailable') return { error: DefaultActionError.EntityUnavailable };

  const domain = computeDomain(entity);
  const defaultConfig = (config.default_actions || {})[domain];
  if (defaultConfig === undefined || defaultConfig === null) return { error: DefaultActionError.NoDefaultAction };

  const key = typeof defaultConfig == 'object' ? defaultConfig.action : defaultConfig;
  const data = (typeof defaultConfig == 'object' && defaultConfig.data) || {};

  const items = computeActionsForDomain(hass, domain, config).filter((item) =>
    actionSupportsEntity(item.action, entity, hass, config.customize)
  );

  let item: (typeof items)[number] | undefined;
  if (typeof key == 'number') {
    // index into the action list, kept for compatibility; action names are preferred
    item = items[key];
  } else {
    const name = String(key).trim().toLowerCase();
    item =
      items.find((e) => e.key.toLowerCase() == name) ||
      items.find(
        (e) => e.action.service.toLowerCase() == name || computeEntity(e.action.service).toLowerCase() == name
      ) ||
      items.find((e) => ((e.action as CustomActionConfig).name || '').toLowerCase() == name);
  }
  if (!item) return { error: DefaultActionError.ActionNotFound };

  const action: Action = {
    ...item.action,
    service_data: { ...item.action.service_data, ...data },
    target: item.action.target ? { ...item.action.target, entity_id: entity } : undefined,
  };
  if (action.target === undefined) delete action.target;
  if (validateAction(action, hass, config.customize)) return { error: DefaultActionError.ActionIncomplete };

  return { action };
};

// Assigns the default action to a new schedule: in the single editor to the timeslot without a stop time,
// in the scheme editor to every timeslot. Without a mode, it is derived from the timeslots.
export const applyDefaultAction = (schedule: Schedule, action: Action, mode?: EditorMode): Schedule => ({
  ...schedule,
  entries: schedule.entries.map((entry) => {
    const entryMode = mode || (entry.slots.some((e) => e.stop === undefined) ? EditorMode.Single : EditorMode.Scheme);
    const receivesAction = (slot: Timeslot) => entryMode == EditorMode.Scheme || slot.stop === undefined;
    return {
      ...entry,
      slots: entry.slots.map((slot) =>
        slot.actions.length || !receivesAction(slot)
          ? { ...slot }
          : { ...slot, actions: [{ ...action, service_data: { ...action.service_data } }] }
      ),
    };
  }),
});

// Whether the default action can be added to a schedule, i.e. the schedule has no actions for other entities.
export const defaultActionFitsSchedule = (schedule: Schedule, action: Action) => {
  const target = [action.target?.entity_id || []].flat().sort().join(',');
  return schedule.entries.every((entry) =>
    entry.slots.every((slot) =>
      slot.actions.every((e) => [e.target?.entity_id || []].flat().sort().join(',') == target)
    )
  );
};
