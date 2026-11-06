import type { StaffAlert } from './staffAlert';

// THE CALLER WHO HUNG UP WHILE THE TRANSFER RANG.
//
// The call review of 10 Aug to 5 Nov 2026 found 76 transfers that never connected, and
// 55 of those callers left with nothing logged: no take_message, no alert, nobody knew
// they had called. Some hung up while it rang; most hung up when Ava came back and asked
// whether to try again. A prompt rule cannot fix a caller who has already gone, so the
// backstop lives here: after every call, if a transfer was attempted, did not connect,
// and no message was taken, the staff get the caller's number and what they wanted.

interface ToolItem {
  role?: string;
  tool_call_id?: string;
  name?: string;
  content?: string;
  successful?: boolean;
}

export interface PostCallCall {
  call_id?: string;
  from_number?: string;
  disconnection_reason?: string;
  transcript_with_tool_calls?: ToolItem[];
  retell_llm_dynamic_variables?: Record<string, unknown>;
  call_analysis?: {
    call_summary?: string;
    custom_analysis_data?: Record<string, unknown>;
    [k: string]: unknown;
  };
}

function str(v: unknown): string {
  return typeof v === 'string' && v.trim() && !v.includes('{{') ? v.trim() : '';
}

/** Read a custom analysis field wherever Retell put it (custom_analysis_data, or top level on old payloads). */
export function analysisFlag(call: PostCallCall, key: string): boolean {
  const a = call.call_analysis ?? {};
  const v = (a.custom_analysis_data ?? {})[key] ?? a[key];
  return v === true || v === 'true';
}

function toolOk(item: ToolItem | undefined): boolean {
  if (!item) return false;
  if (item.successful === false) return false;
  // take_message answers { ok: true, notified: [...] }; a timeout or error does not.
  return /"ok"\s*:\s*true/.test(item.content ?? '');
}

/**
 * Returns the alert to raise, or null when the call needs nothing from staff.
 * Pure: no I/O, so it is unit tested against the real payload shape.
 */
export function missedCallerAlert(call: PostCallCall): StaffAlert | null {
  const items = Array.isArray(call.transcript_with_tool_calls) ? call.transcript_with_tool_calls : [];
  const invocations = items.filter((i) => i.role === 'tool_call_invocation');
  const results = items.filter((i) => i.role === 'tool_call_result');
  const resultFor = (id?: string) => results.find((r) => r.tool_call_id === id);

  const transfers = invocations.filter((i) => i.name === 'transfer_call');
  if (transfers.length === 0) return null;

  // The caller reached a person.
  if (call.disconnection_reason === 'call_transfer') return null;
  if (transfers.some((t) => resultFor(t.tool_call_id)?.successful === true)) return null;

  // Ava already logged it.
  const messageTaken = invocations
    .filter((i) => i.name === 'take_message')
    .some((i) => toolOk(resultFor(i.tool_call_id)));
  if (messageTaken) return null;

  const vars = call.retell_llm_dynamic_variables ?? {};
  const name = str(vars.guest_name) || 'Unknown caller';
  const suite = str(vars.suite);
  const summary = str(call.call_analysis?.call_summary);
  const note = str(call.call_analysis?.custom_analysis_data?.follow_up_note);

  const details = [
    note || summary || 'No summary available.',
    suite ? `Booked: ${suite}.` : '',
    `Call ${call.call_id ?? 'unknown'}.`,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    caller_name: name,
    callback_number: str(call.from_number) || 'withheld',
    reason: 'Missed transfer: hung up before anyone answered, please call back',
    details,
    priority: analysisFlag(call, 'is_urgent') ? 'urgent' : 'high',
  };
}
