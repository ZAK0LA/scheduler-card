import {
  mdiChevronLeft,
  mdiChevronRight,
  mdiDotsVertical,
  mdiPencil,
  mdiShapeRectanglePlus,
  mdiTrashCanOutline,
} from '@mdi/js';
import { CSSResultGroup, LitElement, PropertyValues, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators';
import { Action, CardConfig, EditorMode, Schedule, ScheduleEntry, TWeekday, Time, Timeslot } from '../types';
import { DefaultActionFailure, defaultActionErrorMessage } from '../data/actions/default_action';
import { actionConfig } from '../data/actions/action_config';
import { formatWeekdayDisplay } from '../data/days';
import { defaultSelectorValue } from '../data/selectors/default_selector_value';
import { isSupportedSelector } from '../data/selectors/is_supported_selector';
import { selectorConfig } from '../data/selectors/selector_config';
import { NumberSelector, Selector } from '../lib/selector';
import { DialogSelectActionParams } from './dialog-select-action';
import { DialogSelectWeekdayParams } from './dialog-select-weekdays';

import { computeDomain } from '../lib/entity';
import { computeTimestamp } from '../data/time/compute_timestamp';
import { HomeAssistant } from '../lib/types';
import { localize } from '../localize/localize';
import { insertTimeslot } from '../data/schedule/insert_timeslot';
import { removeTimeslot } from '../data/schedule/remove_timeslot';
import { formatFieldDisplay } from '../data/format/format_field_display';
import { formatActionDisplay } from '../data/format/format_action_display';
import { computeActionIcon } from '../data/format/compute_action_icon';
import { fireEvent } from '../lib/fire_event';
import { useAmPm } from '../lib/use_am_pm';
import { capitalizeFirstLetter } from '../lib/capitalize_first_letter';
import { hassLocalize } from '../localize/hassLocalize';
import { isDefined } from '../lib/is_defined';
import { moveTimeslot } from '../data/schedule/move_timeslot';
import { defaultIntervalStop, setIntervalTime } from '../data/schedule/interval';
import { computeEntityDisplay } from '../data/format/compute_entity_display';
import { DEFAULT_TIME_STEP } from '../const';
import { HassEntity } from 'home-assistant-js-websocket';

import '../components/scheduler-timeslot-editor';
import '../components/scheduler-time-picker';
import type { SchedulerTimePicker } from '../components/scheduler-time-picker';
import '../components/scheduler-entity-picker';
import '../dialogs/dialog-select-weekdays';
import '../dialogs/dialog-select-action';
import '../components/scheduler-collapsible-section';
import '../components/scheduler-settings-row';
import '../components/scheduler-combo-selector';

@customElement('scheduler-main-panel')
export class SchedulerMainPanel extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config!: CardConfig;
  @property({ attribute: false }) public viewMode!: EditorMode;
  @property({ attribute: false }) public selectedSlot: number | null = null;
  @property({ type: Boolean }) public isNew = false;
  @property({ attribute: false }) public defaultAction?: Action;
  @property({ attribute: false }) public defaultActionError?: DefaultActionFailure;
  @property({ type: Boolean }) large = false;

  @state() schedule!: Schedule;
  @state() selectedEntry: number | null = 0;

  shouldUpdate(changedProps: PropertyValues): boolean {
    if (changedProps.get('schedule')) {
      this.dispatchEvent(new CustomEvent('change', { detail: { schedule: this.schedule } }));
    }
    return true;
  }

  // With show_actions: false the action section is hidden, which implies that the actions are locked.
  get actionsHidden() {
    return this.config.show_actions === false;
  }

  // Actions are read-only when lock_actions is set. A new schedule is only restricted if it got a default action.
  get actionsLocked() {
    if (this.actionsHidden) return true;
    return this.config.lock_actions === true && (!this.isNew || isDefined(this.defaultAction));
  }

  render() {
    return html`
      ${this.schedule.entries.map(
        (entry, num) => html`
          <div class="editor-header">
            <div class="weekdays">
              <span>
                ${localize('ui.panel.editor.repeated_days', this.hass)}:
                ${formatWeekdayDisplay(entry.weekdays, 'short', this.hass)}
              </span>
              <ha-icon-button
                .path=${mdiPencil}
                @click=${(ev: Event) => this._showWeekdayDialog(ev, num)}
              ></ha-icon-button>
            </div>
            <div class="weekdays-actions">
              ${
                this.config.show_editor_mode_button === false
                  ? ''
                  : html`
              <ha-dropdown
                @wa-select=${this._selectViewMode}
                @wa-after-hide=${(ev: Event) => {
          ((ev.target as HTMLElement).firstElementChild as HTMLElement).blur();
        }}
                placement="bottom-end"
              >
                <ha-button slot="trigger" appearance="plain" size="small">
                  ${localize(`ui.panel.editor.editor_mode.${this.viewMode}`, this.hass)}
                  <ha-icon slot="end" icon="mdi:swap-horizontal"></ha-icon>
                </ha-button>
                ${[EditorMode.Single, EditorMode.Interval, EditorMode.Scheme].map(
          (mode) => html`
                    <ha-dropdown-item value=${mode}>
                      <ha-icon icon="mdi:check" style="${this.viewMode == mode ? '' : 'visibility: hidden'}"></ha-icon>
                      ${localize(`ui.panel.editor.editor_mode.${mode}`, this.hass)}
                    </ha-dropdown-item>
                  `
        )}
              </ha-dropdown>
                    `
              }
            </div>
          </div>

          ${
            this.viewMode == EditorMode.Scheme
              ? html`
                  <div class="editor-header">
                    <div class="weekdays">${this.hass.localize('ui.dialogs.helper_settings.input_datetime.time')}:</div>
                    ${this.renderActionButtons()}
                  </div>
                  <scheduler-timeslot-editor
                    .hass=${this.hass}
                    .config=${this.config}
                    .schedule=${entry}
                    .selectedSlot=${this.selectedSlot}
                    @update=${(ev: CustomEvent) => this._handleUpdate(ev, num)}
                    .large=${this.large}
                  >
                  </scheduler-timeslot-editor>
                `
          : this.viewMode == EditorMode.Interval
            ? this.renderIntervalPickers()
            : html`
                  ${this.hass.localize('ui.dialogs.helper_settings.input_datetime.time')}:
                  <scheduler-time-picker
                    .hass=${this.hass}
                    .time=${this.schedule.entries[this.selectedEntry!].slots[this.selectedSlot!].start}
                    @value-changed=${this._startTimeChanged}
                    ?useAmPm=${useAmPm(this.hass.locale)}
                    .allowSunTimes=${this.config.show_sun_mode_button !== false}
                    .stepSize=${this.config.time_step || DEFAULT_TIME_STEP}
                    large
                  >
                  </scheduler-time-picker>
                `
          }
        `
      )}
      ${this.renderSlot()}
    `;
  }

  _selectViewMode(ev: CustomEvent) {
    const newViewMode: EditorMode = ev.detail.item.value;
    if (newViewMode == this.viewMode) return;
    this.dispatchEvent(new CustomEvent('setViewMode', { detail: newViewMode }));
  }

  renderIntervalPickers() {
    if (this.selectedEntry === null || this.selectedSlot === null) return html``;
    const slot = this.schedule.entries[this.selectedEntry].slots[this.selectedSlot];
    if (!slot) return html``;

    return html`
      <div class="interval">
        <div class="column">
          ${localize('ui.panel.editor.start_time', this.hass)}:
          <scheduler-time-picker
            .hass=${this.hass}
            .dayLimit=${'start'}
            .time=${slot.start}
            @value-changed=${(ev: CustomEvent) => this._intervalTimeChanged(ev, 'start')}
            ?useAmPm=${useAmPm(this.hass.locale)}
            .allowSunTimes=${this.config.show_sun_mode_button !== false}
            .stepSize=${this.config.time_step || DEFAULT_TIME_STEP}
            large
            stacked
          >
          </scheduler-time-picker>
        </div>
        <div class="column">
          ${localize('ui.panel.editor.stop_time', this.hass)}:
          <scheduler-time-picker
            .hass=${this.hass}
            .dayLimit=${'end'}
            .time=${slot.stop || defaultIntervalStop(slot.start, this.hass)}
            @value-changed=${(ev: CustomEvent) => this._intervalTimeChanged(ev, 'stop')}
            ?useAmPm=${useAmPm(this.hass.locale)}
            .allowSunTimes=${this.config.show_sun_mode_button !== false}
            .stepSize=${this.config.time_step || DEFAULT_TIME_STEP}
            large
            stacked
          >
          </scheduler-time-picker>
        </div>
      </div>
    `;
  }

  _intervalTimeChanged(ev: CustomEvent, field: 'start' | 'stop') {
    const value = ev.detail.value as Time;
    const [slots, slotIdxOut] = setIntervalTime(
      [...this.schedule.entries[this.selectedEntry!].slots],
      Number(this.selectedSlot),
      { [field]: value },
      this.hass
    );
    // Select the new slot index before the slots are replaced: a whole-day interval has a single slot, so the old
    // index may not exist in the new slots when the panel renders before the dialog passes the index back.
    if (slotIdxOut != this.selectedSlot) {
      this._updateSelectedSlot(slotIdxOut);
      this.selectedSlot = slotIdxOut;
    }
    this._updateEntry({ slots: slots });
    // When the time is limited to the same value as before, the .time binding doesn't change and the picker would
    // keep showing the time that was entered, so it is set directly.
    const time = slots[slotIdxOut][field];
    if (time) (ev.currentTarget as SchedulerTimePicker).time = time;
  }

  renderActionButtons() {
    if (this.selectedSlot === null || this.selectedEntry === null) return html``;

    const startTime = this.schedule.entries[this.selectedEntry].slots[this.selectedSlot].start;
    const stopTime = this.schedule.entries[this.selectedEntry].slots[this.selectedSlot].stop || startTime;

    const tsA = computeTimestamp(startTime, this.hass);
    const tsB = computeTimestamp(stopTime, this.hass) || 24 * 3600;

    const delta = tsB - tsA;

    // removing a timeslot merges it with its neighbour and discards the actions of the removed slot
    const slots = this.schedule.entries[this.selectedEntry].slots;
    const removedSlot = slots[this.selectedSlot == slots.length - 1 ? this.selectedSlot - 1 : this.selectedSlot];
    const removeDiscardsAction = this.actionsLocked && (removedSlot?.actions.length ?? 0) > 0;

    return html`
      <div class="actions">
        <ha-icon-button
          .path=${mdiChevronLeft}
          @click=${(ev: Event) => {
            this._updateSelectedSlot(this.selectedSlot! - 1);
            (ev.target as HTMLElement).blur();
          }}
          ?disabled=${this.selectedSlot === null || this.selectedSlot < 1}
        >
        </ha-icon-button>
        <ha-icon-button
          .path=${mdiChevronRight}
          @click=${(ev: Event) => {
            this._updateSelectedSlot(this.selectedSlot! + 1);
            (ev.target as HTMLElement).blur();
          }}
          ?disabled=${this.selectedSlot === null || this.selectedSlot > this.schedule.entries[this.selectedEntry].slots.length - 2}
        >
        </ha-icon-button>
        <ha-icon-button .path=${mdiShapeRectanglePlus} @click=${this._addTimeslot} ?disabled=${delta < 1800}>
        </ha-icon-button>
        <ha-icon-button
          .path=${mdiTrashCanOutline}
          @click=${this._removeTimeslot}
          ?disabled=${slots.length <= 2 || removeDiscardsAction}
        >
        </ha-icon-button>
      </div>
    `;
  }

  renderSlot() {
    if (this.selectedEntry === null || this.selectedSlot === null) {
      return html` <div class="slot-placeholder">${localize('ui.panel.editor.select_timeslot', this.hass)}</div> `;
    }
    const slot = this.schedule.entries[this.selectedEntry].slots[this.selectedSlot];
    const isLastSlot = this.selectedSlot === this.schedule.entries[this.selectedEntry!].slots.length - 1;
    const endTime = this._endTime(this.schedule.entries[this.selectedEntry].slots, this.selectedSlot);

    return html`
      ${
        this.viewMode == EditorMode.Scheme
          ? html` <div class="two-column">
              <div class="column">
                <scheduler-time-picker
                  .hass=${this.hass}
                  label="${localize('ui.panel.editor.start_time', this.hass)}:"
                  ?disabled=${this.selectedSlot == 0}
                  .time=${slot.start}
                  @value-changed=${this._startTimeChanged}
                  ?useAmPm=${useAmPm(this.hass.locale)}
                  .allowSunTimes=${this.config.show_sun_mode_button !== false}
                >
                </scheduler-time-picker>
              </div>
              <div class="column">
                <scheduler-time-picker
                  .hass=${this.hass}
                  label="${localize('ui.panel.editor.stop_time', this.hass)}:"
                  ?disabled=${isLastSlot}
                  .time=${endTime}
                  @value-changed=${this._stopTimeChanged}
                  ?useAmPm=${useAmPm(this.hass.locale)}
                  .allowSunTimes=${this.config.show_sun_mode_button !== false}
                >
                </scheduler-time-picker>
              </div>
            </div>`
          : ''
      }
      ${
        this.actionsHidden
          ? this.isNew && !this.defaultAction && this.defaultActionError
            ? html`<div class="warning">${defaultActionErrorMessage(this.defaultActionError, this.hass)}</div>`
            : ''
          : html`${localize('ui.panel.editor.action', this.hass)}: ${this._renderActionConfig()}`
      }
    `;
  }

  _renderActionConfig() {
    const slot: Timeslot = { ...this.schedule.entries[this.selectedEntry!].slots[this.selectedSlot!] };
    const action = slot.actions.length ? slot.actions[0] : undefined;
    if (!action)
      return html`
        <div>
          ${
            this.actionsLocked
              ? ''
              : html`
                  <ha-button appearance="plain" @click=${this._showActionDialog}>
                    <ha-icon slot="start" icon="mdi:plus"></ha-icon>
                    ${localize('ui.panel.editor.add_action', this.hass)}
                  </ha-button>
                `
          }
        </div>
      `;

    const config = actionConfig(action, this.config.customize, this.hass);
    const domain = config.target?.domain || computeDomain(action.service);

    const hasFixedEntity =
      isDefined(config?.target?.entity_id) ||
      this.schedule.entries[this.selectedEntry!].slots.some(
        (e) =>
          e.actions.length && isDefined(actionConfig(e.actions[0], this.config.customize, this.hass)?.target?.entity_id)
      );

    if (config === undefined) return html``;

    //if (!config || !config.fields) return html``;
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
          this.actionsLocked
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
                      ?disabled=${hasFixedEntity || this.actionsLocked}
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
                          ?disabled=${this.actionsLocked}
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
                  ?disabled=${!checked || this.actionsLocked}
                  .value=${Object.keys(action.service_data).includes(field) ? action.service_data[field] : undefined}
                  @value-changed=${(ev: CustomEvent) => this._selectField(field, ev)}
                >
                </scheduler-combo-selector>
              </scheduler-settings-row>
            `;
          })}
        </div>
      </scheduler-collapsible-section>
    `;
  }

  _selectField(field: string, ev: CustomEvent) {
    const value = ev.detail.value;

    const slot: Timeslot = { ...this.schedule.entries[this.selectedEntry!].slots[this.selectedSlot!] };
    const action: Action =
      value !== undefined
        ? {
            ...slot.actions[0],
            service_data: {
              ...slot.actions[0].service_data,
              [field]: value,
            },
          }
        : {
            ...slot.actions[0],
            service_data: Object.fromEntries(
              Object.entries(slot.actions[0].service_data).filter(([key]) => key != field)
            ),
          };
    this._updateSlot({ actions: [action] });
  }

  _toggleOptionalField(ev: Event, field: string, selector: Selector) {
    const checked = (ev.target as HTMLInputElement).checked;
    const value = checked ? defaultSelectorValue(selector) : undefined;
    if (checked) {
      this._selectField(
        field,
        new CustomEvent('value-changed', { detail: { value: isDefined(value) ? value : null } })
      );
    } else {
      this._selectField(field, new CustomEvent('value-changed', { detail: { value: undefined } }));
    }
  }

  _selectEntity(ev: CustomEvent) {
    const entity = ev.detail.value as string | string[] | undefined;
    if (!entity) return;

    this.schedule.entries[this.selectedEntry!].slots.forEach((slot, idx) => {
      if (!slot.actions.length) return;
      const action: Action = {
        ...slot.actions[0],
        target: {
          entity_id: entity,
        },
      };
      this._updateSlot({ actions: [action] }, idx);
    });
  }

  _handleUpdate(ev: CustomEvent, entry: number) {
    this.selectedEntry = entry;
    if (ev.detail.hasOwnProperty('selectedSlot')) {
      this._updateSelectedSlot(ev.detail.selectedSlot);
      this.selectedSlot = ev.detail.selectedSlot;
    } else if (ev.detail.hasOwnProperty('slots')) {
      this._updateEntry({ slots: ev.detail.slots });
    }
  }

  _updateSelectedSlot(slot: number | null) {
    this.dispatchEvent(new CustomEvent('change', { detail: { selectedSlot: slot } }));
  }

  _updateEntry(update: Partial<ScheduleEntry>) {
    let entry: ScheduleEntry = { ...this.schedule.entries[this.selectedEntry!] };
    entry = { ...entry, ...update };
    this.schedule = {
      ...this.schedule,
      entries: Object.assign(this.schedule.entries, {
        [this.selectedEntry!]: entry,
      }),
    };
  }

  _updateSlot(update: Partial<Timeslot>, slotIdx = this.selectedSlot!) {
    let slot: Timeslot = { ...this.schedule.entries[this.selectedEntry!].slots[slotIdx] };
    slot = { ...slot, ...update };
    this._updateEntry({
      slots: Object.assign(this.schedule.entries[this.selectedEntry!].slots, {
        [slotIdx]: slot,
      }),
    });
  }

  async _showWeekdayDialog(ev: Event, entry: number) {
    this.selectedEntry = entry;
    await new Promise<TWeekday[] | null>((resolve) => {
      const params: DialogSelectWeekdayParams = {
        weekdays: [...this.schedule.entries[entry].weekdays],
        cancel: () => resolve(null),
        confirm: (out) => resolve(out),
      };

      fireEvent(ev.target as HTMLElement, 'show-dialog', {
        dialogTag: 'dialog-select-weekdays',
        dialogImport: () => import('./dialog-select-weekdays'),
        dialogParams: params,
      });
    }).then((res: TWeekday[] | null) => {
      if (!res) return;
      this._updateEntry({ weekdays: res });
    });
  }

  async _showActionDialog(ev: Event) {
    let filteredDomains: string[] = [];
    let filteredEntities: string[] = [];

    this.schedule.entries.forEach((entry) => {
      entry.slots.forEach((slot) => {
        slot.actions.forEach((action) => {
          filteredEntities = [...filteredEntities, ...[action.target?.entity_id || []].flat()];
          filteredDomains = [
            ...filteredDomains,
            ...[computeDomain(action.service), ...[action.target?.entity_id || []].flat()].map(computeDomain),
          ];
        });
      });
    });
    filteredDomains = [...new Set(filteredDomains)];
    filteredEntities = [...new Set(filteredEntities)];

    await new Promise<Action | null>((resolve) => {
      const params: DialogSelectActionParams = {
        cancel: () => resolve(null),
        confirm: (out: Action) => resolve(out),
        domainFilter: filteredDomains.length ? filteredDomains : undefined,
        entityFilter: filteredEntities.length ? filteredEntities : undefined,
        cardConfig: this.config,
      };

      fireEvent(ev.target as HTMLElement, 'show-dialog', {
        dialogTag: 'dialog-select-action',
        dialogImport: () => import('./dialog-select-action'),
        dialogParams: params,
      });
    }).then((res: Action | null) => {
      if (!res) return;
      const slot: Timeslot = { ...this.schedule.entries[this.selectedEntry!].slots[this.selectedSlot!] };
      const target = this.schedule.entries[this.selectedEntry!].slots.find((e) =>
        e.actions.length ? e.actions[0].target?.entity_id : undefined
      );
      let action = { ...res };
      if (target && action.target) action = { ...action, target: target.actions[0].target };
      this._updateSlot({ actions: [action] });
    });
  }

  _actionItemOptionsClick(ev: CustomEvent) {
    const option: 'delete' | 'change_type' = ev.detail.item.value;
    switch (option) {
      case 'change_type':
        this._showActionDialog(ev);
        break;
      case 'delete':
        this._updateSlot({ actions: [] });
        break;
    }
  }

  _stopTimeChanged(ev: CustomEvent) {
    const value = ev.detail.value as Time;
    const [slots, slotIdxOut] = moveTimeslot(
      [...this.schedule.entries[this.selectedEntry!].slots],
      Number(this.selectedSlot),
      { stop: value },
      this.hass
    );
    this._updateEntry({ slots: slots });
    if (slotIdxOut != this.selectedSlot) this._updateSelectedSlot(slotIdxOut);
    this._showStoredTime(ev, this._endTime(slots, slotIdxOut));
  }

  _startTimeChanged(ev: CustomEvent) {
    const value = ev.detail.value as Time;
    const [slots, slotIdxOut] = moveTimeslot(
      [...this.schedule.entries[this.selectedEntry!].slots],
      Number(this.selectedSlot),
      { start: value },
      this.hass
    );
    this._updateEntry({ slots: slots });
    if (slotIdxOut != this.selectedSlot) this._updateSelectedSlot(slotIdxOut);
    this._showStoredTime(ev, slots[slotIdxOut].start);
  }

  // The end time shown for a timeslot: its stop time, or else the start of the next timeslot.
  private _endTime(slots: Timeslot[], slotIdx: number) {
    return slots[slotIdx].stop || (slotIdx < slots.length - 1 ? slots[slotIdx + 1].start : slots[slotIdx].start);
  }

  // A time entered outside the limits of the timeslot is limited by moveTimeslot(). When it is limited to the same
  // value as before, the .time binding doesn't change and the picker would keep showing the entered time, so the
  // stored time is set directly.
  private _showStoredTime(ev: CustomEvent, time: string) {
    (ev.currentTarget as SchedulerTimePicker).time = time;
  }

  _addTimeslot(ev: Event) {
    if (this.selectedEntry === null || this.selectedSlot === null) return;
    const sourceActions = this.schedule.entries[this.selectedEntry].slots[this.selectedSlot].actions;
    this.schedule = insertTimeslot(this.schedule, this.selectedEntry, this.selectedSlot, this.hass);
    // with locked actions the new timeslot can't get an action, so it takes over the action of the split timeslot
    if (this.actionsLocked) {
      const actions = sourceActions.length ? sourceActions : this.defaultAction ? [this.defaultAction] : [];
      this._updateSlot(
        { actions: actions.map((e) => ({ ...e, service_data: { ...e.service_data } })) },
        this.selectedSlot + 1
      );
    }
    (ev.target as HTMLElement).blur();
  }

  _removeTimeslot(ev: Event) {
    if (this.selectedEntry === null || this.selectedSlot === null) return;
    this.schedule = removeTimeslot(this.schedule, this.selectedEntry, this.selectedSlot);
    if (this.selectedSlot >= this.schedule.entries[this.selectedEntry].slots.length)
      this.selectedSlot = this.schedule.entries[this.selectedEntry].slots.length - 1;
    (ev.target as HTMLElement).blur();
  }

  static get styles(): CSSResultGroup {
    return css`
      :host {
        position: relative;
      }
      .two-column {
        display: flex;
        flex-direction: row;
        margin: 16px 0px;
        flex-wrap: wrap;
        gap: 10px;
      }
      .two-column .column {
        display: flex;
        flex-direction: column;
        flex: 0 0 215px;
      }
      div.editor-header {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
      }
      .weekdays {
        display: flex;
        flex: 1;
        align-items: center;
        white-space: nowrap;
      }
      .weekdays-actions {
        display: flex;
        align-items: center;
      }
      div.actions {
        display: flex;
        align-items: end;
        margin: -4px 0px 0px 0px;
      }
      @media all and (max-width: 150px) {
        div.editor-header {
          flex-direction: column;
          margin-top: 0px;
        }
        div.actions {
          align-self: flex-end;
        }
      }
      div.interval {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        column-gap: 16px;
        margin-bottom: 8px;
      }
      div.interval .column {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      div.slot-placeholder {
        padding: 20px 0px 0px 0px;
      }
      scheduler-collapsible-section .header ha-icon {
        margin-right: 6px;
      }
      scheduler-collapsible-section .header span {
        flex: 1;
      }
      scheduler-list-item.warning,
      scheduler-list-item.warning ha-icon {
        color: var(--error-color);
      }
      div.warning {
        padding: 16px 0px 0px 0px;
        color: var(--error-color);
      }
    `;
  }
}
