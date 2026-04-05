import axios from 'axios';

const PAYPHONE_BASE_URL = 'https://pay.payphonetodoesposible.com/api';
const PAYPHONE_TOKEN = process.env.PAYPHONE_TOKEN;
const PAYPHONE_STORE_ID = process.env.PAYPHONE_STORE_ID;

interface PrepareButtonParams {
  amount: number;
  amountWithoutTax: number;
  clientTransactionId: string;
  responseUrl: string;
}

interface PrepareButtonResult {
  payWithCard: string;
}

interface VerifySaleResult {
  statusCode: number;
  transactionStatus: string;
  authorizationCode?: string;
}

export const payphoneService = {
  async prepareButton(params: PrepareButtonParams): Promise<PrepareButtonResult> {
    const { amount, amountWithoutTax, clientTransactionId, responseUrl } = params;
    const response = await axios.post(
      `${PAYPHONE_BASE_URL}/button/Prepare`,
      {
        amount,
        amountWithoutTax,
        tax: amount - amountWithoutTax,
        clientTransactionId,
        responseUrl,
        storeId: PAYPHONE_STORE_ID,
        currency: 'USD',
      },
      {
        headers: {
          Authorization: `Bearer ${PAYPHONE_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return { payWithCard: response.data.payWithCard };
  },

  async verifySale(payphoneTransactionId: string): Promise<VerifySaleResult> {
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
