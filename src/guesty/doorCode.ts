import { guestyFetch } from './client';
import { log } from '../logger';

// Where a reservation's door code can live in Guesty. Michelle (12 Nov 2026): "The code is
// listed in Guesty on the 'overview' page". Guesty has three places that can hold it, so we
// read all three and take the first value that looks like a code:
//   key_code      reservation notes.keyCode ("key code for workflow automation")
//   lock_manager  Guesty Locks Manager, GET /guest-code?reservationId=
//   custom_field  a reservation custom field named like door / key code / lock / access / entry
export type DoorCodeSource = 'key_code' | 'lock_manager' | 'custom_field';

export interface DoorCodeCandidate {
  source: DoorCodeSource;
  label: string;
  raw: unknown;
  code: string | null;
}

export interface DoorCodeResult {
  best: DoorCodeCandidate | null;
  candidates: DoorCodeCandidate[];
  errors: string[];
  // Test mode only: what the reservation holds, names and masked shapes, never values.
  // Lets one check against a real booking show where the hotel actually keeps codes.
  diag?: Record<string, unknown>;
}

const DOORISH = /door|key.?code|lock|access|entry|gate|keypad/i;
const DEAD_CODE_STATUS = /fail|delet|revok|expir|error|cancel|inactive/i;

/**
 * A door code as a guest keys it in: 3 to 9 characters of digits, optionally with # or *. A short free
 * text note yields its single digit run ("Code: 4821#" gives "4821#"). Anything ambiguous
 * (two numbers, long prose) is not a code: the caller is transferred instead.
 */
export function cleanDoorCode(raw: unknown): string | null {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;
  if (/^[0-9][0-9#*]{2,8}$/.test(s)) return s;
  if (s.length > 40) return null;
  // Whole digit runs only, so a phone number in the note never becomes a "code".
  const runs = s.match(/(?<![0-9])[0-9][0-9#*]{2,8}(?![0-9])/g) ?? [];
  return runs.length === 1 ? runs[0] : null;
}

/** "str[4] 9999": the shape of a value with every digit and letter masked. For logs and test mode. */
export function maskShape(raw: unknown): string {
  if (raw === null || raw === undefined) return 'empty';
  const s = String(raw);
  return `${typeof raw}[${s.length}] ${s.replace(/[0-9]/g, '9').replace(/[A-Za-z]/g, 'a').slice(0, 24)}`;
}

let fieldNames: { at: number; byId: Map<string, string> } | null = null;
const FIELD_NAMES_TTL_MS = 6 * 60 * 60 * 1000;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function customFieldNames(): Promise<Map<string, string>> {
  if (fieldNames && Date.now() - fieldNames.at < FIELD_NAMES_TTL_MS) return fieldNames.byId;
  const me = (await guestyFetch('open_api', 'GET', '/accounts/me', undefined, { authRetry: false })) as any;
  const accountId = me?._id ?? me?.id;
  const byId = new Map<string, string>();
  if (accountId) {
    const defs = (await guestyFetch('open_api', 'GET', `/accounts/${accountId}/custom-fields`, undefined, {
      authRetry: false,
    })) as any;
    for (const d of Array.isArray(defs) ? defs : defs?.results ?? defs?.customFields ?? []) {
      const id = d?.fieldId ?? d?._id;
      if (id) byId.set(String(id), [d?.key, d?.displayName, d?.object].filter(Boolean).join(' / '));
    }
  }
  fieldNames = { at: Date.now(), byId };
  return byId;
}

/** Reset the custom-field name cache (tests). */
export function resetDoorCodeCache(): void {
  fieldNames = null;
}

// Test mode only: every key path in a Guesty object that sounds like a code or access
// instruction, with its value masked. Finds where a hotel keeps codes without seeing one.
const CODEISH_PATH = /door|lock|key|access|entry|gate|pin|instruction|checkin|check_in|arrival|wifi|code/i;
const NOISE_PATH = /confirmationCode|currency|countryCode|zipcode|postalCode|languageCode|integration\.|_id$|Id$|ids?\[|picture|image|url$|timezone/i;
function codeishPaths(o: unknown, path = '', out: string[] = [], depth = 0): string[] {
  if (out.length >= 60 || depth > 6 || o === null || o === undefined) return out;
  if (Array.isArray(o)) {
    o.slice(0, 10).forEach((x, i) => codeishPaths(x, `${path}[${i}]`, out, depth + 1));
    return out;
  }
  if (typeof o === 'object') {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) codeishPaths(v, path ? `${path}.${k}` : k, out, depth + 1);
    return out;
  }
  if (CODEISH_PATH.test(path) && !NOISE_PATH.test(path) && String(o).trim() !== '') out.push(`${path} = ${maskShape(o)}`);
  return out;
}

export async function findDoorCode(reservationId: string, opts: { diagnose?: boolean } = {}): Promise<DoorCodeResult> {
  const candidates: DoorCodeCandidate[] = [];
  const errors: string[] = [];
  const id = encodeURIComponent(reservationId);

  // 1. notes.keyCode, plus the reservation's custom field values, in one read of an
  //    endpoint the backend already uses.
  let customValues: { fieldId?: string; value?: unknown }[] = [];
  let listingId: string | null = null;
  const diag: Record<string, unknown> = {};
  try {
    const r = (await guestyFetch(
      'open_api',
      'GET',
      `/reservations/${id}?fields=${encodeURIComponent('notes customFields listingId')}`,
    )) as any;
    const res = r?.result ?? r;
    if (res?.notes?.keyCode !== undefined && res?.notes?.keyCode !== '') {
      candidates.push({ source: 'key_code', label: 'notes.keyCode', raw: res.notes.keyCode, code: cleanDoorCode(res.notes.keyCode) });
    }
    if (Array.isArray(res?.customFields)) customValues = res.customFields;
    listingId = res?.listingId ?? res?.listing?._id ?? null;
    if (opts.diagnose) {
      diag.reservation_keys = Object.keys(res ?? {});
      diag.notes = Object.fromEntries(Object.entries(res?.notes ?? {}).map(([k, v]) => [k, maskShape(v)]));
      diag.custom_field_count = customValues.length;
    }
  } catch (err) {
    errors.push(`reservation: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
  }

  // 2. Guesty Locks Manager.
  try {
    const g = (await guestyFetch('open_api', 'GET', `/guest-code?reservationId=${id}`, undefined, {
      authRetry: false,
    })) as any;
    if (opts.diagnose) diag.lock_manager = { codes: (g?.codes ?? []).length, locks: (g?.locks ?? []).length };
    for (const c of g?.codes ?? []) {
      if (DEAD_CODE_STATUS.test(String(c?.status ?? ''))) continue;
      candidates.push({ source: 'lock_manager', label: `guest-code ${c?.purpose ?? ''} ${c?.status ?? ''}`.trim(), raw: c?.code, code: cleanDoorCode(c?.code) });
    }
  } catch (err) {
    errors.push(`lock_manager: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
  }

  // 3. Custom fields whose name says door / key code / lock / access / entry.
  if (customValues.length) {
    try {
      const names = await customFieldNames();
      if (opts.diagnose) {
        diag.custom_fields = customValues.map((f) => `${names.get(String(f?.fieldId ?? '')) ?? f?.fieldId}: ${maskShape(f?.value)}`);
      }
      for (const f of customValues) {
        const name = names.get(String(f?.fieldId ?? '')) ?? '';
        if (name && DOORISH.test(name)) {
          candidates.push({ source: 'custom_field', label: name, raw: f?.value, code: cleanDoorCode(f?.value) });
        }
      }
    } catch (err) {
      errors.push(`custom_fields: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    }
  }

  if (opts.diagnose) {
    try {
      diag.reservation_codeish = codeishPaths(await guestyFetch('open_api', 'GET', `/reservations/${id}`));
    } catch (err) {
      errors.push(`reservation_full: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    }
    if (listingId) {
      try {
        diag.listing_codeish = codeishPaths(await guestyFetch('open_api', 'GET', `/listings/${encodeURIComponent(listingId)}`));
      } catch (err) {
        errors.push(`listing: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
      }
    }
  }

  // Per-suite custom fields: reported in test mode only, never read out. A fixed suite code
  // could be a master or cleaning code; it becomes a source only if the hotel says so.
  if (opts.diagnose && listingId) {
    try {
      const pc = (await guestyFetch('open_api', 'GET', `/properties-api/custom-fields/${encodeURIComponent(listingId)}`, undefined, {
        authRetry: false,
      })) as any;
      const names = await customFieldNames().catch(() => new Map<string, string>());
      diag.listing_custom_fields = (pc?.customFields ?? []).map(
        (f: any) => `${names.get(String(f?.fieldId ?? '')) ?? f?.displayName ?? f?.fieldId}: ${maskShape(f?.value)}`,
      );
    } catch (err) {
      errors.push(`listing_custom_fields: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    }
  }

  const best = candidates.find((c) => c.code) ?? null;
  log.info(
    {
      reservationId,
      best: best ? `${best.source} ${maskShape(best.code)}` : null,
      candidates: candidates.map((c) => `${c.source}:${c.label}:${maskShape(c.raw)}`),
      errors,
    },
    'door_code_lookup',
  );
  return opts.diagnose ? { best, candidates, errors, diag } : { best, candidates, errors };
}
