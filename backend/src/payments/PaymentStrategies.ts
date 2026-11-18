/**
 * Payment strategies.
 *
 *  - Strategy        : CARD / UPI / WALLET are interchangeable PaymentProcessor implementations.
 *  - Template Method : BasePaymentStrategy.pay() fixes the algorithm (validate -> tokenise ->
 *                      charge -> map result); subclasses supply only the method-specific steps.
 *  - ISP             : charging (PaymentProcessor) and refunding (RefundProcessor) are separate
 *                      interfaces; a pay-only method could implement just the first.
 *  - LSP             : every strategy honours the same contract - it resolves to a PaymentResult
 *                      for declines and only rejects for infrastructure failures.
 */
import { ValidationError } from '../common/errors.js';
import { PaymentMethod } from '../domain/enums.js';
import type { InstrumentType, PaymentGateway } from './gateway/PaymentGateway.js';

export type PaymentDetails = Record<string, string | undefined>;

export interface PaymentRequest {
  amount: number;
  bookingReference: string;
  details: PaymentDetails;
}

export interface PaymentResult {
  success: boolean;
  gateway: string;
  transactionRef: string | null;
  failureReason: string | null;
  /** Masked instrument for receipts, e.g. "VISA **** 4242" or "ravi@okbank". */
  instrumentLabel: string;
}

export interface PaymentProcessor {
  readonly method: PaymentMethod;
  pay(request: PaymentRequest): Promise<PaymentResult>;
}

export interface RefundProcessor {
  refund(transactionRef: string, amount: number): Promise<{ success: boolean; reference: string | null; message: string }>;
}

export abstract class BasePaymentStrategy implements PaymentProcessor, RefundProcessor {
  abstract readonly method: PaymentMethod;
  protected abstract readonly instrumentType: InstrumentType;

  constructor(protected readonly gateway: PaymentGateway) {}

  /** Template method - the fixed skeleton of every payment. */
  async pay(request: PaymentRequest): Promise<PaymentResult> {
    if (!(request.amount > 0)) throw new ValidationError('Payment amount must be positive');
    const problems = this.validate(request.details);
    if (problems.length > 0) throw new ValidationError(`Invalid ${this.method} payment details`, problems);

    const token = this.tokenise(request.details);
    const result = await this.gateway.charge({
      amount: request.amount,
      instrumentType: this.instrumentType,
      instrumentToken: token,
      merchantReference: request.bookingReference,
    });
    return {
      success: result.approved,
      gateway: this.gateway.name,
      transactionRef: result.transactionRef,
      failureReason: result.approved ? null : result.message,
      instrumentLabel: this.mask(request.details),
    };
  }

  async refund(transactionRef: string, amount: number) {
    const result = await this.gateway.refund(transactionRef, amount);
    return { success: result.approved, reference: result.transactionRef, message: result.message };
  }

  /** Returns a list of human-readable validation problems (empty = valid). */
  protected abstract validate(details: PaymentDetails): string[];
  protected abstract tokenise(details: PaymentDetails): string;
  protected abstract mask(details: PaymentDetails): string;
}

export class CardPaymentStrategy extends BasePaymentStrategy {
  readonly method = PaymentMethod.CARD;
  protected readonly instrumentType = 'CARD' as const;

  protected validate(d: PaymentDetails): string[] {
    const problems: string[] = [];
    const number = (d.cardNumber ?? '').replace(/\s+/g, '');
    if (!/^\d{16}$/.test(number)) problems.push('cardNumber must be 16 digits');
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(d.expiry ?? '')) problems.push('expiry must be MM/YY');
    else if (CardPaymentStrategy.isExpired(d.expiry!)) problems.push('card has expired');
    if (!/^\d{3}$/.test(d.cvv ?? '')) problems.push('cvv must be 3 digits');
    if (!d.cardHolder || d.cardHolder.trim().length < 2) problems.push('cardHolder is required');
    return problems;
  }

  protected tokenise(d: PaymentDetails): string {
    return (d.cardNumber ?? '').replace(/\s+/g, '');
  }

  protected mask(d: PaymentDetails): string {
    return `CARD **** ${this.tokenise(d).slice(-4)}`;
  }

  private static isExpired(expiry: string): boolean {
    const [mm, yy] = expiry.split('/').map(Number) as [number, number];
    const endOfMonth = new Date(2000 + yy, mm, 1); // first day of the following month
    return endOfMonth.getTime() <= Date.now();
  }
}

export class UpiPaymentStrategy extends BasePaymentStrategy {
  readonly method = PaymentMethod.UPI;
  protected readonly instrumentType = 'UPI' as const;

  protected validate(d: PaymentDetails): string[] {
    return /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$/.test(d.upiId ?? '') ? [] : ['upiId must look like name@bank'];
  }
  protected tokenise(d: PaymentDetails): string {
    return d.upiId!.toLowerCase();
  }
  protected mask(d: PaymentDetails): string {
    return `UPI ${d.upiId}`;
  }
}

export class WalletPaymentStrategy extends BasePaymentStrategy {
  readonly method = PaymentMethod.WALLET;
  protected readonly instrumentType = 'WALLET' as const;

  protected validate(d: PaymentDetails): string[] {
    return /^[a-zA-Z0-9_-]{3,40}$/.test(d.walletId ?? '') ? [] : ['walletId must be 3-40 letters, digits, _ or -'];
  }
  protected tokenise(d: PaymentDetails): string {
    return d.walletId!;
  }
  protected mask(d: PaymentDetails): string {
    return `WALLET ${d.walletId}`;
  }
}
