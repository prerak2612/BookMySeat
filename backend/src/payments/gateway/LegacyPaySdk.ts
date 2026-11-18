/**
 * Simulated THIRD-PARTY payment SDK ("LegacyPay"). We pretend we cannot change this code: it uses
 * paise instead of rupees, short instrument codes, numeric response codes and Node-style callbacks.
 * LegacyPayGatewayAdapter converts it to our PaymentGateway interface.
 *
 * Deterministic simulation rules (documented in API_DOCUMENTATION.md):
 *   card token ending in 0002        -> '05' declined
 *   card token ending in 9999        -> '91' issuer/gateway unavailable (error callback)
 *   UPI handle starting with "fail"  -> '05' declined
 *   wallet id starting with "empty"  -> '51' insufficient funds
 *   everything else                  -> '00' approved
 */
export interface LegacyTxnPayload {
  amount_paise: number;
  instrument_type: 'CC' | 'UPI' | 'WLT';
  instrument_token: string;
  merchant_ref: string;
}

export interface LegacyTxnResponse {
  code: '00' | '05' | '51';
  txn_id?: string;
  message: string;
}

type Callback = (err: Error | null, response?: LegacyTxnResponse) => void;

export class LegacyPaySdk {
  private counter = 0;

  constructor(private readonly latencyMs = 15) {}

  makeTransaction(payload: LegacyTxnPayload, callback: Callback): void {
    setTimeout(() => {
      const token = payload.instrument_token.toLowerCase();
      if (payload.instrument_type === 'CC' && token.endsWith('9999')) {
        callback(new Error('91: issuer unavailable'));
        return;
      }
      if (payload.instrument_type === 'CC' && token.endsWith('0002')) {
        callback(null, { code: '05', message: 'Do not honour - card declined' });
        return;
      }
      if (payload.instrument_type === 'UPI' && token.startsWith('fail')) {
        callback(null, { code: '05', message: 'UPI request declined by payer bank' });
        return;
      }
      if (payload.instrument_type === 'WLT' && token.startsWith('empty')) {
        callback(null, { code: '51', message: 'Insufficient wallet balance' });
        return;
      }
      callback(null, { code: '00', txn_id: this.nextTxnId(), message: 'Approved' });
    }, this.latencyMs);
  }

  reverseTransaction(txnId: string, amountPaise: number, callback: Callback): void {
    setTimeout(() => {
      if (!txnId || amountPaise < 0) {
        callback(null, { code: '05', message: 'Reversal rejected' });
        return;
      }
      callback(null, { code: '00', txn_id: `RF-${txnId}`, message: 'Reversed' });
    }, this.latencyMs);
  }

  private nextTxnId(): string {
    this.counter += 1;
    return `LP${Date.now().toString(36).toUpperCase()}${this.counter.toString().padStart(4, '0')}`;
  }
}
