import { ArrowRight, Plus, X } from '@phosphor-icons/react';
import { MAX_TRIGGERS } from '../domain/routine.ts';
import styles from './routines-page.module.css';
import {
  blankSchedule,
  dayName,
  describeSchedule,
  type ScheduleDraft,
  type ScheduleKind,
  WEEK,
} from './schedule.ts';

const t = {
  legend: 'When it runs',
  schedule: 'Schedule',
  kinds: {
    daily: 'Every day',
    weekly: 'Days of the week',
    monthly: 'Day of the month',
    once: 'Once',
    every: 'At intervals',
    cron: 'Cron (advanced)',
  } satisfies Record<ScheduleKind, string>,
  at: 'at',
  day: 'day',
  every: 'every',
  minutes: 'minutes',
  hours: 'hours',
  shortMonths: 'It does not run in months shorter than that.',
  cronHelp: 'minute hour day month weekday, e.g. 0 8 * * 1-5',
  add: 'Add a schedule',
  remove: 'Remove schedule',
};

const KINDS: ScheduleKind[] = ['daily', 'weekly', 'monthly', 'once', 'every', 'cron'];

interface ScheduleEditorProps {
  schedules: ScheduleDraft[];
  onChange: (schedules: ScheduleDraft[]) => void;
  disabled: boolean;
}

/** Guided schedule forms; each row ends with a sentence saying when the Routine runs. */
export function ScheduleEditor({ schedules, onChange, disabled }: ScheduleEditorProps) {
  const set = (index: number, schedule: ScheduleDraft) =>
    onChange(schedules.map((current, i) => (i === index ? schedule : current)));

  return (
    <fieldset className={styles.triggers}>
      <legend>{t.legend}</legend>
      {schedules.map((schedule, index) => {
        const label = `${t.schedule} ${index + 1}`;
        const id = `schedule-${index}`;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: schedules have no identity
          <fieldset key={index} className={styles.schedule}>
            <legend className="visually-hidden">{label}</legend>
            <div className={styles['schedule-row']}>
              <select
                className="select"
                aria-label={label}
                value={schedule.kind}
                onChange={(e) => set(index, blankSchedule(e.target.value as ScheduleKind))}
                disabled={disabled}
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t.kinds[kind]}
                  </option>
                ))}
              </select>
              <ScheduleFields
                schedule={schedule}
                onChange={(next) => set(index, next)}
                disabled={disabled}
                id={id}
              />
              <button
                type="button"
                className="icon-button"
                onClick={() => onChange(schedules.filter((_, i) => i !== index))}
                disabled={disabled || schedules.length === 1}
                aria-label={`${t.remove} ${index + 1}`}
                title={t.remove}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <p className={styles['schedule-summary']} aria-live="polite">
              <ArrowRight size={14} aria-hidden="true" />
              {describeSchedule(schedule)}
            </p>
            {schedule.kind === 'monthly' && Number(schedule.day) > 28 && (
              <small className={styles['schedule-note']}>{t.shortMonths}</small>
            )}
            {schedule.kind === 'cron' && (
              <small className={styles['schedule-note']} id={`${id}-help`}>
                {t.cronHelp}
              </small>
            )}
          </fieldset>
        );
      })}
      {schedules.length < MAX_TRIGGERS && (
        <button
          type="button"
          className="text-button"
          onClick={() => onChange([...schedules, blankSchedule('daily')])}
          disabled={disabled}
        >
          <Plus size={14} weight="bold" aria-hidden="true" />
          {t.add}
        </button>
      )}
    </fieldset>
  );
}

interface ScheduleFieldsProps {
  schedule: ScheduleDraft;
  onChange: (schedule: ScheduleDraft) => void;
  disabled: boolean;
  id: string;
}

function ScheduleFields({ schedule, onChange, disabled, id }: ScheduleFieldsProps) {
  const time = (value: string, update: (time: string) => void) => (
    <label className={styles['inline-field']}>
      {t.at}
      <input
        className="input"
        type="time"
        value={value}
        onChange={(e) => update(e.target.value)}
        disabled={disabled}
        required
      />
    </label>
  );

  switch (schedule.kind) {
    case 'daily':
      return (
        <div className={styles['schedule-fields']}>
          {time(schedule.time, (value) => onChange({ ...schedule, time: value }))}
        </div>
      );
    case 'weekly':
      return (
        <div className={styles['schedule-fields']}>
          <div className={styles.days}>
            {WEEK.map((day) => {
              const on = schedule.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  className={`${styles.day} ${on ? styles['day-on'] : ''}`}
                  aria-pressed={on}
                  aria-label={dayName(day, 'long')}
                  onClick={() =>
                    onChange({
                      ...schedule,
                      days: on ? schedule.days.filter((d) => d !== day) : [...schedule.days, day],
                    })
                  }
                  disabled={disabled}
                >
                  {dayName(day, 'short').slice(0, 3)}
                </button>
              );
            })}
          </div>
          {time(schedule.time, (value) => onChange({ ...schedule, time: value }))}
        </div>
      );
    case 'monthly':
      return (
        <div className={styles['schedule-fields']}>
          <label className={styles['inline-field']}>
            {t.day}
            <input
              type="number"
              min={1}
              max={31}
              step={1}
              className={`input ${styles.narrow}`}
              value={schedule.day}
              onChange={(e) => onChange({ ...schedule, day: e.target.value })}
              disabled={disabled}
            />
          </label>
          {time(schedule.time, (value) => onChange({ ...schedule, time: value }))}
        </div>
      );
    case 'once':
      return (
        <div className={styles['schedule-fields']}>
          <input
            type="datetime-local"
            className={`input ${styles.grow}`}
            aria-label={t.kinds.once}
            value={schedule.local}
            onChange={(e) => onChange({ ...schedule, local: e.target.value })}
            disabled={disabled}
          />
        </div>
      );
    case 'every':
      return (
        <div className={styles['schedule-fields']}>
          <label className={styles['inline-field']}>
            {t.every}
            <input
              type="number"
              min={1}
              step={1}
              className={`input ${styles.narrow}`}
              value={schedule.amount}
              onChange={(e) => onChange({ ...schedule, amount: e.target.value })}
              disabled={disabled}
            />
          </label>
          <select
            className="select"
            aria-label={`${t.minutes} / ${t.hours}`}
            value={schedule.unit}
            onChange={(e) => onChange({ ...schedule, unit: e.target.value as 'minutes' | 'hours' })}
            disabled={disabled}
          >
            <option value="minutes">{t.minutes}</option>
            <option value="hours">{t.hours}</option>
          </select>
        </div>
      );
    case 'cron':
      return (
        <div className={styles['schedule-fields']}>
          <input
            className={`input mono ${styles.grow}`}
            aria-label={t.kinds.cron}
            aria-describedby={`${id}-help`}
            value={schedule.expression}
            onChange={(e) => onChange({ ...schedule, expression: e.target.value })}
            spellCheck={false}
            disabled={disabled}
          />
        </div>
      );
  }
}
