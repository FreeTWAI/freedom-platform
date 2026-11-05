import {useId} from 'react';
import {EVENT_PRIZE_ICONS, type EventPrizeIconId} from '../../../../modules/community/event-prize-icons';
import {EventPrizeIcon} from './EventPrizeIcon';
import './EventPrizeIconPicker.css';

export interface EventPrizeIconPickerProps {
  value: EventPrizeIconId;
  onChange: (iconId: EventPrizeIconId) => void;
  disabled?: boolean;
  legend?: string;
}

/** Controlled selection only. The parent owns draft changes and real persistence. */
export function EventPrizeIconPicker({value, onChange, disabled = false, legend = '選擇獎品插圖'}: EventPrizeIconPickerProps) {
  const groupId = useId();
  const hintId = `${groupId}-hint`;
  return <fieldset className="event-prize-icon-picker" disabled={disabled} aria-describedby={hintId}>
    <legend>{legend}</legend>
    <p id={hintId} className="event-prize-icon-picker-hint">內建插圖僅供示意，不是獎品實拍照片。</p>
    <div className="event-prize-icon-options">
      {EVENT_PRIZE_ICONS.map(icon => <label key={icon.id} className="event-prize-icon-option" htmlFor={`${groupId}-${icon.id}`}>
        <input id={`${groupId}-${icon.id}`} type="radio" name={groupId} value={icon.id} checked={value === icon.id} disabled={disabled} onChange={event => {
          if (!disabled && event.currentTarget.checked) onChange(icon.id);
        }} />
        <EventPrizeIcon iconId={icon.id} className="event-prize-icon-art" />
        <span>{icon.label}</span>
      </label>)}
    </div>
  </fieldset>;
}
