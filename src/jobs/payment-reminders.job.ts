export interface ReminderRunResult {
  scanned: number;
  sent: { r15min: number; r1h: number; r24h: number };
  cancelled: number;
  errors: number;
}

export async function runPaymentReminders(): Promise<ReminderRunResult> {
  return { scanned: 0, sent: { r15min: 0, r1h: 0, r24h: 0 }, cancelled: 0, errors: 0 };
}
