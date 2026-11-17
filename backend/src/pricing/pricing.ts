/**
 * Pricing module.
 *
 *  - Strategy  : SeatPricingStrategy decides the ticket price of one seat (category-based or flat).
 *  - Decorator : PriceCalculatorDecorator subclasses stack extra charges (weekend surcharge,
 *                convenience fee, tax) on top of the base calculator without modifying it.
 *  - Factory   : PriceCalculatorFactory assembles the chain from configuration.
 *
 * Adding a new charge (e.g. a festival discount) means adding one decorator class - no existing
 * class changes (Open/Closed Principle).
 */
import type { PriceLine } from '../domain/Booking.js';
import { SeatCategory } from '../domain/enums.js';
import type { Show } from '../domain/Show.js';
import { roundMoney } from '../common/money.js';

// ------------------------------------------------------------------ Strategy

export interface SeatPricingStrategy {
  readonly name: string;
  priceForSeat(category: SeatCategory, basePrice: number): number;
}

export class CategoryPricingStrategy implements SeatPricingStrategy {
  readonly name = 'CATEGORY';
  static readonly MULTIPLIERS: Record<SeatCategory, number> = {
    [SeatCategory.REGULAR]: 1,
    [SeatCategory.PREMIUM]: 1.5,
    [SeatCategory.RECLINER]: 2.2,
  };

  priceForSeat(category: SeatCategory, basePrice: number): number {
    return roundMoney(basePrice * CategoryPricingStrategy.MULTIPLIERS[category]);
  }
}

export class FlatPricingStrategy implements SeatPricingStrategy {
  readonly name = 'FLAT';
  priceForSeat(_category: SeatCategory, basePrice: number): number {
    return roundMoney(basePrice);
  }
}

// ------------------------------------------------------------------ Calculator + Decorators

export interface PricedSeatInput {
  showSeatId: number;
  label: string;
  category: SeatCategory;
}

export interface PricingContext {
  show: Show;
  seats: PricedSeatInput[];
}

export interface PriceQuote {
  seatPrices: (PricedSeatInput & { price: number })[];
  /** Sum of ticket prices (before fees and tax). */
  subtotal: number;
  lines: PriceLine[];
  total: number;
}

export interface PriceCalculator {
  calculate(context: PricingContext): PriceQuote;
}

export class BasePriceCalculator implements PriceCalculator {
  constructor(private readonly strategy: SeatPricingStrategy) {}

  calculate({ show, seats }: PricingContext): PriceQuote {
    const seatPrices = seats.map((s) => ({ ...s, price: this.strategy.priceForSeat(s.category, show.basePrice) }));
    const subtotal = roundMoney(seatPrices.reduce((sum, s) => sum + s.price, 0));
    return {
      seatPrices,
      subtotal,
      lines: [{ label: `Tickets (${seats.length})`, amount: subtotal }],
      total: subtotal,
    };
  }
}

/** Decorator base: wraps another calculator and may add a line to its quote. */
export abstract class PriceCalculatorDecorator implements PriceCalculator {
  constructor(protected readonly inner: PriceCalculator) {}

  calculate(context: PricingContext): PriceQuote {
    const quote = this.inner.calculate(context);
    const extra = this.extraCharge(quote, context);
    if (!extra || extra.amount === 0) return quote;
    const amount = roundMoney(extra.amount);
    return { ...quote, lines: [...quote.lines, { label: extra.label, amount }], total: roundMoney(quote.total + amount) };
  }

  protected abstract extraCharge(quote: PriceQuote, context: PricingContext): PriceLine | null;
}

export class WeekendSurchargeDecorator extends PriceCalculatorDecorator {
  constructor(
    inner: PriceCalculator,
    private readonly rate: number,
  ) {
    super(inner);
  }
  protected extraCharge(quote: PriceQuote, { show }: PricingContext): PriceLine | null {
    return show.isWeekend() ? { label: `Weekend surcharge (${Math.round(this.rate * 100)}%)`, amount: quote.subtotal * this.rate } : null;
  }
}

export class ConvenienceFeeDecorator extends PriceCalculatorDecorator {
  constructor(
    inner: PriceCalculator,
    private readonly feePerSeat: number,
  ) {
    super(inner);
  }
  protected extraCharge(_quote: PriceQuote, { seats }: PricingContext): PriceLine {
    return { label: 'Convenience fee', amount: this.feePerSeat * seats.length };
  }
}

export class TaxDecorator extends PriceCalculatorDecorator {
  constructor(
    inner: PriceCalculator,
    private readonly rate: number,
  ) {
    super(inner);
  }
  protected extraCharge(quote: PriceQuote): PriceLine {
    return { label: `GST (${Math.round(this.rate * 100)}%)`, amount: quote.total * this.rate };
  }
}

// ------------------------------------------------------------------ Factory

export interface PricingConfig {
  strategy: 'CATEGORY' | 'FLAT';
  weekendSurchargeRate: number;
  convenienceFeePerSeat: number;
  taxRate: number;
}

export class PriceCalculatorFactory {
  static createStrategy(name: PricingConfig['strategy']): SeatPricingStrategy {
    return name === 'FLAT' ? new FlatPricingStrategy() : new CategoryPricingStrategy();
  }

  /** Order matters: tax is applied last, on top of tickets + surcharge + fee. */
  static create(cfg: PricingConfig): { calculator: PriceCalculator; strategy: SeatPricingStrategy } {
    const strategy = PriceCalculatorFactory.createStrategy(cfg.strategy);
    let calculator: PriceCalculator = new BasePriceCalculator(strategy);
    if (cfg.weekendSurchargeRate > 0) calculator = new WeekendSurchargeDecorator(calculator, cfg.weekendSurchargeRate);
    if (cfg.convenienceFeePerSeat > 0) calculator = new ConvenienceFeeDecorator(calculator, cfg.convenienceFeePerSeat);
    if (cfg.taxRate > 0) calculator = new TaxDecorator(calculator, cfg.taxRate);
    return { calculator, strategy };
  }
}
