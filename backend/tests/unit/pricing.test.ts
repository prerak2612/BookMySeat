import { describe, expect, it } from 'vitest';
import { SeatCategory, ShowStatus } from '../../src/domain/enums.js';
import { Show } from '../../src/domain/Show.js';
import {
  BasePriceCalculator,
  CategoryPricingStrategy,
  ConvenienceFeeDecorator,
  FlatPricingStrategy,
  PriceCalculatorFactory,
  TaxDecorator,
  WeekendSurchargeDecorator,
} from '../../src/pricing/pricing.js';

const makeShow = (iso: string) =>
  new Show({ id: 1, movieId: 1, screenId: 1, startTime: new Date(iso), endTime: new Date(new Date(iso).getTime() + 3_600_000), basePrice: 200, status: ShowStatus.SCHEDULED });

const weekday = makeShow('2026-12-02T14:00:00'); // Wednesday (local time)
const saturday = makeShow('2026-12-05T14:00:00');
const seats = [
  { showSeatId: 1, label: 'A1', category: SeatCategory.REGULAR },
  { showSeatId: 2, label: 'F1', category: SeatCategory.PREMIUM },
  { showSeatId: 3, label: 'H1', category: SeatCategory.RECLINER },
];

describe('Seat pricing strategies', () => {
  it('category strategy applies multipliers', () => {
    const s = new CategoryPricingStrategy();
    expect(s.priceForSeat(SeatCategory.REGULAR, 200)).toBe(200);
    expect(s.priceForSeat(SeatCategory.PREMIUM, 200)).toBe(300);
    expect(s.priceForSeat(SeatCategory.RECLINER, 200)).toBe(440);
  });

  it('flat strategy ignores the category (interchangeable - LSP)', () => {
    const s = new FlatPricingStrategy();
    expect(Object.values(SeatCategory).map((c) => s.priceForSeat(c, 250))).toEqual([250, 250, 250]);
  });
});

describe('Price calculator decorators', () => {
  it('base calculator sums ticket prices', () => {
    const q = new BasePriceCalculator(new CategoryPricingStrategy()).calculate({ show: weekday, seats });
    expect(q.subtotal).toBe(940);
    expect(q.total).toBe(940);
    expect(q.seatPrices.map((s) => s.price)).toEqual([200, 300, 440]);
  });

  it('decorators stack charges in order without changing the base calculator', () => {
    const calc = new TaxDecorator(new ConvenienceFeeDecorator(new BasePriceCalculator(new FlatPricingStrategy()), 30), 0.18);
    const q = calc.calculate({ show: weekday, seats: seats.slice(0, 2) });
    // 400 + 60 fee = 460; +18% = 542.8
    expect(q.lines.map((l) => l.label)).toEqual(['Tickets (2)', 'Convenience fee', 'GST (18%)']);
    expect(q.total).toBe(542.8);
    expect(q.subtotal).toBe(400);
  });

  it('weekend surcharge only applies on Saturday/Sunday', () => {
    const calc = new WeekendSurchargeDecorator(new BasePriceCalculator(new FlatPricingStrategy()), 0.1);
    expect(calc.calculate({ show: weekday, seats: seats.slice(0, 1) }).total).toBe(200);
    expect(calc.calculate({ show: saturday, seats: seats.slice(0, 1) }).total).toBe(220);
  });

  it('factory builds the configured chain', () => {
    const { calculator, strategy } = PriceCalculatorFactory.create({ strategy: 'CATEGORY', weekendSurchargeRate: 0.1, convenienceFeePerSeat: 30, taxRate: 0.18 });
    expect(strategy.name).toBe('CATEGORY');
    const q = calculator.calculate({ show: saturday, seats: seats.slice(0, 1) });
    // 200 + 20 weekend + 30 fee = 250; +18% = 295
    expect(q.total).toBe(295);
    const plain = PriceCalculatorFactory.create({ strategy: 'FLAT', weekendSurchargeRate: 0, convenienceFeePerSeat: 0, taxRate: 0 });
    expect(plain.calculator).toBeInstanceOf(BasePriceCalculator);
  });
});
