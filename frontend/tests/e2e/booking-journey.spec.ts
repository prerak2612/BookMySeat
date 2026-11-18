/**
 * End-to-end: real browser -> Vite -> Express -> PostgreSQL.
 * Each test registers fresh users so it can run repeatedly against the seeded database.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function registerAndLogin(page: Page, name = 'E2E User') {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(`e2e-${unique()}@test.dev`);
  await page.getByLabel('Password').fill('Password1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('current-user')).toHaveText(name);
}

/** Opens the first upcoming show of the first movie; returns the seat page URL. */
async function openFirstShow(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByTestId('movie-card').first().click();
  await page.getByTestId('showtime').first().click();
  await expect(page.getByLabel('Seat layout')).toBeVisible();
  return page.url();
}

/** Finds an available seat that is not adjacent to anything we care about. */
async function firstAvailableSeat(page: Page, skip = 0) {
  const seat = page.locator('button.seat[data-state="available"]').nth(skip);
  return (await seat.getAttribute('data-seat'))!;
}

test('complete journey: register -> browse -> select seats -> hold -> pay -> confirmation -> history -> cancel', async ({ page }) => {
  await registerAndLogin(page, 'Journey User');
  await openFirstShow(page);

  const a = await firstAvailableSeat(page, 0);
  const b = await firstAvailableSeat(page, 1);
  await page.locator(`button[data-seat="${a}"]`).click();
  await page.locator(`button[data-seat="${b}"]`).click();
  await expect(page.locator(`button[data-seat="${a}"]`)).toHaveAttribute('data-state', 'selected');
  await expect(page.getByTestId('legend-selected')).toHaveText('2');

  await page.getByRole('button', { name: /Hold 2 seats/ }).click();
  await expect(page.getByRole('heading', { name: 'Booking summary' })).toBeVisible();
  await expect(page.getByTestId('summary-seats')).toContainText(a);
  await expect(page.getByTestId('hold-countdown')).toBeVisible();

  // Client-side validation first, then a real (simulated) payment.
  await page.getByRole('button', { name: /^Pay/ }).click();
  await expect(page.getByText('Enter a 16-digit card number')).toBeVisible();
  await page.getByLabel('Card number').fill('4111111111111111');
  await page.getByLabel('Name on card').fill('Journey User');
  await page.getByLabel('Expiry (MM/YY)').fill('12/30');
  await page.getByLabel('CVV').fill('123');
  await page.getByRole('button', { name: /^Pay/ }).click();

  await expect(page.getByTestId('confirmation')).toBeVisible();
  await expect(page.getByTestId('booking-reference')).toHaveText(/^BMS-/);
  const reference = await page.getByTestId('booking-reference').textContent();

  await page.getByRole('link', { name: 'My bookings' }).first().click();
  const item = page.getByTestId('booking-item').filter({ hasText: reference! });
  await expect(item.getByText('Confirmed')).toBeVisible();
  await expect(page.getByText(`Booking confirmed - ${reference}`)).toBeVisible(); // Observer -> notification

  page.once('dialog', (d) => d.accept());
  await item.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(page.getByText(/cancelled\. Refund initiated/)).toBeVisible();
  await expect(item.getByText('Refunded')).toBeVisible();
});

test('seat conflict: two users pick the same seat - the loser sees a conflict and a refreshed map', async ({ browser }: { browser: Browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await registerAndLogin(alice, 'Alice Racer');
  await registerAndLogin(bob, 'Bob Racer');

  const url = await openFirstShow(alice);
  await bob.goto(url);
  await expect(bob.getByLabel('Seat layout')).toBeVisible();

  const seat = await firstAvailableSeat(alice, 5);
  // Both select the same seat while it is still available in both views.
  await alice.locator(`button[data-seat="${seat}"]`).click();
  await bob.locator(`button[data-seat="${seat}"]`).click();

  await alice.getByRole('button', { name: /Hold 1 seat/ }).click();
  await expect(alice.getByRole('heading', { name: 'Booking summary' })).toBeVisible();

  await bob.getByRole('button', { name: /Hold 1 seat/ }).click();
  await expect(bob.getByRole('alert')).toContainText('no longer available');
  // Map was refreshed from the server: the seat now shows as held by someone else.
  await expect(bob.locator(`button[data-seat="${seat}"]`)).toHaveAttribute('data-state', 'locked');
  await expect(bob.locator(`button[data-seat="${seat}"]`)).toBeDisabled();
});

test('declined payment releases the seats and offers to choose again', async ({ page }) => {
  await registerAndLogin(page, 'Declined User');
  await openFirstShow(page);
  const seat = await firstAvailableSeat(page, 9);
  await page.locator(`button[data-seat="${seat}"]`).click();
  await page.getByRole('button', { name: /Hold 1 seat/ }).click();

  await page.getByRole('tab', { name: 'UPI' }).click();
  await page.getByLabel('UPI ID').fill('fail@bank');
  await page.getByRole('button', { name: /^Pay/ }).click();
  await expect(page.getByRole('alert')).toContainText('Payment failed');
  await expect(page.getByText('Payment failed', { exact: true })).toBeVisible(); // status badge
  await page.getByRole('link', { name: 'Choose seats again' }).click();
  await expect(page.locator(`button[data-seat="${seat}"]`)).toHaveAttribute('data-state', 'available');
});

test('admin dashboard shows metrics and is protected from customers', async ({ page }) => {
  await registerAndLogin(page, 'Not An Admin');
  await page.goto('/admin');
  await expect(page.getByText('Administrator access required.')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@bookmyseat.dev');
  await page.getByLabel('Password').fill('Admin@123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Admin' }).click();
  await expect(page.locator('.stat').filter({ hasText: 'Revenue' }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Bookings' }).click();
  await expect(page.getByRole('columnheader', { name: 'Reference' })).toBeVisible();
});
