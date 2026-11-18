import { roundMoney } from '../../common/money.js';
import type { LegacyPaySdk, LegacyTxnPayload, LegacyTxnResponse } from './LegacyPaySdk.js';
import { GatewayUnavailableError, type GatewayChargeRequest, type GatewayResult, type InstrumentType, type PaymentGateway } from './PaymentGateway.js';

const INSTRUMENT_CODES: Record<InstrumentType, LegacyTxnPayload['instrument_type']> = {
  CARD: 'CC',
  UPI: 'UPI',
  WALLET: 'WLT',
};

/**
 * Adapter (structural pattern): makes the callback/paise based LegacyPaySdk look like our
 * promise/rupee based PaymentGateway, so no strategy or service ever sees the SDK's API.
 */
export class LegacyPayGatewayAdapter implements PaymentGateway {
  readonly name = 'LEGACY_PAY';

  constructor(private readonly sdk: LegacyPaySdk) {}

  charge(request: GatewayChargeRequest): Promise<GatewayResult> {
    const payload: LegacyTxnPayload = {
      amount_paise: Math.round(roundMoney(request.amount) * 100),
      instrument_type: INSTRUMENT_CODES[request.instrumentType],
      instrument_token: request.instrumentToken,
      merchant_ref: request.merchantReference,
    };
    return new Promise((resolve, reject) => {
      this.sdk.makeTransaction(payload, (err, response) => {
        if (err || !response) return reject(new GatewayUnavailableError(err?.message ?? 'No response from gateway'));
        resolve(LegacyPayGatewayAdapter.toResult(response));
      });
    });
  }

  refund(transactionRef: string, amount: number): Promise<GatewayResult> {
    return new Promise((resolve, reject) => {
      this.sdk.reverseTransaction(transactionRef, Math.round(amount * 100), (err, response) => {
        if (err || !response) return reject(new GatewayUnavailableError(err?.message ?? 'No response from gateway'));
        resolve(LegacyPayGatewayAdapter.toResult(response));
      });
    });
  }

  private static toResult(response: LegacyTxnResponse): GatewayResult {
    return { approved: response.code === '00', transactionRef: response.txn_id ?? null, message: response.message };
  }
}
