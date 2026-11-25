import { isDefined } from '../../lib/is_defined';
import { HomeAssistant } from '../../lib/types';
import { EditorMode, Schedule, ScheduleEntry, Time, Timeslot } from '../../types';
import { addTimeOffset } from '../time/add_time_offset';
import { computeTimestamp } from '../time/compute_timestamp';
import { parseTimeBar } from '../time/parse_time_bar';
import { parseTimeString } from '../time/parse_time_string';
import { timeToString } from '../time/time_to_string';

const END_OF_DAY = 24 * 3600;

// A stop time of 00:00 closes the timeslot at the end of the day.
const stopTimestamp = (stop: string, hass: HomeAssistant) => computeTimestamp(stop, hass) || END_OF_DAY;

/**
 * Pick the editor for a schedule entry, as the card stores no editor mode: the default editor when it can show the
 * entry without changing it, otherwise the simplest editor that can (single, then interval, then scheme).
 */
export const detectEditorMode = (entry: ScheduleEntry, defaultMode?: EditorMode): EditorMode => {
  const actionSlots = entry.slots.filter((e) => e.actions.length);
  const canShow = (mode: EditorMode) => {
    if (mode == EditorMode.Scheme) return true;
    if (actionSlots.length > 1) return false;
    // single: one start time, and at most 3 timeslots as before
    if (mode == EditorMode.Single) return entry.slots.length <= 3 && !actionSlots.some((e) => isDefined(e.stop));
    // interval: one timeslot with an end time, or a new schedule without actions
    return actionSlots.length ? isDefined(actionSlots[0].stop) : entry.slots.length <= 3;
  };
  if (defaultMode && canShow(defaultMode)) return defaultMode;
  return [EditorMode.Single, EditorMode.Interval, EditorMode.Scheme].find((e) => canShow(e))!;
};

/** End time for a new interval: one hour after the start, but not past midnight. */
export const defaultIntervalStop = (start: string, hass: HomeAssistant) => {
  if (computeTimestamp(start, hass) + 3600 >= END_OF_DAY) return '00:00:00';
  return timeToString(addTimeOffset(parseTimeString(start), { hours: 1 }));
};

const intervalSlotIndex = (slots: Timeslot[], preferredIdx?: number | null) => {
  const idx = slots.findIndex((e) => e.actions.length);
  if (idx >= 0) return idx;
  if (isDefined(preferredIdx) && preferredIdx! >= 0 && preferredIdx! < slots.length) return preferredIdx!;
  return Math.floor(slots.length / 2);
};

/**
 * Reduce every entry to one timeslot with a start and end time, surrounded by empty slots.
 * The slot with an action is kept; other actions are dropped.
 * Returns the schedule and the index of the interval slot in the selected entry.
 */
export const convertToInterval = (
  schedule: Schedule,
  hass: HomeAssistant,
  selectedEntry: number,
  selectedSlot?: number | null
): [Schedule, number] => {
  let selectedStart = '';
  schedule = {
    ...schedule,
    entries: schedule.entries.map((entry, entryIdx) => {
      const idx = intervalSlotIndex(entry.slots, entryIdx === selectedEntry ? selectedSlot : null);
      const slot = entry.slots[idx];
      const stop = isDefined(slot.stop) ? slot.stop! : defaultIntervalStop(slot.start, hass);
      if (entryIdx === selectedEntry) selectedStart = slot.start;
      return { ...entry, slots: [{ ...slot, stop: stop }] };
    }),
  };
  schedule = parseTimeBar(schedule, hass);
  return [schedule, findIntervalSlot(schedule.entries[selectedEntry].slots, selectedStart)];
};

/** Index of the interval slot after the slots are rebuilt. */
export const findIntervalSlot = (slots: Timeslot[], start: string) => {
  const idx = slots.findIndex((e) => e.start == start);
  return idx >= 0 ? idx : intervalSlotIndex(slots);
};

/**
 * Change the start or end time of the interval, limited like in the scheme editor:
 * the start time stops one minute before the end time, and the end time stops one
 * minute after the start time.
 */
export const setIntervalTime = (
  slots: Timeslot[],
  slotIdx: number,
  update: { start?: Time; stop?: Time },
  hass: HomeAssistant
): [Timeslot[], number] => {
  const slot = slots[slotIdx];
  let start = isDefined(update.start) ? timeToString({ ...update.start! }) : slot.start;
  let stop = isDefined(update.stop)
    ? timeToString({ ...update.stop! })
    : isDefined(slot.stop)
      ? slot.stop!
      : defaultIntervalStop(slot.start, hass);

  if (computeTimestamp(start, hass) >= stopTimestamp(stop, hass)) {
    if (isDefined(update.start)) start = timeToString(addTimeOffset(parseTimeString(stop), { minutes: -1 }));
    else stop = timeToString(addTimeOffset(parseTimeString(start), { minutes: 1 }));
  }

  const entry: ScheduleEntry = { weekdays: [], slots: [{ ...slot, start: start, stop: stop }] };
  const out = parseTimeBar(<Schedule>{ entries: [entry] }, hass).entries[0].slots;
  return [out, findIntervalSlot(out, start)];
};
