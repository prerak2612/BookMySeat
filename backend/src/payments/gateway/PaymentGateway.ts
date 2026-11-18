/** Port that every payment strategy talks to. Concrete gateways are plugged in via adapters. */
export type InstrumentType = 'CARD' | 'UPI' | 'WALLET';

export interface GatewayChargeRequest {
  amount: number; // rupees
  instrumentType: InstrumentType;
  instrumentToken: string;
  merchantReference: string;
}

export interface GatewayResult {
  approved: boolean;
  transactionRef: string | null;
  message: string;
}

export interface PaymentGateway {
  readonly name: string;
  charge(request: GatewayChargeRequest): Promise<GatewayResult>;
  refund(transactionRef: string, amount: number): Promise<GatewayResult>;
}

/** Thrown when the gateway itself is unreachable - an infrastructure failure, not a decline. */
export class GatewayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayUnavailableError';
  }
}
