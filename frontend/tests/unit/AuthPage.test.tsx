import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api/httpClient';

const login = vi.fn();
const register = vi.fn();
vi.mock('../../src/state/AuthContext', () => ({ useAuth: () => ({ login, register, user: null, ready: true, logout: vi.fn() }) }));

const { AuthPage } = await import('../../src/pages/AuthPage');

describe('AuthPage (UI validation + error handling)', () => {
  it('validates registration input before calling the API', async () => {
    render(<MemoryRouter><AuthPage mode="register" /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'nope');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Name must be at least 2 characters')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('At least 8 characters with a letter and a digit')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('shows the server error message when login fails', async () => {
    login.mockRejectedValueOnce(new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password'));
    render(<MemoryRouter><AuthPage mode="login" /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(login).toHaveBeenCalledWith('a@b.co', 'whatever1');
  });
});
