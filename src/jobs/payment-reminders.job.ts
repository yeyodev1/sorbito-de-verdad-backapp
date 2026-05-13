import { Order, IOrder } from '../models/Order.model';
import { bbcNotificationService } from '../services/bbc-notification.service';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

export interface ReminderRunResult {
  scanned: number;
  sent: { r15min: number; r1h: number; r24h: number };
  cancelled: number;
  errors: number;
}

export async function runPaymentReminders(): Promise<ReminderRunResult> {
  const result: ReminderRunResult = {
    scanned: 0,
    sent: { r15min: 0, r1h: 0, r24h: 0 },
    cancelled: 0,
    errors: 0,
  };

  const orders = await Order.find({
    paymentStatus: 'pending',
    source: 'whatsapp_bot',
    payphoneLinkUrl: { $exists: true, $ne: null as any },
    status: { $ne: 'cancelled' },
  });

  result.scanned = orders.length;
  const now = Date.now();

  for (const order of orders) {
    try {
      const ageMs = now - new Date(order.createdAt).getTime();
      const reminders = order.remindersSent || {};

      if (ageMs >= TWO_DAYS_MS) {
        order.status = 'cancelled';
        await order.save();
        result.cancelled++;
        continue;
      }

      let stage: 'r15min' | 'r1h' | 'r24h' | null = null;
      if (ageMs >= ONE_DAY_MS && !reminders.r24h) stage = 'r24h';
      else if (ageMs >= ONE_HOUR_MS && !reminders.r1h) stage = 'r1h';
      else if (ageMs >= FIFTEEN_MIN_MS && !reminders.r15min) stage = 'r15min';

      if (!stage) continue;

      await bbcNotificationService.sendPaymentReminder(order as IOrder, stage);

      order.remindersSent = { ...reminders, [stage]: new Date() };
      await order.save();
      result.sent[stage]++;
    } catch (err) {
      result.errors++;
      console.error(`[payment-reminders] order ${order.orderNumber} failed:`, err);
    }
  }

  console.log('[payment-reminders] result:', JSON.stringify(result));
  return result;
}
