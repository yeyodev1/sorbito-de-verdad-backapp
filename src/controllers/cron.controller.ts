import { Request, Response, NextFunction } from 'express';
import { HttpStatusCode } from 'axios';
import { runPaymentReminders } from '../jobs/payment-reminders.job';

function authorize(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers['authorization'] || '';
  if (header === `Bearer ${secret}`) return true;
  // Vercel cron sets x-vercel-signature; allow header-based shared secret too
  const xKey = req.headers['x-cron-secret'];
  if (xKey === secret) return true;
  return false;
}

export const paymentRemindersCron = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!authorize(req)) {
      res.status(HttpStatusCode.Unauthorized).send({ success: false, message: 'Unauthorized' });
      return;
    }
    const result = await runPaymentReminders();
    res.send({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
