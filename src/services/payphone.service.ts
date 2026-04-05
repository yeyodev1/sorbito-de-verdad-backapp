import 'dotenv/config'
import axios, { AxiosError } from 'axios';

const PAYPHONE_BASE_URL = 'https://pay.payphonetodoesposible.com/api';

// Read at call time so Vercel env vars are available
function getToken() {
  const t = process.env.PAYPHONE_TOKEN;
  if (!t) throw new Error('PAYPHONE_TOKEN env var is not set');
  return t;
}
function getStoreId() {
  const s = process.env.PAYPHONE_STORE_ID;
  if (!s) throw new Error('PAYPHONE_STORE_ID env var is not set');
  return s;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${getToken()}`,
    'Content-Type': 'application/json',
  };
}

// Log PayPhone errors with full response body for debugging
function logPayPhoneError(context: string, error: unknown) {
  if (error instanceof AxiosError) {
    console.error(`[PayPhone] ${context} failed:`, {
      status: error.response?.status,
      data: JSON.stringify(error.response?.data),
      payload: JSON.stringify(error.config?.data),
    });
  } else {
    console.error(`[PayPhone] ${context} error:`, error);
  }
}

interface PrepareButtonResult {
  payWithPayPhone: string;
}

interface ConfirmButtonResult {
  statusCode: number;
  transactionStatus: string;
  authorizationCode?: string;
  approved: boolean;
}

export const payphoneService = {
  /**
   * Prepara el pago — devuelve URL de PayPhone donde redirigir al usuario.
   */
  async prepareButton(params: {
    amount: number;
    amountWithoutTax: number;
    clientTransactionId: string;
    responseUrl: string;
    cancellationUrl: string;
    reference: string;
  }): Promise<PrepareButtonResult> {
    const payload = {
      amount: params.amount,
      amountWithoutTax: params.amountWithoutTax,
      currency: 'USD',
      clientTransactionId: params.clientTransactionId,
      responseUrl: params.responseUrl,
      cancellationUrl: params.cancellationUrl,
      storeId: getStoreId(),
      reference: params.reference,
    };

    console.log('[PayPhone] button/Prepare payload:', JSON.stringify(payload));

    try {
      const response = await axios.post(
        `${PAYPHONE_BASE_URL}/button/Prepare`,
        payload,
        { headers: authHeaders() }
      );
      console.log('[PayPhone] button/Prepare response:', JSON.stringify(response.data));
      return { payWithPayPhone: response.data.payWithPayPhone };
    } catch (error) {
      logPayPhoneError('button/Prepare', error);
      throw error;
    }
  },

  /**
   * Confirma el resultado del pago (button/Confirm).
   */
  async confirmButton(id: number, clientTransactionId: string): Promise<ConfirmButtonResult> {
    const payload = { id, clientTransactionId };
    console.log('[PayPhone] button/Confirm payload:', JSON.stringify(payload));

    try {
      const response = await axios.post(
        `${PAYPHONE_BASE_URL}/button/Confirm`,
        payload,
        { headers: authHeaders() }
      );
      const data = response.data;
      console.log('[PayPhone] button/Confirm response:', JSON.stringify(data));
      return {
        statusCode: data.statusCode,
        transactionStatus: data.transactionStatus,
        authorizationCode: data.authorizationCode,
        approved: data.transactionStatus === 'Approved',
      };
    } catch (error) {
      logPayPhoneError('button/Confirm', error);
      throw error;
    }
  },

  async verifySale(payphoneTransactionId: string): Promise<{ statusCode: number; transactionStatus: string; authorizationCode?: string }> {
    const response = await axios.get(
      `${PAYPHONE_BASE_URL}/Sale/${payphoneTransactionId}`,
      { headers: authHeaders() }
    );
    const { statusCode, transactionStatus, authorizationCode } = response.data;
    return { statusCode, transactionStatus, authorizationCode };
  },
};
