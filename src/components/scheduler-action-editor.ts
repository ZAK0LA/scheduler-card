import { mdiDotsVertical } from '@mdi/js';
import { CSSResultGroup, LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators';
import { HassEntity } from 'home-assistant-js-websocket';
import { Action, CardConfig } from '../types';
import { HomeAssistant } from '../lib/types';
import { NumberSelector, Selector } from '../lib/selector';
import { actionConfig } from '../data/actions/action_config';
import { defaultSelectorValue } from '../data/selectors/default_selector_value';
import { isSupportedSelector } from '../data/selectors/is_supported_selector';
import { selectorConfig } from '../data/selectors/selector_config';
import { formatFieldDisplay } from '../data/format/format_field_display';
import { formatActionDisplay } from '../data/format/format_action_display';
import { computeActionIcon } from '../data/format/compute_action_icon';
import { computeEntityDisplay } from '../data/format/compute_entity_display';
import { computeDomain } from '../lib/entity';
import { fireEvent } from '../lib/fire_event';
import { isDefined } from '../lib/is_defined';
import { capitalizeFirstLetter } from '../lib/capitalize_first_letter';
import { localize } from '../localize/localize';
import { hassLocalize } from '../localize/hassLocalize';
import { DialogSelectActionParams } from '../dialogs/dialog-select-action';

import '../dialogs/dialog-select-action';
import './scheduler-entity-picker';
import './scheduler-collapsible-section';
import './scheduler-settings-row';
import './scheduler-combo-selector';

// The domains and entities of a list of actions, used to limit the action dialog to them.
export const computeActionDialogFilter = (actions: Action[]) => {
  const entities = [...new Set(actions.map((e) => [e.target?.entity_id || []].flat()).flat())];
  const domains = [
    ...new Set(actions.map((e) => [e.service, ...[e.target?.entity_id || []].flat()].map(computeDomain)).flat()),
  ];
  return {
    domainFilter: domains.length ? domains : undefined,
    entityFilter: entities.length ? entities : undefined,
  };
};

// Edits a single action: the entity and the fields of the action.
// Fires 'action-changed' with the new action, or without an action after it was deleted,
// and 'entity-changed' with the chosen entities, so that the parent decides where the entity applies.
@customElement('scheduler-action-editor')
export class SchedulerActionEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config!: CardConfig;
  @property({ attribute: false }) public action?: Action;
  // the action can't be changed or deleted
  @property({ type: Boolean }) public locked = false;
  // the entity can't be changed, for example because other timeslots use it
  @property({ type: Boolean }) public entityFixed = false;
  // limits the action dialog, see computeActionDialogFilter
  @property({ attribute: false }) public domainFilter?: string[];
  @property({ attribute: false }) public entityFilter?: string[];
  // target that an action chosen in the dialog gets, if it has a target
  @property({ attribute: false }) public keepTarget?: Action['target'];
  // offers 'show all' in the action dialog, which ignores include / exclude
  @property({ type: Boolean }) public allowShowAll = true;
  @property() public addLabel?: string;
  @property() public addIcon = 'mdi:plus';

  render() {
    const action = this.action;
    if (!action)
      return html`
        <div>
          ${
            this.locked
              ? ''
              : html`
                  <ha-button appearance="plain" @click=${this.showActionDialog}>
                    <ha-icon slot="start" icon=${this.addIcon}></ha-icon>
                    ${this.addLabel || localize('ui.panel.editor.add_action', this.hass)}
                  </ha-button>
                `
          }
        </div>
      `;

    const config = actionConfig(action, this.config.customize, this.hass);
    if (config === undefined) return html``;
    const domain = config.target?.domain || computeDomain(action.service);
    const entityFixed = this.entityFixed || isDefined(config.target?.entity_id);

    const fields = Object.keys(config.fields || {}).filter((e) =>
      isSupportedSelector(action, e, this.hass!, this.config.customize)
    );

    let heading = '';

    let entityIds = [action.target?.entity_id || []].flat();
    if (!entityIds.length && ['notify', 'script'].includes(domain)) entityIds = [action.service];

    if (entityIds.length) {
      heading += entityIds.map((e) => computeEntityDisplay(e, this.hass, this.config.customize)).join(', ');
      heading += ': ';
    }
    heading += formatActionDisplay(action, this.hass, this.config.customize, false, true);

    return html`
      <scheduler-collapsible-section ?expanded=${true} ?disabled=${true}>
        <div slot="header" class="header">
          <ha-icon slot="icon" icon="${computeActionIcon(action, this.config.customize)}"></ha-icon>
          <span>${capitalizeFirstLetter(heading)}</span>
        </div>

        ${
          this.locked
            ? ''
            : html`
                <ha-dropdown
                  slot="contextMenu"
                  @wa-select=${this._actionItemOptionsClick}
                  @wa-after-hide=${(ev: Event) => {
                    ((ev.target as HTMLElement).firstElementChild as HTMLElement).blur();
                  }}
                  placement="bottom-end"
                >
                  <ha-icon-button slot="trigger" .path=${mdiDotsVertical}> </ha-icon-button>
                  <ha-dropdown-item value="change_type">
                    <ha-icon icon="mdi:pencil"></ha-icon>
                    ${hassLocalize('ui.panel.lovelace.editor.card.conditional.change_type', this.hass)}
                  </ha-dropdown-item>
                  <ha-dropdown-item variant="danger" value="delete">
                    <ha-icon icon="mdi:delete"></ha-icon>
                    ${hassLocalize('ui.common.delete', this.hass)}
                  </ha-dropdown-item>
                </ha-dropdown>
              `
        }

        <div slot="content">
          ${
            config.target
              ? html`
                  <scheduler-settings-row>
                    <span slot="heading">${hassLocalize('ui.components.entity.entity-picker.entity', this.hass)}</span>
                    <scheduler-entity-picker
                      .hass=${this.hass}
                      .config=${this.config}
                      .domain=${domain}
                      .filterFunc=${(stateObj: HassEntity) => (config.supported_features ? ((stateObj.attributes.supported_features || 0) & config.supported_features) > 0 : true)}
                      @value-changed=${this._selectEntity}
                      .value=${[action.target?.entity_id || []].flat()}
                      ?multiple=${true}
                      ?disabled=${entityFixed || this.locked}
                    >
                    </scheduler-entity-picker>
                  </scheduler-settings-row>
                `
              : ''
          }
          ${fields.map((field) => {
            const selector = selectorConfig(
              action.service,
              action.target?.entity_id,
              field,
              this.hass!,
              this.config.customize
            );
            if (selector === null) return '';
            const optional: boolean | undefined =
              config.fields![field].optional || ((selector as NumberSelector).number || {}).optional;
            const checked = optional ? Object.keys(action.service_data).includes(field) : true;
            return html`
              <scheduler-settings-row ?showPrefix=${optional}>
                ${
                  optional
                    ? html`
                        <ha-checkbox
                          slot="prefix"
                          ?checked=${checked}
                          ?disabled=${this.locked}
                          @change=${(ev: Event) => this._toggleOptionalField(ev, field, selector)}
                        >
                        </ha-checkbox>
                      `
                    : ''
                }
                <span slot="heading"> ${formatFieldDisplay(action, field, this.hass, this.config.customize)} </span>
                <scheduler-combo-selector
                  .hass=${this.hass}
                  .config=${selector}
                  ?disabled=${!checked || this.locked}
                  .value=${Object.keys(action.service_data).includes(field) ? action.service_data[field] : undefined}
                  @value-changed=${(ev: CustomEvent) => this._selectField(field, ev.detail.value)}
                >
                </scheduler-combo-selector>
              </scheduler-settings-row>
            `;
          })}
        </div>
      </scheduler-collapsible-section>
    `;
  }

  // Opens the action dialog and fires 'action-changed' with the chosen action.
  async showActionDialog(ev: Event) {
    await new Promise<Action | null>((resolve) => {
      const params: DialogSelectActionParams = {
        cancel: () => resolve(null),
        confirm: (out: Action) => resolve(out),
        domainFilter: this.domainFilter,
        entityFilter: this.entityFilter,
        cardConfig: this.config,
        allowShowAll: this.allowShowAll,
      };

      fireEvent(ev.target as HTMLElement, 'show-dialog', {
        dialogTag: 'dialog-select-action',
        dialogImport: () => import('../dialogs/dialog-select-action'),
        dialogParams: params,
      });
    }).then((res: Action | null) => {
      if (!res) return;
      let action = { ...res };
      if (this.keepTarget && action.target) action = { ...action, target: this.keepTarget };
      this._actionChanged(action);
    });
  }

  private _selectField(field: string, value: any) {
    if (!this.action) return;
    const action: Action =
      value !== undefined
        ? {
            ...this.action,
            service_data: {
              ...this.action.service_data,
              [field]: value,
            },
          }
        : {
            ...this.action,
            service_data: Object.fromEntries(Object.entries(this.action.service_data).filter(([key]) => key != field)),
          };
    this._actionChanged(action);
  }

  private _toggleOptionalField(ev: Event, field: string, selector: Selector) {
    const checked = (ev.target as HTMLInputElement).checked;
    if (checked) {
      const value = defaultSelectorValue(selector);
      this._selectField(field, isDefined(value) ? value : null);
    } else {
      this._selectField(field, undefined);
    }
  }

  private _selectEntity(ev: CustomEvent) {
    const entity = ev.detail.value as string | string[] | undefined;
    if (!entity) return;
    this.dispatchEvent(new CustomEvent('entity-changed', { detail: { entity_id: entity } }));
  }

  private _actionItemOptionsClick(ev: CustomEvent) {
    const option: 'delete' | 'change_type' = ev.detail.item.value;
    switch (option) {
      case 'change_type':
        this.showActionDialog(ev);
        break;
      case 'delete':
        this._actionChanged(undefined);
        break;
    }
  }

  private _actionChanged(action: Action | undefined) {
    this.dispatchEvent(new CustomEvent('action-changed', { detail: { action } }));
  }

  static get styles(): CSSResultGroup {
    return css`
      scheduler-collapsible-section .header ha-icon {
        margin-right: 6px;
      }
      scheduler-collapsible-section .header span {
        flex: 1;
      }
    `;
  }
}
