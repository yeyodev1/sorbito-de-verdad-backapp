import axios from 'axios';

const PAYPHONE_BASE_URL = 'https://pay.payphonetodoesposible.com/api';
const PAYPHONE_TOKEN = process.env.PAYPHONE_TOKEN;
const PAYPHONE_STORE_ID = process.env.PAYPHONE_STORE_ID;

interface ConfirmButtonResult {
  statusCode: number;
  transactionStatus: string;
  authorizationCode?: string;
  approved: boolean;
}

export const payphoneService = {
  /**
   * Confirma una transacción de la Cajita de Pagos (widget JS).
   * Se llama desde el backend después de que PayPhone redirige al usuario.
   */
  async confirmButtonV2(id: number, clientTxId: string): Promise<ConfirmButtonResult> {
    const response = await axios.post(
      `${PAYPHONE_BASE_URL}/button/V2/Confirm`,
      { id, clientTxId },
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
      approved: data.statusCode === 3,
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
