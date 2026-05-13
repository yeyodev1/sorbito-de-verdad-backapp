import 'dotenv/config';
import axios, { AxiosError } from 'axios';
import type { IOrder } from '../models/Order.model';

function getBaseUrl() {
  const u = process.env.BBC_PROJECT_BASE_URL;
  if (!u) throw new Error('BBC_PROJECT_BASE_URL env var is not set');
  return u.replace(/\/$/, '');
}
function getApiKey() {
  const k = process.env.BBC_API_KEY;
  if (!k) throw new Error('BBC_API_KEY env var is not set');
  return k;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  };
}

function logErr(ctx: string, error: unknown) {
  if (error instanceof AxiosError) {
    console.error(`[BBC] ${ctx} failed:`, {
      status: error.response?.status,
      data: JSON.stringify(error.response?.data),
    });
  } else {
    console.error(`[BBC] ${ctx} error:`, error);
  }
}

function pickPhone(order: IOrder): string | undefined {
  return order.whatsappPhone || order.shippingAddress?.phone;
}

export const bbcNotificationService = {
  async sendWhatsApp(phone: string, message: string): Promise<void> {
    const baseUrl = getBaseUrl();
    const payload = { number: phone, message };
    try {
      await axios.post(`${baseUrl}/v1/messages`, payload, { headers: authHeaders() });
      console.log('[BBC] sent WhatsApp to', phone);
    } catch (error) {
      logErr('sendWhatsApp', error);
      throw error;
    }
  },

  async sendPaidConfirmation(order: IOrder): Promise<void> {
    const phone = pickPhone(order);
    if (!phone) {
      console.warn(`[BBC] order ${order.orderNumber} has no phone, skip paid notification`);
      return;
    }
    const msg =
      `✅ ¡Pago confirmado! Pedido ${order.orderNumber} por $${order.total.toFixed(2)}.\n` +
      `Pronto te enviamos detalles de envío. Gracias por confiar en Sorbito de Verdad ☕`;
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
