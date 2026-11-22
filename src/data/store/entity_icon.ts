import { HomeAssistant } from '../../lib/types';

// custom icon of an entity as set in the entity registry, undefined if the entity uses its default icon
export const getEntityIcon = (hass: HomeAssistant, entityId: string): string | undefined =>
  hass.entities?.[entityId]?.icon || undefined;

// set (or with null: remove) the custom icon of an entity, requires an admin user
export const updateEntityIcon = (hass: HomeAssistant, entityId: string, icon: string | null): Promise<unknown> =>
  hass
    .callWS({
      type: 'config/entity_registry/update',
      entity_id: entityId,
      icon: icon,
    })
    .catch((e: { code?: string; message?: string }) => {
      // websocket errors have a different format than the API errors handled by handleWebsocketError
      throw { body: { message: e.message }, error: e.code };
    });
