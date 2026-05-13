import dotenv from "dotenv";
import { dbConnect } from "./config/mongo";
import { createApp } from "./app";
import { runPaymentReminders } from "./jobs/payment-reminders.job";

dotenv.config();

const port = process.env.PORT || 8100;
const { app, server } = createApp();

// Initiate DB connection (non-blocking for startup)
dbConnect().catch(error => {
  console.error("Failed to connect to MongoDB during startup:", error);
});

// For Vercel/serverless environments, we export the app.
// For local development, we listen on the configured port.
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  server.timeout = 10 * 60 * 1000;
  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });

  // Local-only payment reminders loop (Vercel Cron handles production via /api/cron/payment-reminders)
  if (process.env.PAYMENT_REMINDERS_LOCAL_CRON !== 'off') {
    setInterval(() => {
      runPaymentReminders().catch(err => console.error('[local-cron] payment-reminders error:', err));
    }, 5 * 60 * 1000);
    console.log('[local-cron] payment-reminders interval started (every 5 min)');
  }
}

export default app;
