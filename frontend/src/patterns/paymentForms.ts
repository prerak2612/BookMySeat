/**
 * Payment-form strategies + factory. Each payment method describes its own fields, client-side
 * validation and how to build the `details` payload. The checkout page renders whichever
 * strategy the factory returns - adding a method means adding one object here.
 *
 * Client-side validation is for UX only; the backend strategies re-validate everything.
 */
import type { PaymentMethod } from '../api/types';

export interface FieldDef {
  name: string;
  label: string;
  placeholder: string;
  inputMode?: 'numeric' | 'text' | 'email';
  type?: 'text' | 'password';
  maxLength?: number;
}

export interface PaymentFormStrategy {
  readonly method: PaymentMethod;
  readonly label: string;
  readonly hint: string;
  readonly fields: FieldDef[];
  validate(values: Record<string, string>): Record<string, string>;
  toDetails(values: Record<string, string>): Record<string, string>;
}

const cardStrategy: PaymentFormStrategy = {
  method: 'CARD',
  label: 'Card',
  hint: 'Test cards: 4111 1111 1111 1111 succeeds, 4000 0000 0000 0002 is declined, 4000 0000 0000 9999 simulates a gateway outage.',
  fields: [
    { name: 'cardNumber', label: 'Card number', placeholder: '4111 1111 1111 1111', inputMode: 'numeric', maxLength: 19 },
    { name: 'cardHolder', label: 'Name on card', placeholder: 'A. Sharma' },
    { name: 'expiry', label: 'Expiry (MM/YY)', placeholder: '12/30', maxLength: 5 },
    { name: 'cvv', label: 'CVV', placeholder: '123', inputMode: 'numeric', type: 'password', maxLength: 3 },
  ],
  validate(v) {
    const e: Record<string, string> = {};
    if (!/^\d{16}$/.test((v.cardNumber ?? '').replace(/\s/g, ''))) e.cardNumber = 'Enter a 16-digit card number';
    if (!v.cardHolder || v.cardHolder.trim().length < 2) e.cardHolder = 'Enter the name on the card';
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(v.expiry ?? '')) e.expiry = 'Use MM/YY';
    if (!/^\d{3}$/.test(v.cvv ?? '')) e.cvv = '3 digits';
    return e;
  },
  toDetails: (v) => ({ cardNumber: (v.cardNumber ?? '').replace(/\s/g, ''), cardHolder: v.cardHolder?.trim() ?? '', expiry: v.expiry ?? '', cvv: v.cvv ?? '' }),
};

const upiStrategy: PaymentFormStrategy = {
  method: 'UPI',
  label: 'UPI',
  hint: 'Any handle like name@okbank succeeds; a handle starting with "fail" is declined.',
  fields: [{ name: 'upiId', label: 'UPI ID', placeholder: 'yourname@okbank', inputMode: 'email' }],
  validate: (v): Record<string, string> => (/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$/.test(v.upiId ?? '') ? {} : { upiId: 'Enter a UPI ID like name@bank' }),
  toDetails: (v) => ({ upiId: v.upiId?.trim() ?? '' }),
};

const walletStrategy: PaymentFormStrategy = {
  method: 'WALLET',
  label: 'Wallet',
  hint: 'Any wallet id succeeds; ids starting with "empty" fail with insufficient balance.',
  fields: [{ name: 'walletId', label: 'Wallet ID', placeholder: 'my-wallet' }],
  validate: (v): Record<string, string> => (/^[a-zA-Z0-9_-]{3,40}$/.test(v.walletId ?? '') ? {} : { walletId: '3-40 letters, digits, - or _' }),
  toDetails: (v) => ({ walletId: v.walletId?.trim() ?? '' }),
};

export class PaymentFormFactory {
  private static readonly registry = new Map<PaymentMethod, PaymentFormStrategy>(
    [cardStrategy, upiStrategy, walletStrategy].map((s) => [s.method, s]),
  );

  static get(method: PaymentMethod): PaymentFormStrategy {
    const s = PaymentFormFactory.registry.get(method);
    if (!s) throw new Error(`No payment form for ${method}`);
    return s;
  }

  static all(): PaymentFormStrategy[] {
    return [...PaymentFormFactory.registry.values()];
  }
}
