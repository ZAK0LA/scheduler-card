import { HomeAssistant } from '../../lib/types';
import { Action, CustomConfig } from '../../types';
import { actionConfig } from './action_config';

// Whether an action from the action list can be used for the given entity.
export const actionSupportsEntity = (action: Action, entity: string, hass: HomeAssistant, customize?: CustomConfig) => {
  const config = actionConfig(action, customize, hass);
  const stateObj = hass.states[entity];
  if (config.supported_features && !((stateObj?.attributes.supported_features || 0) & config.supported_features))
    return false;
  else if (Object.keys(action.service_data).includes('entity_id') && action.service_data.entity_id != entity)
    return false;
  else if (Object.keys(action.target || {}).includes('entity_id') && (action.target || {}).entity_id != entity)
    return false;
  else return true;
};
