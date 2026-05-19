import 'dotenv/config';
import axios, { AxiosError } from 'axios';
import type { IOrder } from '../models/Order.model';

function getProjectId() {
  const p = process.env.BBC_PROJECT_ID || '83457ab6-a0df-4b07-b91f-e0fa8d19d45f';
  if (!p) throw new Error('BBC_PROJECT_ID env var is not set');
  return p;
}
function getApiKey() {
  const k = process.env.BBC_API_KEY || 'bbc-1a982c21-ecbe-4d40-a541-4a27aeaf58af';
  if (!k) throw new Error('BBC_API_KEY env var is not set');
  return k;
}

function authHeaders() {
  return {
    'x-api-builderbot': getApiKey(),
    'Content-Type': 'application/json',
  };
}

function getBaseUrls(): string[] {
  const primary = process.env.BBC_BASE_URL || 'https://app.builderbot.cloud';
  return primary === 'https://app.builderbot.cloud'
    ? ['https://app.builderbot.cloud']
    : [primary, 'https://app.builderbot.cloud'];
}

function logErr(ctx: string, error: unknown) {
  if (error instanceof AxiosError) {
    console.error(`[BBC] ${ctx} failed:`, {
      status: error.response?.status,
      data: JSON.stringify(error.response?.data).slice(0, 300),
    });
  } else {
    console.error(`[BBC] ${ctx} error:`, error);
  }
}

function pickPhone(order: IOrder): string | undefined {
  return order.whatsappPhone || order.shippingAddress?.phone;
}

function normalizePhone(phone: string): string {
  let p = String(phone).replace(/[^0-9+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  // Ecuador local format 09... → 5939...
  if (p.length === 10 && p.startsWith('0')) p = '593' + p.slice(1);
  return p;
}

export const bbcNotificationService = {
  async sendWhatsApp(phone: string, message: string): Promise<void> {
    const projectId = getProjectId();
    const number = normalizePhone(phone);
    const payload = {
      messages: { content: message },
      number,
    };

    let lastError: unknown = null;
    for (const baseUrl of getBaseUrls()) {
      const url = `${baseUrl}/api/v2/${projectId}/messages`;
      try {
        const r = await axios.post(url, payload, { headers: authHeaders(), timeout: 20000 });
        return;
      } catch (error) {
        lastError = error;
        logErr(`sendWhatsApp via ${baseUrl}`, error);
      }
    }

    throw lastError;
  },

  async sendPaidConfirmation(order: IOrder): Promise<void> {
    const phone = pickPhone(order);
    if (!phone) {
      console.warn(`[BBC] order ${order.orderNumber} has no phone, skip paid notification`);
      return;
    }
    const msg =
      `✅ ¡Pago confirmado! Pedido ${order.orderNumber} por $${order.total.toFixed(2)}.\n\n` +
      `Pronto te enviamos detalles de envío. Gracias por confiar en Sorbito de Verdad ☕💛`;
    await this.sendWhatsApp(phone, msg);
  },

  async sendPaymentReminder(order: IOrder, stage: 'r15min' | 'r1h' | 'r24h'): Promise<void> {
    const phone = pickPhone(order);
    if (!phone) {
      console.warn(`[BBC] order ${order.orderNumber} has no phone, skip reminder`);
      return;
    }
    const link = order.payphoneLinkUrl;
    if (!link) {
      console.warn(`[BBC] order ${order.orderNumber} has no payphoneLinkUrl, skip reminder`);
      return;
    }

    const messages: Record<typeof stage, string> = {
      r15min: `Hola 👋 Notamos que aún no completas tu pago del pedido ${order.orderNumber} ($${order.total.toFixed(2)}). Aquí tu link: ${link}`,
      r1h: `Tu pedido ${order.orderNumber} sigue esperando pago ⏳. Si necesitas ayuda escríbenos. Link: ${link}`,
      r24h: `Último recordatorio: tu link de pago expira pronto. Pedido ${order.orderNumber} — $${order.total.toFixed(2)}. ${link}`,
    };
    await this.sendWhatsApp(phone, messages[stage]);
  },
};
