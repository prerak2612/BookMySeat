import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../src/common/errors.js';
import { PaymentMethod } from '../../src/domain/enums.js';
import { LegacyPayGatewayAdapter } from '../../src/payments/gateway/LegacyPayGatewayAdapter.js';
import { LegacyPaySdk } from '../../src/payments/gateway/LegacyPaySdk.js';
import { GatewayUnavailableError, type PaymentGateway } from '../../src/payments/gateway/PaymentGateway.js';
import { PaymentService } from '../../src/payments/PaymentService.js';
import { CardPaymentStrategy, UpiPaymentStrategy, WalletPaymentStrategy } from '../../src/payments/PaymentStrategies.js';
import { PaymentStrategyFactory } from '../../src/payments/PaymentStrategyFactory.js';

const gateway = () => new LegacyPayGatewayAdapter(new LegacyPaySdk(0));
const card = { cardNumber: '4111 1111 1111 1111', expiry: '12/30', cvv: '123', cardHolder: 'Asha' };

describe('LegacyPayGatewayAdapter (Adapter)', () => {
  it('converts rupees to paise and instrument types to SDK codes', async () => {
    const sdk = new LegacyPaySdk(0);
    const spy = vi.spyOn(sdk, 'makeTransaction');
    const result = await new LegacyPayGatewayAdapter(sdk).charge({ amount: 271.4, instrumentType: 'UPI', instrumentToken: 'a@ok', merchantReference: 'BMS-1' });
    expect(spy.mock.calls[0]![0]).toEqual({ amount_paise: 27140, instrument_type: 'UPI', instrument_token: 'a@ok', merchant_ref: 'BMS-1' });
    expect(result.approved).toBe(true);
    expect(result.transactionRef).toMatch(/^LP/);
  });

  it('maps decline codes to an unapproved result and SDK errors to GatewayUnavailableError', async () => {
    const g = gateway();
    expect((await g.charge({ amount: 10, instrumentType: 'WALLET', instrumentToken: 'empty-1', merchantReference: 'r' })).approved).toBe(false);
    await expect(g.charge({ amount: 10, instrumentType: 'CARD', instrumentToken: '4000000000009999', merchantReference: 'r' })).rejects.toBeInstanceOf(
      GatewayUnavailableError,
    );
  });

  it('refunds through the SDK reversal API', async () => {
    const r = await gateway().refund('LP123', 100);
    expect(r).toMatchObject({ approved: true, transactionRef: 'RF-LP123' });
  });
});

describe('Payment strategies (Strategy + Template Method)', () => {
  it('card: approves valid cards and masks the number', async () => {
    const r = await new CardPaymentStrategy(gateway()).pay({ amount: 100, bookingReference: 'B', details: card });
    expect(r).toMatchObject({ success: true, instrumentLabel: 'CARD **** 1111', failureReason: null, gateway: 'LEGACY_PAY' });
  });

  it('card: declined cards resolve (not reject) with a failure reason', async () => {
    const r = await new CardPaymentStrategy(gateway()).pay({ amount: 100, bookingReference: 'B', details: { ...card, cardNumber: '4000000000000002' } });
    expect(r.success).toBe(false);
    expect(r.failureReason).toMatch(/declined/i);
  });

  it('card: validates every field and rejects expired cards', async () => {
    const s = new CardPaymentStrategy(gateway());
    await expect(s.pay({ amount: 100, bookingReference: 'B', details: { cardNumber: '12', expiry: '1/2', cvv: 'x' } })).rejects.toMatchObject({
      details: ['cardNumber must be 16 digits', 'expiry must be MM/YY', 'cvv must be 3 digits', 'cardHolder is required'],
    });
    await expect(s.pay({ amount: 100, bookingReference: 'B', details: { ...card, expiry: '01/20' } })).rejects.toMatchObject({
      details: ['card has expired'],
    });
  });

  it('UPI and wallet validate their own formats', async () => {
    await expect(new UpiPaymentStrategy(gateway()).pay({ amount: 1, bookingReference: 'B', details: { upiId: 'nope' } })).rejects.toBeInstanceOf(ValidationError);
    await expect(new WalletPaymentStrategy(gateway()).pay({ amount: 1, bookingReference: 'B', details: { walletId: '!' } })).rejects.toBeInstanceOf(ValidationError);
    expect((await new UpiPaymentStrategy(gateway()).pay({ amount: 1, bookingReference: 'B', details: { upiId: 'fail@bank' } })).success).toBe(false);
    expect((await new WalletPaymentStrategy(gateway()).pay({ amount: 1, bookingReference: 'B', details: { walletId: 'wallet_9' } })).success).toBe(true);
  });

  it('rejects non-positive amounts', async () => {
    await expect(new UpiPaymentStrategy(gateway()).pay({ amount: 0, bookingReference: 'B', details: { upiId: 'a@ok' } })).rejects.toBeInstanceOf(ValidationError);
  });

  it('strategies are substitutable: same contract against any gateway (LSP/DIP)', async () => {
    const fake: PaymentGateway = {
      name: 'FAKE',
      charge: vi.fn().mockResolvedValue({ approved: true, transactionRef: 'F-1', message: 'ok' }),
      refund: vi.fn(),
    };
    const results = await Promise.all([
      new CardPaymentStrategy(fake).pay({ amount: 5, bookingReference: 'B', details: card }),
      new UpiPaymentStrategy(fake).pay({ amount: 5, bookingReference: 'B', details: { upiId: 'xy@ok' } }),
      new WalletPaymentStrategy(fake).pay({ amount: 5, bookingReference: 'B', details: { walletId: 'abc' } }),
    ]);
    expect(results.map((r) => [r.success, r.gateway, r.transactionRef])).toEqual([
      [true, 'FAKE', 'F-1'],
      [true, 'FAKE', 'F-1'],
      [true, 'FAKE', 'F-1'],
    ]);
  });
});

describe('PaymentStrategyFactory + PaymentService', () => {
  it('resolves registered strategies and rejects unknown methods', () => {
    const f = PaymentStrategyFactory.withDefaults(gateway());
    expect(f.supportedMethods()).toEqual([PaymentMethod.CARD, PaymentMethod.UPI, PaymentMethod.WALLET]);
    expect(f.get(PaymentMethod.UPI)).toBeInstanceOf(UpiPaymentStrategy);
    expect(() => new PaymentStrategyFactory().get(PaymentMethod.CARD)).toThrow(ValidationError);
  });

  it('PaymentService delegates to the chosen strategy', async () => {
    const service = new PaymentService(PaymentStrategyFactory.withDefaults(gateway()));
    expect((await service.charge(PaymentMethod.CARD, 50, 'BMS-X', card)).success).toBe(true);
    expect((await service.refund(PaymentMethod.CARD, 'LP1', 50)).success).toBe(true);
  });
});
