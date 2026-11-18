import { ValidationError } from '../common/errors.js';
import { PaymentMethod } from '../domain/enums.js';
import type { PaymentGateway } from './gateway/PaymentGateway.js';
import {
  CardPaymentStrategy,
  UpiPaymentStrategy,
  WalletPaymentStrategy,
  type PaymentProcessor,
  type RefundProcessor,
} from './PaymentStrategies.js';

export type PaymentStrategy = PaymentProcessor & RefundProcessor;

/**
 * Factory + registry for payment strategies. New methods are added by `register()`-ing another
 * strategy - PaymentService and BookingService never change (Open/Closed).
 */
export class PaymentStrategyFactory {
  private readonly strategies = new Map<PaymentMethod, PaymentStrategy>();

  register(strategy: PaymentStrategy): this {
    this.strategies.set(strategy.method, strategy);
    return this;
  }

  get(method: PaymentMethod): PaymentStrategy {
    const strategy = this.strategies.get(method);
    if (!strategy) throw new ValidationError(`Unsupported payment method: ${method}`);
    return strategy;
  }

  supportedMethods(): PaymentMethod[] {
    return [...this.strategies.keys()];
  }

  /** Default wiring: every built-in method routed through the same gateway. */
  static withDefaults(gateway: PaymentGateway): PaymentStrategyFactory {
    return new PaymentStrategyFactory()
      .register(new CardPaymentStrategy(gateway))
      .register(new UpiPaymentStrategy(gateway))
      .register(new WalletPaymentStrategy(gateway));
  }
}
