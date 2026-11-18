import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { describeError } from '../api/httpClient';
import { Alert } from '../components/common';
import { useAuth } from '../state/AuthContext';

/** Login and registration share one form component; `mode` switches the behaviour. */
export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const validate = () => {
    const e: Record<string, string> = {};
    if (mode === 'register' && form.name.trim().length < 2) e.name = 'Name must be at least 2 characters';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Enter a valid email address';
    if (mode === 'register' && !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(form.password)) e.password = 'At least 8 characters with a letter and a digit';
    if (mode === 'login' && !form.password) e.password = 'Password is required';
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    setServerError(null);
    if (Object.keys(e).length) return;
    setSubmitting(true);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
      navigate(from, { replace: true });
    } catch (err) {
      setServerError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const field = (name: keyof typeof form, label: string, type = 'text', autoComplete?: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={form[name]}
        aria-invalid={!!errors[name]}
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      />
      {errors[name] && <small className="field-error">{errors[name]}</small>}
    </label>
  );

  return (
    <div className="auth-card card">
      <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
      <form onSubmit={submit} noValidate>
        {mode === 'register' && field('name', 'Full name', 'text', 'name')}
        {field('email', 'Email', 'email', 'email')}
        {field('password', 'Password', 'password', mode === 'login' ? 'current-password' : 'new-password')}
        {serverError && <Alert kind="error">{serverError}</Alert>}
        <button className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <p className="muted center">
        {mode === 'login' ? (
          <>
            New here? <Link to="/register">Create an account</Link>
          </>
        ) : (
          <>
            Already registered? <Link to="/login">Sign in</Link>
          </>
        )}
      </p>
      {mode === 'login' && (
        <p className="muted small center">Demo: alice@example.com / Password1 · admin@bookmyseat.dev / Admin@123</p>
      )}
    </div>
  );
}
