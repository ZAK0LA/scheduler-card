import { computeDomain } from '../../lib/entity';
import { deepCompare } from '../../lib/deep_compare';
import { HomeAssistant } from '../../lib/types';
import { localize } from '../../localize/localize';
import { Action, CardConfig, DefaultActionConfig, EditorMode, Schedule, Timeslot } from '../../types';
import { validateAction } from '../schedule/validate_schedule';
import { actionSupportsEntity } from './action_supports_entity';
import { computeActionsForDomain } from './compute_actions_for_domain';
import { entityIncludedByConfig } from './entity_included_by_config';
import { supportedActions } from './supported_actions';

export enum DefaultActionError {
  NoDefaultActions = 'no_default_actions',
  MultipleActions = 'multiple_actions',
  MissingEntity = 'missing_entity',
  ActionEntityMismatch = 'action_entity_mismatch',
  EntityNotIncluded = 'entity_not_included',
  EntityUnavailable = 'entity_unavailable',
  ActionNotFound = 'action_not_found',
  ActionIncomplete = 'action_incomplete',
}

// Why there is no default action, with the service and the entity involved, if any.
export interface DefaultActionFailure {
  error: DefaultActionError;
  service?: string;
  entity?: string;
}

export type DefaultActionResult =
  { action: Action; error?: undefined } | ({ action?: undefined } & DefaultActionFailure);

// Domains whose services are entities themselves, such as 'script.wake_up'. They have no target entity.
const serviceIsEntity = (domain: string) => Object.keys(supportedActions[domain] || {}).includes('{entity_id}');

const cloneAction = (action: Action): Action => ({
  ...action,
  service_data: { ...action.service_data },
  ...(action.target
    ? {
        target: {
          ...action.target,
          entity_id: Array.isArray(action.target.entity_id) ? [...action.target.entity_id] : action.target.entity_id,
        },
      }
    : {}),
});

// Computes the action for new schedules from 'default_actions'.
// 'default_actions' has the format of the actions of a timeslot in scheduler.add: one entry per entity, with
// 'service', 'entity_id' and 'service_data'. The editor shows one action per timeslot, for one or more entities,
// so the entries may only differ in 'entity_id'.
export const resolveDefaultAction = (hass: HomeAssistant, config: CardConfig): DefaultActionResult => {
  const entries: DefaultActionConfig[] = [config.default_actions || []].flat();
  if (!entries.length) return { error: DefaultActionError.NoDefaultActions };

  const service = String(entries[0].service).trim();
  const data = entries[0].service_data || {};
  if (
    entries.some(
      (e) => String(e.service).trim().toLowerCase() != service.toLowerCase() || !deepCompare(e.service_data || {}, data)
    )
  )
    return { error: DefaultActionError.MultipleActions };

  const serviceDomain = computeDomain(service);
  const isEntity = serviceIsEntity(serviceDomain);

  // a script is executed by its own service, so its entity_id can only be the script itself
  let entities: string[];
  if (isEntity) {
    const other = entries.find((e) => e.entity_id && e.entity_id.toLowerCase() != service.toLowerCase());
    if (other) return { error: DefaultActionError.ActionEntityMismatch, service, entity: other.entity_id };
    entities = [service];
  } else {
    if (entries.some((e) => !e.entity_id)) return { error: DefaultActionError.MissingEntity, service };
    entities = [...new Set(entries.map((e) => e.entity_id!))];
  }

  // the editor lets the user choose entities of one domain for an action
  const entityDomain = computeDomain(entities[0]);
  const otherDomain = entities.find((e) => computeDomain(e) != entityDomain);
  if (otherDomain) return { error: DefaultActionError.ActionEntityMismatch, service, entity: otherDomain };

  // for a script, first check that the service is a script at all (and not, for example, script.turn_on)
  const items = isEntity
    ? computeActionsForDomain(hass, serviceDomain, { ...config, include: [service], exclude: [] })
    : computeActionsForDomain(hass, entityDomain, config);
  const candidates = items.filter((e) => e.action.service.toLowerCase() == service.toLowerCase());
  if (isEntity && !candidates.length) return { error: DefaultActionError.ActionNotFound, service };

  // the same include / exclude rules as for the entities that can be chosen in the editor
  for (const entity of entities) {
    if (!entityIncludedByConfig(entity, config))
      return { error: DefaultActionError.EntityNotIncluded, service, entity };
    // notify services have no state, scripts and target entities have
    const stateObj = hass.states[entity];
    if ((!isEntity && !stateObj) || stateObj?.state == 'unavailable')
      return { error: DefaultActionError.EntityUnavailable, service, entity };
  }

  if (!candidates.length)
    return {
      error:
        entityDomain != serviceDomain ? DefaultActionError.ActionEntityMismatch : DefaultActionError.ActionNotFound,
      service,
      entity: entities[0],
    };

  // the action must be available for every entity, as in the action dialog
  const unsupported = entities.find((entity) =>
    candidates.every((e) => !actionSupportsEntity(e.action, entity, hass, config.customize))
  );
  if (unsupported) return { error: DefaultActionError.ActionNotFound, service, entity: unsupported };
  const supported = candidates.filter((e) =>
    entities.every((entity) => actionSupportsEntity(e.action, entity, hass, config.customize))
  );
  if (!supported.length) return { error: DefaultActionError.ActionNotFound, service, entity: entities[0] };

  // a custom action from 'customize' is preferred when its service data is part of the data
  const fitsData = (e: (typeof supported)[number]) =>
    Object.entries(e.action.service_data).every(([key, value]) => deepCompare(data[key], value));
  const item =
    supported
      .filter(fitsData)
      .sort((a, b) => Object.keys(b.action.service_data).length - Object.keys(a.action.service_data).length)[0] ||
    supported[0];

  // the same structure as an action read from the storage: one entity as a string, several as a list
  const action: Action = {
    ...item.action,
    service_data: { ...item.action.service_data, ...data },
    target: item.action.target
      ? { ...item.action.target, entity_id: entities.length == 1 ? entities[0] : entities }
      : undefined,
  };
  if (action.target === undefined) delete action.target;
  if (validateAction(action, hass, config.customize))
    return { error: DefaultActionError.ActionIncomplete, service, entity: isEntity ? undefined : entities[0] };

  return { action };
};

// An action that still needs its entity, which 'default_actions' can't be without (scripts have none).
export const defaultActionMissingEntity = (action: Action) =>
  !serviceIsEntity(computeDomain(action.service)) && ![action.target?.entity_id || []].flat().length;

// Writes an action as 'default_actions', in the format of the actions of a timeslot in scheduler.add:
// one entry per entity, 'service_data' only when it isn't empty, and no 'entity_id' for a script.
// Every entry gets its own copy of the data, so that the YAML of the card has no anchors.
export const defaultActionsFromAction = (action: Action): DefaultActionConfig[] => {
  const service = action.service;
  const entities = serviceIsEntity(computeDomain(service)) ? [] : [action.target?.entity_id || []].flat();
  const entry = (entity?: string): DefaultActionConfig => ({
    service,
    ...(entity ? { entity_id: entity } : {}),
    ...(Object.keys(action.service_data || {}).length
      ? { service_data: JSON.parse(JSON.stringify(action.service_data)) }
      : {}),
  });
  return entities.length ? entities.map((e) => entry(e)) : [entry()];
};

// The message for a missing default action, naming the service and the entity involved.
// Parts in [brackets] are left out when their placeholder has no value.
export const defaultActionErrorMessage = (failure: DefaultActionFailure, hass: HomeAssistant) => {
  const values = Object.entries({ '{service}': failure.service, '{entity}': failure.entity }).filter(
    ([, value]) => value
  );
  return localize(
    `ui.panel.editor.default_action_errors.${failure.error}`,
    hass,
    values.map(([key]) => key),
    values.map(([, value]) => value!)
  );
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
        slot.actions.length || !receivesAction(slot) ? { ...slot } : { ...slot, actions: [cloneAction(action)] }
      ),
    };
  }),
});

// The entities an action is executed for: its target entities, or for actions without a target (scripts) the service.
const actionEntities = (action: Action) =>
  action.target ? [action.target.entity_id || []].flat().sort().join(',') : action.service;

// Whether the default action can be added to a schedule, i.e. the schedule has no actions for other entities.
export const defaultActionFitsSchedule = (schedule: Schedule, action: Action) =>
  schedule.entries.every((entry) =>
    entry.slots.every((slot) => slot.actions.every((e) => actionEntities(e) == actionEntities(action)))
  );
