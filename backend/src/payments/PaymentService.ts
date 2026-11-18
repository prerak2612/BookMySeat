import { logger } from '../common/logger.js';
import type { PaymentMethod } from '../domain/enums.js';
import type { PaymentDetails, PaymentResult } from './PaymentStrategies.js';
import type { PaymentStrategyFactory } from './PaymentStrategyFactory.js';

/**
 * Facade over the payment strategies. BookingService depends on this class only and does not know
 * which concrete strategy or gateway is used (Dependency Inversion).
 */
export class PaymentService {
  constructor(private readonly factory: PaymentStrategyFactory) {}

  async charge(method: PaymentMethod, amount: number, bookingReference: string, details: PaymentDetails): Promise<PaymentResult> {
    const result = await this.factory.get(method).pay({ amount, bookingReference, details });
    logger.info('payment.processed', { bookingReference, method, success: result.success, ref: result.transactionRef });
    return result;
  }

  async refund(method: PaymentMethod, transactionRef: string, amount: number) {
    const result = await this.factory.get(method).refund(transactionRef, amount);
    logger.info('payment.refunded', { transactionRef, method, success: result.success });
    return result;
  }

  supportedMethods(): PaymentMethod[] {
    return this.factory.supportedMethods();
  }
}
