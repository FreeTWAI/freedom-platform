/** Recipient rules for the existing ecpay.logistics.domestic.v1 profile only. */
import { deepFreeze } from './errors.js';
import { isOutlyingPostalPrefix } from './postal.js';
import { findCdnBlockedTerm } from '../../providers/ecpay/index.js';
import { normalizeMobile, validatePostalCode, type FieldValidationResult, type RecipientValidationError,
  type HomeRecipientResult, type CvsRecipientResult } from './recipient.js';

/**
 * Validates recipient name:
 * - NFKC, trim
 * - empty -> required
 * - ^(?:\p{Script=Han}|[A-Za-z])+$ (flag u) else format
 * - weight: 2 per Han char, 1 per ASCII letter
 * - weight < 4 -> too_short, > 10 -> too_long
 */
export function validateEcpayRecipientName(raw: unknown): FieldValidationResult<string> {
  if (raw === undefined || raw === null) {
    return { ok: false, code: 'required' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, code: 'format' };
  }

  const name = raw.normalize('NFKC').trim();
  if (name.length === 0) {
    return { ok: false, code: 'required' };
  }

  if (!/^(?:\p{Script=Han}|[A-Za-z])+$/u.test(name)) {
    return { ok: false, code: 'format' };
  }

  let weight = 0;
  for (const ch of name) {
    if (/\p{Script=Han}/u.test(ch)) {
      weight += 2;
    } else if (/[A-Za-z]/.test(ch)) {
      weight += 1;
    }
  }

  if (weight < 4) {
    return { ok: false, code: 'too_short' };
  }
  if (weight > 10) {
    return { ok: false, code: 'too_long' };
  }

  if (findCdnBlockedTerm(name) !== null) {
    return { ok: false, code: 'blocked_term' };
  }

  return { ok: true, value: name };
}

// Same rule as ECPay's assertHomeAddress: a lone UTF-16 surrogate is malformed text.
const LONE_SURROGATE_PATTERN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function cleanAddressText(raw: unknown): FieldValidationResult<string> {
  if (raw === undefined || raw === null) {
    return { ok: false, code: 'required' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, code: 'format' };
  }
  // Checked on the raw text, so removing a control character cannot join two halves into a pair.
  if (LONE_SURROGATE_PATTERN.test(raw)) {
    return { ok: false, code: 'format' };
  }

  let s = raw.normalize('NFKC');
  s = s.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  s = s.replace(/\s+/g, ' ').trim();

  if (s.length === 0) {
    return { ok: false, code: 'required' };
  }

  if (/[<>&]/.test(s)) {
    return { ok: false, code: 'format' };
  }

  const codePointCount = [...s].length;
  if (codePointCount <= 6) {
    return { ok: false, code: 'too_short' };
  }
  if (codePointCount > 60) {
    return { ok: false, code: 'too_long' };
  }

  if (findCdnBlockedTerm(s) !== null) {
    return { ok: false, code: 'blocked_term' };
  }

  return { ok: true, value: s };
}

export function validateEcpayHomeRecipient(raw: unknown): HomeRecipientResult {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const errors: RecipientValidationError[] = [];

  const nameRes = validateEcpayRecipientName(input.name);
  if (!nameRes.ok) {
    errors.push({ field: 'name', code: nameRes.code });
  }

  const mobileRes = normalizeMobile(input.mobile);
  if (!mobileRes.ok) {
    errors.push({ field: 'mobile', code: mobileRes.code });
  }

  const postalRes = validatePostalCode(input.postal_code);
  if (!postalRes.ok) {
    errors.push({ field: 'postal_code', code: postalRes.code });
  }

  const addressRes = cleanAddressText(input.address);
  if (!addressRes.ok) {
    errors.push({ field: 'address', code: addressRes.code });
  }

  if (errors.length > 0) {
    return deepFreeze({ ok: false, errors });
  }

  const postalVal = postalRes.ok ? postalRes.value : { code: '', prefix: '' };
  return deepFreeze({
    ok: true,
    recipient: {
      name: nameRes.ok ? nameRes.value : '',
      mobile: mobileRes.ok ? mobileRes.value : '',
      postal_code: postalVal.code,
      address: addressRes.ok ? addressRes.value : '',
      postal_prefix: postalVal.prefix,
      outlying: isOutlyingPostalPrefix(postalVal.prefix),
    },
  });
}

export function validateEcpayCvsRecipient(raw: unknown): CvsRecipientResult {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const errors: RecipientValidationError[] = [];

  const nameRes = validateEcpayRecipientName(input.name);
  if (!nameRes.ok) {
    errors.push({ field: 'name', code: nameRes.code });
  }

  const mobileRes = normalizeMobile(input.mobile);
  if (!mobileRes.ok) {
    errors.push({ field: 'mobile', code: mobileRes.code });
  }

  if (errors.length > 0) {
    return deepFreeze({ ok: false, errors });
  }

  return deepFreeze({
    ok: true,
    recipient: {
      name: nameRes.ok ? nameRes.value : '',
      mobile: mobileRes.ok ? mobileRes.value : '',
    },
  });
}
