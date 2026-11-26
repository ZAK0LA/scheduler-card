import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators';
import { DialogSelectEntitiesParams } from './dialogs/dialog-select-entities';
import { HomeAssistant } from './lib/types';
import { localize } from './localize/localize';
import { Action, CardConfig, DefaultActionConfig, EditorMode } from './types';
import { fireEvent } from './lib/fire_event';
import { NumberSelector, SelectSelector } from './lib/selector';
import { fetchTags } from './data/store/fetch_tags';
import { sortByName } from './lib/sort';
import { mdiArrowRight } from '@mdi/js';
import {
  DEFAULT_PRIMARY_INFO_DISPLAY,
  DEFAULT_SECONDARY_INFO_DISPLAY,
  DEFAULT_SORT_BY,
  DEFAULT_TIME_STEP,
} from './const';
import { loadConfigFromEntityRegistry } from './data/load_config_from_entity_registry';
import { hassLocalize } from './localize/hassLocalize';
import {
  defaultActionErrorMessage,
  defaultActionMissingEntity,
  defaultActionsFromAction,
  resolveDefaultAction,
} from './data/actions/default_action';
import { deepCompare } from './lib/deep_compare';
import { computeActionDialogFilter } from './components/scheduler-action-editor';

import './dialogs/dialog-select-entities';
import './components/scheduler-entity-picker';
import './components/scheduler-collapsible-section';
import './components/scheduler-combo-selector';
import './components/scheduler-action-editor';

@customElement('scheduler-card-editor')
export class SchedulerCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property()
  private _config: CardConfig = {};

  setConfig(config: CardConfig) {
    this._config = { ...config };
  }

  @property()
  title: string = '';

  @property()
  tagOptions: string[] = [];

  @state() customTagValue: string = '';

  // the default action while it is edited, which may still be incomplete
  @state() private _draftDefaultAction?: Action;
  // 'default_actions' of the configuration when the draft was set, to notice changes made elsewhere, e.g. in YAML
  private _draftBase?: DefaultActionConfig[];

  async firstUpdated() {
    this.title = typeof this._config.title == 'string' ? this._config.title : '';

    const tagOptions = (await fetchTags(this.hass!)).map((e) => e.name);
    tagOptions.sort(sortByName);
    this.tagOptions = tagOptions;
  }

  render() {
    const timeStepSelector = <NumberSelector>{
      number: {
        min: 0,
        max: 30,
        step: 1,
        unit_of_measurement: localize('ui.panel.card_editor.fields.time_step.unit_minutes', this.hass),
      },
    };

    return html`
      <div class="card-config">
        <ha-button @click=${this._showIncludedEntitiesDialog} outlined>
          ${localize('ui.panel.card_editor.fields.entities.button_label', this.hass)}
          <ha-svg-icon slot="trailingIcon" .path=${mdiArrowRight}></ha-svg-icon>
        </ha-button>

        <scheduler-settings-row ?showPrefix=${true}>
          <ha-checkbox slot="prefix" ?checked=${this._config.title !== false} @change=${this._setEnableTitle}>
          </ha-checkbox>
          <span slot="heading">${localize('ui.panel.card_editor.fields.title.heading', this.hass)}</span>

          <ha-input
            .value=${this.title}
            @input=${this._setTitle}
            .placeholder=${localize('ui.panel.common.title', this.hass)}
            ?disabled=${this._config.title === false}
          ></ha-input>
        </scheduler-settings-row>

        <div class="two-columns switches" style="margin: 10px 0px 15px 0px">
          <div class="column">
            <ha-switch
              ?checked=${this._config.discover_existing !== false}
              @change=${(ev: Event) => {
                this._updateConfig({ discover_existing: (ev.target as HTMLInputElement).checked });
              }}
              >${localize('ui.panel.card_editor.fields.discover_existing.heading', this.hass)}</ha-switch
            >
          </div>
          <div class="column">
            <ha-switch
              ?checked=${this._config.show_header_toggle}
              @change=${(ev: Event) => {
                this._updateConfig({ show_header_toggle: (ev.target as HTMLInputElement).checked });
              }}
              >${localize('ui.panel.card_editor.fields.show_header_toggle.heading', this.hass)}</ha-switch
            >
          </div>
          <div class="column">
            <ha-switch
              ?checked=${this._config.show_toggle_switches !== false}
              @change=${(ev: Event) => {
                this._updateConfig({ show_toggle_switches: (ev.target as HTMLInputElement).checked });
              }}
              >${localize('ui.panel.card_editor.fields.show_toggle_switches.heading', this.hass)}</ha-switch
            >
          </div>
          <div class="column">
            <ha-switch
              ?checked=${this._config.show_add_button !== false}
              @change=${(ev: Event) => {
                this._updateConfig({ show_add_button: (ev.target as HTMLInputElement).checked });
              }}
              >${localize('ui.panel.card_editor.fields.show_add_button.heading', this.hass)}</ha-switch
            >
          </div>
          <div class="column">
            <ha-switch
              ?checked=${this._config.show_delete_button !== false}
              @change=${(ev: Event) => {
                this._updateConfig({ show_delete_button: (ev.target as HTMLInputElement).checked });
              }}
              >${localize('ui.panel.card_editor.fields.show_delete_button.heading', this.hass)}</ha-switch
            >
          </div>
          <div class="column">
            <ha-switch
              ?checked=${this._config.show_options_tab !== false}
              @change=${(ev: Event) => {
                this._updateConfig({ show_options_tab: (ev.target as HTMLInputElement).checked });
              }}
              >${localize('ui.panel.card_editor.fields.show_options_tab.heading', this.hass)}</ha-switch
            >
          </div>
          <div class="column">
            <ha-switch
              ?checked=${this._config.show_editor_mode_button !== false}
              @change=${(ev: Event) => {
                this._updateConfig({ show_editor_mode_button: (ev.target as HTMLInputElement).checked });
              }}
              >${localize('ui.panel.card_editor.fields.show_editor_mode_button.heading', this.hass)}</ha-switch
            >
          </div>
          <div class="column">
            <ha-switch
              ?checked=${this._config.show_sun_mode_button !== false}
              @change=${(ev: Event) => {
                this._updateConfig({ show_sun_mode_button: (ev.target as HTMLInputElement).checked });
              }}
              >${localize('ui.panel.card_editor.fields.show_sun_mode_button.heading', this.hass)}</ha-switch
            >
          </div>
        </div>

        ${this._renderActionsSection()}

        <scheduler-settings-row>
          <span slot="heading">${localize('ui.panel.card_editor.fields.time_step.heading', this.hass)}</span>

          <scheduler-combo-selector
            .hass=${this.hass}
            .config=${timeStepSelector}
            .value=${this._config.time_step || DEFAULT_TIME_STEP}
            @value-changed=${(ev: CustomEvent) => {
              this._updateConfig({ time_step: ev.detail.value });
            }}
          >
          </scheduler-combo-selector>
        </scheduler-settings-row>

        <span>${localize('ui.panel.card_editor.fields.default_editor.heading', this.hass)}</span>
        <div class="two-columns">
          ${[EditorMode.Single, EditorMode.Interval, EditorMode.Scheme].map((mode) => {
            // values other than interval and scheme are handled as single mode
            const checked =
              mode == EditorMode.Single
                ? ![EditorMode.Interval, EditorMode.Scheme].includes(this._config!.default_editor!)
                : this._config!.default_editor == mode;
            return html`
              <div
                class="column radio"
                @click=${() => {
                  this._updateConfig({ default_editor: mode });
                }}
              >
                <ha-icon
                  icon="${checked ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}"
                  class="${checked ? 'checked' : ''}"
                ></ha-icon>
                <span>${localize(`ui.panel.card_editor.fields.default_editor.options.${mode}`, this.hass)}</span>
              </div>
            `;
          })}
        </div>

        <span slot="heading">${localize('ui.panel.card_editor.fields.sort_by.heading', this.hass)}</span>

        <div class="two-columns">
          <div
            class="column radio"
            @click=${() => {
              this._setSortBy('relative-time');
            }}
          >
            <ha-icon
              icon="${[this._config.sort_by || DEFAULT_SORT_BY].flat().includes('relative-time') ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}"
              class="${[this._config.sort_by || DEFAULT_SORT_BY].flat().includes('relative-time') ? 'checked' : ''}"
            ></ha-icon>
            <span>${localize('ui.panel.card_editor.fields.sort_by.options.relative_time', this.hass)}</span>
          </div>
          <div
            class="column radio"
            @click=${() => {
              this._setSortBy('title');
            }}
          >
            <ha-icon
              icon="${[this._config.sort_by || DEFAULT_SORT_BY].flat().includes('title') ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}"
              class="${[this._config.sort_by || DEFAULT_SORT_BY].flat().includes('title') ? 'checked' : ''}"
            ></ha-icon>
            <span>${localize('ui.panel.card_editor.fields.sort_by.options.title', this.hass)}</span>
          </div>
        </div>

        <span>${localize('ui.panel.card_editor.fields.display_format_icon.heading', this.hass)}</span>
        <div class="two-columns">
          <div class="column radio" @click=${() => this._setDisplayOptionsIcon('action')}>
            <ha-icon
              icon="${(this._config.display_options?.icon || 'action') == 'action' ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}"
              class="${(this._config.display_options?.icon || 'action') == 'action' ? 'checked' : ''}"
            ></ha-icon>
            <span>${localize('ui.panel.card_editor.fields.display_format_icon.options.action', this.hass)}</span>
          </div>
          <div class="column radio" @click=${() => this._setDisplayOptionsIcon('entity')}>
            <ha-icon
              icon="${(this._config.display_options?.icon || 'action') == 'entity' ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}"
              class="${(this._config.display_options?.icon || 'action') == 'entity' ? 'checked' : ''}"
            ></ha-icon>
            <span>${localize('ui.panel.card_editor.fields.display_format_icon.options.entity', this.hass)}</span>
          </div>
          <div class="column radio" @click=${() => this._setDisplayOptionsIcon('schedule')}>
            <ha-icon
              icon="${(this._config.display_options?.icon || 'action') == 'schedule' ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}"
              class="${(this._config.display_options?.icon || 'action') == 'schedule' ? 'checked' : ''}"
            ></ha-icon>
            <span>${localize('ui.panel.card_editor.fields.display_format_icon.options.schedule', this.hass)}</span>
          </div>
        </div>

        <span>${localize('ui.panel.card_editor.fields.display_format_primary.heading', this.hass)}</span>

        <div class="two-columns">
          <div
            class="column radio"
            @click=${() => {
              this._setDisplayOptionsPrimary('default');
            }}
          >
            <ha-icon
              icon="${[this._config.display_options?.primary_info || DEFAULT_PRIMARY_INFO_DISPLAY].flat().includes('default') ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}"
              class="${[this._config.display_options?.primary_info || DEFAULT_PRIMARY_INFO_DISPLAY].flat().includes('default') ? 'checked' : ''}"
            ></ha-icon>
            <span>${localize('ui.panel.card_editor.fields.display_format_primary.options.default', this.hass)}</span>
          </div>
          <div
            class="column radio"
            @click=${() => {
              this._setDisplayOptionsPrimary('{entity}: {action}');
            }}
          >
            <ha-icon
              icon="${[this._config.display_options?.primary_info || DEFAULT_PRIMARY_INFO_DISPLAY].flat().includes('{entity}: {action}') ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}"
              class="${[this._config.display_options?.primary_info || DEFAULT_PRIMARY_INFO_DISPLAY].flat().includes('{entity}: {action}') ? 'checked' : ''}"
            ></ha-icon>
            <span
              >${localize('ui.panel.card_editor.fields.display_format_primary.options.entity_action', this.hass)}</span
            >
          </div>
        </div>
        <span>${localize('ui.panel.card_editor.fields.display_format_secondary.heading', this.hass)}</span>

        <div class="two-columns">
          <div class="column">
            <ha-checkbox
              value="relative-time"
              @change=${this._setDisplayOptionsSecondary}
              ?checked=${[this._config.display_options?.secondary_info || DEFAULT_SECONDARY_INFO_DISPLAY].flat().includes('relative-time')}
              >${localize('ui.panel.card_editor.fields.display_format_secondary.options.relative_time', this.hass)}</ha-checkbox
            >

            <ha-checkbox
              value="time"
              @change=${this._setDisplayOptionsSecondary}
              ?checked=${[this._config.display_options?.secondary_info || DEFAULT_SECONDARY_INFO_DISPLAY].flat().includes('time')}
              >${localize('ui.panel.card_editor.fields.display_format_secondary.options.time', this.hass)}</ha-checkbox
            >
          </div>
          <div class="column">
            <ha-checkbox
              value="days"
              @change=${this._setDisplayOptionsSecondary}
              ?checked=${[this._config.display_options?.secondary_info || DEFAULT_SECONDARY_INFO_DISPLAY].flat().includes('days')}
              >${localize('ui.panel.card_editor.fields.display_format_secondary.options.days', this.hass)}</ha-checkbox
            >

            <ha-checkbox
              value="additional-tasks"
              @change=${this._setDisplayOptionsSecondary}
              ?checked=${[this._config.display_options?.secondary_info || DEFAULT_SECONDARY_INFO_DISPLAY].flat().includes('additional-tasks')}
              >${localize('ui.panel.card_editor.fields.display_format_secondary.options.additional_tasks', this.hass)}</ha-checkbox
            >

            <ha-checkbox
              value="active"
              @change=${this._setDisplayOptionsSecondary}
              ?checked=${[this._config.display_options?.secondary_info || DEFAULT_SECONDARY_INFO_DISPLAY].flat().includes('active')}
              >${localize('ui.panel.card_editor.fields.display_format_secondary.options.active', this.hass)}</ha-checkbox
            >
          </div>
        </div>

        <scheduler-settings-row>
          <span slot="heading">${localize('ui.panel.card_editor.fields.tags.heading', this.hass)}</span>
          ${this._renderTagPicker('tags')}
        </scheduler-settings-row>

        <scheduler-settings-row>
          <span slot="heading">${localize('ui.panel.card_editor.fields.editor_tags.heading', this.hass)}</span>
          ${this._renderTagPicker('editor_tags')}
        </scheduler-settings-row>
      </div>
    `;
  }

  private _setEnableTitle(ev: Event) {
    const checked = (ev.target as HTMLInputElement).checked;
    if (!checked) this._updateConfig({ title: false });
    else if (this.title.length) this._updateConfig({ title: this.title });
    else this._updateConfig({ title: true });
  }

  private _setTitle(ev: CustomEvent) {
    const value = (ev.target as HTMLInputElement).value;
    this.title = value;
    if (value !== localize('ui.panel.common.title', this.hass) && value.length) this._updateConfig({ title: value });
    else this._updateConfig({ title: true });
  }

  private _setSortBy(value: string) {
    let config = [this._config?.sort_by || DEFAULT_SORT_BY].flat();
    config = config.filter((e) => e == 'state');
    if (!config.includes(value)) config = [...config, value];
    this._updateConfig({ sort_by: config });
  }

  private _setDisplayOptionsPrimary(value: string) {
    const displayOptions = {
      ...this._config?.display_options,
      primary_info: value,
    };
    this._updateConfig({ display_options: displayOptions });
  }

  private _setDisplayOptionsIcon(icon: 'action' | 'entity' | 'schedule') {
    this._updateConfig({ display_options: { ...this._config.display_options, icon: icon } });
  }

  private _setDisplayOptionsSecondary(ev: Event) {
    const value = (ev.target as HTMLInputElement).value;
    const checked = (ev.target as HTMLInputElement).checked;
    let displayOptions = { ...this._config?.display_options };
    let secondaryInfo = [displayOptions.secondary_info || []].flat();
    secondaryInfo = checked ? Array.from(new Set([...secondaryInfo, value])) : secondaryInfo.filter((e) => e !== value);
    secondaryInfo.sort((a, b) => {
      const ranking = {
        'relative-time': 1,
        time: secondaryInfo.includes('relative-time') ? 3 : 2,
        days: secondaryInfo.includes('relative-time') ? 2 : 3,
        'additional-tasks': 4,
        active: 5,
      };
      const rankA = Object.keys(ranking).includes(a) ? ranking[a] : 6;
      const rankB = Object.keys(ranking).includes(b) ? ranking[b] : 6;
      if (rankA > rankB) return 1;
      if (rankA < rankB) return -1;
      return 0;
    });
    displayOptions = { ...displayOptions, secondary_info: [...secondaryInfo] };
    this._updateConfig({ display_options: displayOptions });
  }

  async _showIncludedEntitiesDialog(ev: Event) {
    let domains = (this._config.include || []).filter((e) => !e.includes('.'));
    let entities = (this._config.include || []).filter((e) => e.includes('.'));

    const extraConfig = await loadConfigFromEntityRegistry(this.hass);
    let config: CardConfig = {
      ...this._config,
      customize: { ...extraConfig, ...(this._config.customize || {}) },
    };

    await new Promise<{ domains: string[]; entities: string[] } | null>((resolve) => {
      const params: DialogSelectEntitiesParams = {
        cancel: () => resolve(null),
        confirm: (out: { domains: string[]; entities: string[] }) => resolve(out),
        domains: domains,
        entities: entities,
        cardConfig: config,
      };

      fireEvent(ev.target as HTMLElement, 'show-dialog', {
        dialogTag: 'dialog-select-entities',
        dialogImport: () => import('./dialogs/dialog-select-entities'),
        dialogParams: params,
      });
    }).then((res: { domains: string[]; entities: string[] } | null) => {
      if (!res) return;
      this._updateConfig({ include: [...res.domains, ...res.entities] });
    });
  }

  _renderTagPicker(key: 'tags' | 'editor_tags') {
    const tagSelector = <SelectSelector>{
      select: {
        options: this.tagOptions,
        multiple: true,
        custom_value: true,
      },
    };

    return html`
      <div style="display: flex; flex: 1; flex-direction: column">
        <scheduler-combo-selector
          .hass=${this.hass}
          .config=${tagSelector}
          .value=${[this._config[key] || []].flat()}
          @value-changed=${(ev: CustomEvent) => this._setTags(key, ev.detail.value)}
        >
        </scheduler-combo-selector>

        <ha-dropdown
          @wa-after-hide=${(ev: Event) => {
            ev.stopPropagation();
            ((ev.target as HTMLElement).querySelector('ha-button') as HTMLInputElement).blur();
          }}
          @click=${(ev: Event) => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
          }}
          @wa-after-show=${(ev: Event) => {
            ((ev.target as HTMLElement).querySelector('ha-input') as HTMLInputElement).focus();
          }}
          placement="bottom-start"
        >
          <ha-button appearance="plain" slot="trigger">
            <ha-icon slot="start" icon="mdi:plus"></ha-icon>
            ${hassLocalize('ui.panel.config.tag.add_tag', this.hass)}
          </ha-button>

          <div style="display: flex; align-items: center; padding: 0x 2px 0px 8px">
            <ha-input
              .value=${this.customTagValue}
              .label=${hassLocalize('ui.panel.config.tag.add_tag', this.hass)}
              @input=${(ev: Event) => {
                this.customTagValue = (ev.currentTarget as any).value;
              }}
              .placeholder=""
            ></ha-input>
            <ha-button appearance="plain" @click=${(ev: Event) => this._customTagConfirmClick(ev, key)}>
              ${hassLocalize('ui.common.ok', this.hass)}
            </ha-button>
          </div>
        </ha-dropdown>
      </div>
    `;
  }

  _customTagConfirmClick(ev: Event, key: 'tags' | 'editor_tags') {
    let target = ev.target as HTMLElement;
    target = target.parentElement as HTMLElement;
    target = target.parentElement as HTMLElement;
    const triggerBtn = target.querySelector('ha-button');
    (triggerBtn as any).click();

    const value = String(this.customTagValue).trim();
    if (value.length) {
      let tags = [this._config[key] || []].flat();
      tags = [...new Set([...tags, value])];
      this._setTags(key, tags);
    }
    this.customTagValue = '';
  }

  _setTags(key: 'tags' | 'editor_tags', tags: string[]) {
    if (key == 'editor_tags' && !tags.length) {
      // an empty list in the editor means no restriction, rather than no selectable tags
      const { editor_tags: _editorTags, ...config } = this._config;
      this._config = config;
      fireEvent(this, 'config-changed', { config: this._config });
      return;
    }
    this._updateConfig({ [key]: tags });
  }

  private _updateConfig(changes: Partial<CardConfig>) {
    if (!this._config) return;
    this._config = { ...this._config, ...changes };
    fireEvent(this, 'config-changed', { config: this._config });
  }

  // The default action for new schedules, and the options that use it.
  private _renderActionsSection() {
    if (!this.hass) return '';
    const entries = [this._config.default_actions || []].flat();

    // the action being edited, as long as the configuration wasn't changed elsewhere
    const draft =
      this._draftDefaultAction && deepCompare(this._draftBase, entries) ? this._draftDefaultAction : undefined;
    const shownEntries = draft ? defaultActionsFromAction(draft) : entries;
    const result = resolveDefaultAction(this.hass, { ...this._config, default_actions: shownEntries });
    const action = draft || result.action;

    // like in the schedule editor, a new type keeps the domain and the entity of the action
    const filter = computeActionDialogFilter(action ? [action] : []);

    // new schedules can't be saved with hidden actions unless there is a valid default action
    const failure = result.error && (shownEntries.length || this._config.show_actions === false) ? result : undefined;

    return html`
      <div class="section-heading">${localize('ui.panel.card_editor.fields.actions.heading', this.hass)}</div>
      <span>${localize('ui.panel.card_editor.fields.default_actions.heading', this.hass)}</span>
      ${
        action || !entries.length
          ? html`
              <scheduler-action-editor
                .hass=${this.hass}
                .config=${this._config}
                .action=${action}
                .domainFilter=${filter.domainFilter}
                .entityFilter=${filter.entityFilter}
                .keepTarget=${action?.target}
                .allowShowAll=${false}
                .addLabel=${localize('ui.panel.card_editor.fields.default_actions.add', this.hass)}
                @action-changed=${(ev: CustomEvent) => this._setDefaultAction(ev.detail.action)}
                @entity-changed=${(ev: CustomEvent) =>
                  this._setDefaultAction({ ...action!, target: { entity_id: ev.detail.entity_id } })}
              >
              </scheduler-action-editor>
            `
          : html`
              <div class="buttons">
                <scheduler-action-editor
                  .hass=${this.hass}
                  .config=${this._config}
                  .allowShowAll=${false}
                  .addLabel=${hassLocalize('ui.panel.lovelace.editor.card.conditional.change_type', this.hass)}
                  addIcon="mdi:pencil"
                  @action-changed=${(ev: CustomEvent) => this._setDefaultAction(ev.detail.action)}
                >
                </scheduler-action-editor>
                <ha-button appearance="plain" variant="danger" @click=${() => this._setDefaultAction(undefined)}>
                  <ha-icon slot="start" icon="mdi:delete"></ha-icon>
                  ${hassLocalize('ui.common.delete', this.hass)}
                </ha-button>
              </div>
            `
      }
      ${
        failure
          ? html`
              <div class="warning">
                ${
                  this._config.show_actions === false
                    ? localize('ui.panel.card_editor.fields.show_actions.missing_default', this.hass)
                    : ''
                }
                ${defaultActionErrorMessage(failure, this.hass)}
              </div>
            `
          : ''
      }

      <div class="two-columns switches" style="margin: 10px 0px 15px 0px">
        <div class="column">
          <ha-switch
            ?checked=${this._config.lock_actions === true}
            @change=${(ev: Event) => {
              this._updateConfig({ lock_actions: (ev.target as HTMLInputElement).checked });
            }}
            >${localize('ui.panel.card_editor.fields.lock_actions.heading', this.hass)}</ha-switch
          >
        </div>
        <div class="column">
          <ha-switch
            ?checked=${this._config.show_actions !== false}
            @change=${(ev: Event) => {
              this._updateConfig({ show_actions: (ev.target as HTMLInputElement).checked });
            }}
            >${localize('ui.panel.card_editor.fields.show_actions.heading', this.hass)}</ha-switch
          >
        </div>
      </div>
    `;
  }

  // Writes the default action as 'default_actions', or removes it.
  // An action without its entity is only kept in the editor until the entity is chosen. The entity picker may choose
  // it right away, and the dashboard editor can lose the second of two changes in quick succession.
  private _setDefaultAction(action: Action | undefined) {
    this._draftDefaultAction = action;
    if (action && defaultActionMissingEntity(action)) {
      this._draftBase = [this._config.default_actions || []].flat();
      return;
    }
    if (action) {
      this._draftBase = defaultActionsFromAction(action);
      this._updateConfig({ default_actions: this._draftBase });
      return;
    }
    this._draftBase = [];
    const config = { ...this._config };
    delete config.default_actions;
    this._config = config;
    fireEvent(this, 'config-changed', { config: this._config });
  }

  static styles = css`
    div.entities-list {
      max-height: 500px;
      overflow: auto;
    }
    div.row {
      display: flex;
      align-items: center;
      flex-direction: row;
      cursor: pointer;
      margin: 10px 0px;
    }
    div.row ha-icon {
      padding: 8px;
      color: var(--state-icon-color);
    }
    div.row ha-switch {
      padding: 13px 5px;
    }
    .info {
      margin-left: 16px;
      flex: 1 0 60px;
    }
    .info,
    .info > * {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    ha-input {
      width: 100%;
    }
    div.two-columns {
      display: flex;
      flex-direction: row;
    }
    div.two-columns .column {
      flex: 50%;
    }
    div.two-columns .column > * {
      display: flex;
      flex-direction: column;
    }
    div.warning {
      margin: 8px 0px 0px 0px;
      color: var(--error-color);
    }
    div.section-heading {
      font-weight: 500;
      margin: 16px 0px 8px 0px;
    }
    div.buttons {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    div.two-columns.switches {
      flex-wrap: wrap;
    }
    div.two-columns.switches .column {
      flex: 0 0 calc(100% / 3);
    }
    div.two-columns .column > ha-switch,
    div.two-columns .column > ha-checkbox {
      min-height: 48px;
      justify-content: center;
    }
    scheduler-combo-selector {
      min-width: 240px;
    }
    ha-dropdown {
      display: block;
    }
    ha-checkbox {
      padding: 8px 0px;
    }
    div.radio {
      display: flex;
      flex-direction: row;
      align-items: center;
      font-size: 0.875rem;
      padding-bottom: 8px;
      gap: 8px;
    }
    div.radio > * {
      display: flex;
      cursor: pointer;
      user-select: none;
    }
    div.radio ha-icon {
      color: var(--ha-color-neutral-60);
      transition: color 0.1s ease-in-out;
      padding: 4px 0px;
    }
    div.radio ha-icon:hover {
      color: var(--ha-color-neutral-40);
    }
    div.radio ha-icon.checked {
      color: var(--ha-color-fill-primary-loud-resting);
    }
    div.radio ha-icon.checked:hover {
      color: var(--ha-color-fill-primary-loud-hover);
    }
  `;
}
