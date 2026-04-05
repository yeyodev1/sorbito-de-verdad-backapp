import 'dotenv/config'
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Sorbito de Verdad <notificaciones@sorbitodeverdad.com>';
const DEFAULT_FRONTEND_URL = process.env.FRONTEND_URL || process.env.DEFAULT_FRONTEND_URL || 'http://localhost:5173';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ─── Error logger ─────────────────────────────────────────────────────────────

function logEmailError(context: string, error: { name: string; message: string; statusCode?: number | null }) {
  console.error(`[EmailService] ${context} failed:`, {
    name: error.name,
    message: error.message,
    statusCode: error.statusCode ?? 'unknown',
    timestamp: new Date().toISOString(),
  });
}

// ─── Templates ────────────────────────────────────────────────────────────────

function baseTemplate(title: string, preheader: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#FAFAF8;font-family:'Inter',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <!-- Preheader (hidden) -->
  <span style="display:none;font-size:1px;color:#FAFAF8;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#FAFAF8;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" role="presentation"
          style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,26,26,0.08);max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#1A1A1A;padding:32px 40px;text-align:center;">
              <p style="margin:0;color:#C8956C;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;">Sorbito de Verdad</p>
              <h1 style="margin:10px 0 0;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3;">${title}</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F3EFE9;padding:24px 40px;text-align:center;border-top:1px solid #EDE8E3;">
              <p style="margin:0 0 6px;color:#6B6560;font-size:12px;">
                © 2026 Sorbito de Verdad ·
                <a href="${DEFAULT_FRONTEND_URL}" style="color:#C8956C;text-decoration:none;">sorbitodeverdad.com</a>
              </p>
              <p style="margin:0;color:#9B9590;font-size:11px;">
                Si no realizaste esta acción, puedes ignorar este correo.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class EmailService {

  /**
   * Envía email de recuperación de contraseña.
   * Retorna { success, messageId } o { success: false, error }.
   */
  async sendPasswordReset(to: string, name: string, token: string, frontendUrl?: string): Promise<EmailResult> {
    const baseUrl = frontendUrl ?? DEFAULT_FRONTEND_URL;
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    const body = `
      <p style="margin:0 0 16px;color:#1A1A1A;font-size:16px;line-height:1.6;">
        Hola <strong>${name}</strong>,
      </p>
      <p style="margin:0 0 28px;color:#6B6560;font-size:15px;line-height:1.7;">
        Recibimos una solicitud para restablecer la contraseña de tu cuenta.
        Haz clic en el botón de abajo para crear una nueva contraseña. El enlace expira en <strong>1 hora</strong>.
      </p>
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation">
        <tr>
          <td align="center" style="padding-bottom:28px;">
            <a href="${resetUrl}"
               style="display:inline-block;background:#C8956C;color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.02em;mso-padding-alt:0;text-underline-color:#C8956C;">
              Restablecer contraseña
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 8px;color:#6B6560;font-size:13px;line-height:1.6;">
        Si el botón no funciona, copia y pega este enlace en tu navegador:
      </p>
      <p style="margin:0;color:#C8956C;font-size:12px;word-break:break-all;line-height:1.5;">${resetUrl}</p>
    `;

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: 'Recupera tu contraseña — Sorbito de Verdad',
      html: baseTemplate('Recupera tu contraseña', `Hola ${name}, aquí está tu enlace para restablecer tu contraseña.`, body),
    });

    if (error) {
      logEmailError('sendPasswordReset', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  }

  /**
   * Envía email de bienvenida al registrarse.
   */
  async sendWelcome(to: string, name: string, frontendUrl?: string): Promise<EmailResult> {
    const BASE = frontendUrl ?? DEFAULT_FRONTEND_URL;
    const firstName = name.trim().split(' ')[0];
    const body = `
      <!-- Hero greeting -->
      <div style="text-align:center;margin-bottom:32px;">
        <div style="display:inline-block;width:72px;height:72px;background:#C8956C;border-radius:50%;line-height:72px;font-size:32px;margin-bottom:16px;">☕</div>
        <h2 style="margin:0 0 8px;color:#1A1A1A;font-size:22px;font-weight:700;font-family:Georgia,serif;">
          ¡Hola, ${firstName}!
        </h2>
        <p style="margin:0;color:#C8956C;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;">
          Bienvenido/a a la familia Sorbito
        </p>
      </div>

      <!-- Main message -->
      <p style="margin:0 0 20px;color:#1A1A1A;font-size:16px;line-height:1.7;">
        Nos alegra mucho tenerte aquí. Cada taza que creamos lleva consigo un pedazo
        de alma venezolana — arcilla, amor y café.
      </p>
      <p style="margin:0 0 32px;color:#6B6560;font-size:15px;line-height:1.7;">
        Tu cuenta está lista. Explora nuestras colecciones, encuentra la taza que cuenta
        <em>tu historia</em> y hazla tuya.
      </p>

      <!-- Feature highlights -->
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin-bottom:32px;">
        <tr>
          <td style="padding:16px;background:#F3EFE9;border-radius:10px;border-left:3px solid #C8956C;">
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #EDE8E3;">
                  <span style="color:#C8956C;font-size:15px;margin-right:10px;">✦</span>
                  <span style="color:#1A1A1A;font-size:14px;font-weight:600;">Colección Boscan</span>
                  <span style="color:#6B6560;font-size:13px;"> — Gafas y barba, carácter único</span>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #EDE8E3;">
                  <span style="color:#C8956C;font-size:15px;margin-right:10px;">✦</span>
                  <span style="color:#1A1A1A;font-size:14px;font-weight:600;">Colección La Moni</span>
                  <span style="color:#6B6560;font-size:13px;"> — Pestañas y labios rojos, elegancia</span>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;">
                  <span style="color:#C8956C;font-size:15px;margin-right:10px;">✦</span>
                  <span style="color:#1A1A1A;font-size:14px;font-weight:600;">Artesanal Rústica</span>
                  <span style="color:#6B6560;font-size:13px;"> — Cerámica con alma, hecha a mano</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- CTA buttons -->
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin-bottom:24px;">
        <tr>
          <td align="center" style="padding-bottom:12px;">
            <a href="${BASE}/tienda"
               style="display:inline-block;background:#C8956C;color:#ffffff;text-decoration:none;padding:15px 44px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.02em;">
              Explorar la tienda
            </a>
          </td>
        </tr>
        <tr>
          <td align="center">
            <a href="${BASE}/perfil"
               style="display:inline-block;background:transparent;color:#C8956C;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:600;border:1.5px solid #C8956C;">
              Ver mi cuenta
            </a>
          </td>
        </tr>
      </table>

      <!-- Sign-off -->
      <p style="margin:24px 0 0;color:#6B6560;font-size:14px;line-height:1.6;text-align:center;border-top:1px solid #EDE8E3;padding-top:20px;">
        Con mucho cariño,<br/>
        <strong style="color:#1A1A1A;">El equipo de Sorbito de Verdad</strong><br/>
        <span style="font-size:12px;color:#9B9590;">Tazas artesanales · Hecho en Venezuela 🇻🇪</span>
      </p>
    `;

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `¡Bienvenido/a a Sorbito de Verdad, ${firstName}! ☕`,
      html: baseTemplate('¡Te damos la bienvenida!', `${firstName}, tu cuenta en Sorbito de Verdad está lista. Explora nuestras tazas artesanales.`, body),
    });

    if (error) {
      logEmailError('sendWelcome', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  }

  /**
   * Envía confirmación de orden al cliente.
   */
  async sendOrderConfirmation(to: string, name: string, orderId: string, total: number): Promise<EmailResult> {
    const orderUrl = `${DEFAULT_FRONTEND_URL}/perfil`;
    const formattedTotal = new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' }).format(total);

    const body = `
      <p style="margin:0 0 16px;color:#1A1A1A;font-size:16px;line-height:1.6;">
        Hola <strong>${name}</strong>,
      </p>
      <p style="margin:0 0 20px;color:#6B6560;font-size:15px;line-height:1.7;">
        Recibimos tu pedido y ya estamos trabajando en él con mucho cariño.
      </p>
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
        style="background:#F3EFE9;border-radius:10px;margin-bottom:28px;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="margin:0 0 8px;color:#6B6560;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">Número de orden</p>
            <p style="margin:0 0 12px;color:#1A1A1A;font-size:15px;font-weight:600;font-family:monospace;">#${orderId.slice(-8).toUpperCase()}</p>
            <p style="margin:0 0 4px;color:#6B6560;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">Total</p>
            <p style="margin:0;color:#C8956C;font-size:18px;font-weight:700;">${formattedTotal}</p>
          </td>
        </tr>
      </table>
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation">
        <tr>
          <td align="center">
            <a href="${orderUrl}"
               style="display:inline-block;background:#1A1A1A;color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:15px;font-weight:600;">
              Ver mi pedido
            </a>
          </td>
        </tr>
      </table>
    `;

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `Pedido confirmado #${orderId.slice(-8).toUpperCase()} — Sorbito de Verdad`,
      html: baseTemplate('Pedido confirmado', `Tu pedido en Sorbito de Verdad ha sido recibido. Total: ${formattedTotal}`, body),
    });

    if (error) {
      logEmailError('sendOrderConfirmation', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  }
}

export const emailService = new EmailService();
