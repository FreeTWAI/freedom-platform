import {seasonalDecorationAt, type SeasonalDecoration} from './calendar';
export type SeasonalPreference = 'auto' | 'off' | SeasonalDecoration;
export const SEASONAL_STORAGE_KEY = 'freedom-seasonal-theme';
export const SEASONAL_CHOICES = [['auto','自動配合節日'],['off','關閉節日主題'],['halloween','萬聖節'],['christmas','聖誕節'],['newyear','新年']] as const;
export function parseSeasonalPreference(value: unknown): SeasonalPreference {
  return SEASONAL_CHOICES.some(([id]) => id === value) ? value as SeasonalPreference : 'auto';
}
export function resolveSeasonalTheme(preference: SeasonalPreference, now: Date): SeasonalDecoration | null {
  return preference === 'off' ? null : preference === 'auto' ? seasonalDecorationAt(now) : preference;
}
export function readSeasonalPreference(storage: Pick<Storage,'getItem'>): SeasonalPreference {
  try {return parseSeasonalPreference(storage.getItem(SEASONAL_STORAGE_KEY));} catch {return 'auto';}
}
export function saveSeasonalPreference(preference: SeasonalPreference, storage: Pick<Storage,'setItem'>): void {
  try {storage.setItem(SEASONAL_STORAGE_KEY,preference);} catch {/* Keep the current visit usable when storage is unavailable. */}
}
