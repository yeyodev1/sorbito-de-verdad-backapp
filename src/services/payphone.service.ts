import axios from 'axios';

const PAYPHONE_BASE_URL = 'https://pay.payphonetodoesposible.com/api';
const PAYPHONE_TOKEN = process.env.PAYPHONE_TOKEN;
const PAYPHONE_STORE_ID = process.env.PAYPHONE_STORE_ID;

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
   * Prepara el pago con la Cajita de Pagos (button/Prepare).
   * Devuelve una URL de PayPhone a la que redirigir al usuario.
   */
  async prepareButton(params: {
    amount: number;
    amountWithoutTax: number;
    clientTransactionId: string;
    responseUrl: string;
    cancellationUrl: string;
    reference: string;
  }): Promise<PrepareButtonResult> {
    const response = await axios.post(
      `${PAYPHONE_BASE_URL}/button/Prepare`,
      {
        amount: params.amount,
        amountWithoutTax: params.amountWithoutTax,
        currency: 'USD',
        clientTransactionId: params.clientTransactionId,
        responseUrl: params.responseUrl,
        cancellationUrl: params.cancellationUrl,
        storeId: PAYPHONE_STORE_ID,
        reference: params.reference,
      },
      {
        headers: {
          Authorization: `Bearer ${PAYPHONE_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return { payWithPayPhone: response.data.payWithPayPhone };
  },

  /**
   * Confirma el resultado del pago (button/Confirm).
   */
  async confirmButton(id: number, clientTransactionId: string): Promise<ConfirmButtonResult> {
    const response = await axios.post(
      `${PAYPHONE_BASE_URL}/button/Confirm`,
      { id, clientTransactionId },
      {
        headers: {
          Authorization: `Bearer ${PAYPHONE_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const data = response.data;
    return {
      statusCode: data.statusCode,
      transactionStatus: data.transactionStatus,
      authorizationCode: data.authorizationCode,
      approved: data.transactionStatus === 'Approved',
    };
  },

  async verifySale(payphoneTransactionId: string): Promise<{ statusCode: number; transactionStatus: string; authorizationCode?: string }> {
    const response = await axios.get(
      `${PAYPHONE_BASE_URL}/Sale/${payphoneTransactionId}`,
      {
        headers: {
          Authorization: `Bearer ${PAYPHONE_TOKEN}`,
        },
      }
    );

    const { statusCode, transactionStatus, authorizationCode } = response.data;

    return { statusCode, transactionStatus, authorizationCode };
  },
};
