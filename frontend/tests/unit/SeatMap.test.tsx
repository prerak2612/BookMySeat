import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SeatMap, seatVisualState } from '../../src/components/SeatMap';
import { makeSeat, makeSeatMap } from './fixtures';

describe('SeatMap component', () => {
  const map = makeSeatMap([
    { row: 'A', statuses: ['AVAILABLE', 'LOCKED', 'BOOKED', 'AVAILABLE'] },
    { row: 'B', statuses: ['AVAILABLE', 'AVAILABLE'], category: 'PREMIUM' },
  ]);

  it('renders the four seat states distinguishably (class, data-state and aria-label)', () => {
    render(<SeatMap seatMap={map} selected={[map.rows[0]!.seats[3]!.seatId]} onSeatClick={() => {}} />);
    const state = (label: string) => screen.getByRole('button', { name: new RegExp(`^Seat ${label},`) }).getAttribute('data-state');
    expect(state('A1')).toBe('available');
    expect(state('A2')).toBe('locked');
    expect(state('A3')).toBe('booked');
    expect(state('A4')).toBe('selected');
    expect(screen.getByRole('button', { name: /^Seat A4,/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('disables locked and booked seats and reports clicks on free ones', () => {
    const onClick = vi.fn();
    render(<SeatMap seatMap={map} selected={[]} onSeatClick={onClick} />);
    expect(screen.getByRole('button', { name: /^Seat A2,/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Seat A3,/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Seat A1,/ }));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ label: 'A1' }));
  });

  it('groups rows into category sections with prices and shows legend counts', () => {
    render(<SeatMap seatMap={map} selected={[map.rows[0]!.seats[0]!.seatId]} onSeatClick={() => {}} />);
    expect(screen.getByText('Regular · ₹200')).toBeInTheDocument();
    expect(screen.getByText('Premium · ₹300')).toBeInTheDocument();
    expect(screen.getByTestId('legend-available')).toHaveTextContent('3'); // 4 free - 1 selected
    expect(screen.getByTestId('legend-selected')).toHaveTextContent('1');
    expect(screen.getByTestId('legend-locked')).toHaveTextContent('1');
    expect(screen.getByTestId('legend-booked')).toHaveTextContent('1');
  });

  it('disables every seat while a hold request is in flight', () => {
    render(<SeatMap seatMap={map} selected={[]} onSeatClick={() => {}} disabled />);
    expect(screen.getByRole('button', { name: /^Seat A1,/ })).toBeDisabled();
  });

  it('seatVisualState: server status wins over local selection', () => {
    const taken = makeSeat('A', 1, 'LOCKED');
    expect(seatVisualState(taken, new Set([taken.seatId]))).toBe('locked');
  });
});
