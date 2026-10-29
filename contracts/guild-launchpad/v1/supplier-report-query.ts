import {z} from 'zod';

// Shared query validation without loading supplier/order response decoders in the shell.
export const SUPPLIER_REPORT_MAX_DAYS = 366;
export const SupplierReportDaySchema = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).refine(value => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, 'Invalid calendar date.');
const dayNumber = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86400000;
/** Both days are Asia/Taipei calendar days and both are included: at most SUPPLIER_REPORT_MAX_DAYS days. */
export const SupplierReportQuerySchema = z.object({from: SupplierReportDaySchema, to: SupplierReportDaySchema}).strict()
  .refine(value => dayNumber(value.from) <= dayNumber(value.to), {message: 'from must not be after to.', path: ['to']})
  .refine(value => dayNumber(value.to) - dayNumber(value.from) < SUPPLIER_REPORT_MAX_DAYS,
    {message: 'The period is at most 366 days.', path: ['to']});
export type SupplierReportQuery = z.infer<typeof SupplierReportQuerySchema>;
