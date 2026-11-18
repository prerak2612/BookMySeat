import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Alert, Layout, RequireAuth } from './components/common';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AuthPage } from './pages/AuthPage';
import { BookingHistoryPage, ConfirmationPage } from './pages/BookingPages';
import { CheckoutPage } from './pages/CheckoutPage';
import { MovieDetailsPage } from './pages/MovieDetailsPage';
import { MoviesPage } from './pages/MoviesPage';
import { SeatSelectionPage } from './pages/SeatSelectionPage';
import { AuthProvider } from './state/AuthContext';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<MoviesPage />} />
            <Route path="login" element={<AuthPage mode="login" />} />
            <Route path="register" element={<AuthPage mode="register" />} />
            <Route path="movies/:id" element={<MovieDetailsPage />} />
            <Route path="shows/:id" element={<SeatSelectionPage />} />
            <Route path="checkout/:id" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
            <Route path="bookings" element={<RequireAuth><BookingHistoryPage /></RequireAuth>} />
            <Route path="bookings/:id/confirmation" element={<RequireAuth><ConfirmationPage /></RequireAuth>} />
            <Route path="admin" element={<RequireAuth admin><AdminDashboardPage /></RequireAuth>} />
            <Route path="*" element={<Alert kind="warning">Page not found.</Alert>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
