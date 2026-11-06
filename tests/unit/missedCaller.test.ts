import { describe, it, expect } from 'vitest';
import { missedCallerAlert, analysisFlag } from '../../src/alerts/missedCaller';

// Shapes copied from real Retell post-call payloads in the Nov 2026 call review.
const transferInvoke = { role: 'tool_call_invocation', tool_call_id: 't1', name: 'transfer_call' };
const transferNoHuman = {
  role: 'tool_call_result',
  tool_call_id: 't1',
  successful: false,
  content: '{"status":"Call connected but no human response detected.. Please inform the customer"}',
};
const transferOk = {
  role: 'tool_call_result',
  tool_call_id: 't1',
  successful: true,
  content: '{"status":"transferred successfully"}',
};
const msgInvoke = { role: 'tool_call_invocation', tool_call_id: 'm1', name: 'take_message' };
const msgOk = { role: 'tool_call_result', tool_call_id: 'm1', content: '{"ok":true,"notified":["sms_primary"]}' };
const msgFailed = { role: 'tool_call_result', tool_call_id: 'm1', content: '{"ok":false,"message":"Could not record the message."}' };

const base = {
  call_id: 'call_abc',
  from_number: '+19035550123',
  disconnection_reason: 'user_hangup',
  call_analysis: { call_summary: 'Guest wanted the front desk about a receipt.' },
};

describe('missedCallerAlert', () => {
  it('returns null when no transfer was attempted', () => {
    expect(missedCallerAlert({ ...base, transcript_with_tool_calls: [] })).toBeNull();
  });

  it('returns null when the transfer connected', () => {
    expect(
      missedCallerAlert({
        ...base,
        disconnection_reason: 'call_transfer',
        transcript_with_tool_calls: [transferInvoke, transferOk],
      }),
    ).toBeNull();
  });

  it('returns null when the transfer failed but Ava took a message', () => {
    expect(
      missedCallerAlert({ ...base, transcript_with_tool_calls: [transferInvoke, transferNoHuman, msgInvoke, msgOk] }),
    ).toBeNull();
  });

  it('alerts when the transfer failed and the caller hung up with nothing logged', () => {
    const a = missedCallerAlert({ ...base, transcript_with_tool_calls: [transferInvoke, transferNoHuman] });
    expect(a).not.toBeNull();
    expect(a!.callback_number).toBe('+19035550123');
    expect(a!.priority).toBe('high');
    expect(a!.details).toContain('receipt');
    expect(a!.details).toContain('call_abc');
  });

  it('alerts when the caller hung up while it was still ringing (no tool result at all)', () => {
    const a = missedCallerAlert({ ...base, transcript_with_tool_calls: [transferInvoke] });
    expect(a).not.toBeNull();
  });

  it('alerts when take_message itself failed', () => {
    const a = missedCallerAlert({
      ...base,
      transcript_with_tool_calls: [transferInvoke, transferNoHuman, msgInvoke, msgFailed],
    });
    expect(a).not.toBeNull();
  });

  it('is urgent when the analysis says urgent, and uses the known guest name', () => {
    const a = missedCallerAlert({
      ...base,
      retell_llm_dynamic_variables: { guest_name: 'Sarah', suite: 'Garden Suite' },
      call_analysis: { call_summary: 'No hot water.', custom_analysis_data: { is_urgent: true } },
      transcript_with_tool_calls: [transferInvoke, transferNoHuman],
    });
    expect(a!.priority).toBe('urgent');
    expect(a!.caller_name).toBe('Sarah');
    expect(a!.details).toContain('Garden Suite');
  });

  it('never uses an unfilled template variable as a name, and copes with a withheld number', () => {
    const a = missedCallerAlert({
      ...base,
      from_number: undefined,
      retell_llm_dynamic_variables: { guest_name: '{{guest_name}}' },
      transcript_with_tool_calls: [transferInvoke, transferNoHuman],
    });
    expect(a!.caller_name).toBe('Unknown caller');
    expect(a!.callback_number).toBe('withheld');
  });
});

describe('analysisFlag', () => {
  it('reads custom_analysis_data and the old top-level spot', () => {
    expect(analysisFlag({ call_analysis: { custom_analysis_data: { needs_callback: true } } }, 'needs_callback')).toBe(true);
    expect(analysisFlag({ call_analysis: { needs_callback: 'true' } }, 'needs_callback')).toBe(true);
    expect(analysisFlag({ call_analysis: {} }, 'needs_callback')).toBe(false);
  });
});
