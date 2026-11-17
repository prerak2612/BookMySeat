import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, ChevronDown, Clock3, MapPin, Menu, Search, Star, Ticket, X } from 'lucide-react';
import { api, type ApiMovie, type ApiSeat, type ApiShow } from './api';
import './styles.css';

type Movie = { id: number; title: string; genre: string; language: string; duration: string; rating: string; color: string; art: string };

const demoMovies: Movie[] = [
  { id: 1, title: 'The Last Monsoon', genre: 'Drama · Romance', language: 'Hindi', duration: '2h 28m', rating: '8.7', color: '#264b72', art: '☂︎' },
  { id: 2, title: 'Orbitfall', genre: 'Sci-Fi · Adventure', language: 'English', duration: '2h 42m', rating: '8.4', color: '#281d59', art: '◉' },
  { id: 3, title: 'Masala Mayhem', genre: 'Comedy · Family', language: 'Hindi', duration: '2h 11m', rating: '8.1', color: '#b44925', art: '✹' },
  { id: 4, title: 'Shadow Protocol', genre: 'Action · Thriller', language: 'English', duration: '2h 19m', rating: '7.9', color: '#18242c', art: '◈' },
  { id: 5, title: 'Kaveri', genre: 'Drama · Musical', language: 'Kannada', duration: '2h 04m', rating: '8.5', color: '#276253', art: '⌁' },
  { id: 6, title: 'Pixel Paws', genre: 'Animation · Family', language: 'English', duration: '1h 38m', rating: '8.2', color: '#7a4382', art: '◒' },
];

const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const taken = new Set(['A3','A4','B7','C5','C6','D2','D3','D10','E9','F1','F2','F11','G6','G7','H4']);

function App() {
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('Bengaluru');
  const [catalog, setCatalog] = useState<Movie[]>(demoMovies);
  const [cities, setCities] = useState<string[]>(['Bengaluru', 'Mumbai']);
  const [connected, setConnected] = useState(false);
  const [activeMovie, setActiveMovie] = useState<Movie | null>(null);
  const [seatOpen, setSeatOpen] = useState(false);
  const [seatShowId, setSeatShowId] = useState<number | undefined>();
  const [selected, setSelected] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    Promise.all([api.movies(), api.cities()]).then(([liveMovies, liveCities]) => {
      setCatalog(liveMovies.map(toMovie));
      setCities(liveCities);
      if (liveCities.length && !liveCities.includes(city)) setCity(liveCities[0]!);
      setConnected(true);
    }).catch(() => setConnected(false));
  }, []);
  const shown = useMemo(() => catalog.filter((m) => m.title.toLowerCase().includes(search.toLowerCase()) || m.genre.toLowerCase().includes(search.toLowerCase())), [catalog, search]);
  const selectMovie = (movie: Movie) => { setActiveMovie(movie); setSeatOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const toggleSeat = (seat: string) => setSelected((current) => current.includes(seat) ? current.filter((s) => s !== seat) : [...current, seat]);

  return <>
    <header className="topbar">
      <a className="brand" href="#home"><span>book</span>myseat</a>
      <div className="search"><Search size={18}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search for movies, events and more" /></div>
      <div className="top-actions"><button className="city" onClick={() => setCity(cities[(cities.indexOf(city) + 1) % cities.length] ?? city)}><MapPin size={16}/>{city}<ChevronDown size={14}/></button><span className={connected ? 'api-status online' : 'api-status'}>{connected ? 'Live' : 'Preview'}</span><button className="signin">Sign in</button><button className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)}><Menu size={21}/></button></div>
    </header>
    <nav className={menuOpen ? 'nav open' : 'nav'}><div><a href="#movies">Movies</a><a href="#experiences">Experiences</a><a href="#offers">Offers</a></div><div><a href="#list">List your show</a><a href="#corporates">Corporates</a></div></nav>

    {!activeMovie ? <main id="home">
      <section className="hero">
        <div className="hero-content"><p className="eyebrow">NOW PLAYING</p><h1>Stories worth<br/><em>leaving home for.</em></h1><p>Find your next big-screen moment. Great seats, no fuss.</p><button className="primary" onClick={() => document.getElementById('movies')?.scrollIntoView({ behavior: 'smooth' })}>Explore movies <span>→</span></button></div>
        <div className="hero-orbit"><div className="ring ring-one"/><div className="ring ring-two"/><div className="hero-poster"><small>THE</small><b>LAST<br/>MONSOON</b><i>☂︎</i><small>A film by R. Nayar</small></div><span className="hero-glow"/></div>
      </section>
      <section className="quick-strip"><div><CalendarDays/><span><b>Pick a date</b><small>Today, 17 Nov</small></span></div><div><MapPin/><span><b>Choose a cinema</b><small>Near {city}</small></span></div><div><Ticket/><span><b>Book with confidence</b><small>Instant confirmation</small></span></div></section>
      <section className="movies-section" id="movies"><div className="section-head"><div><p className="eyebrow coral">WHAT'S SHOWING</p><h2>Popular in {city}</h2></div><button className="text-button">View all <span>→</span></button></div>
        <div className="movie-grid">{shown.map((movie) => <MovieCard movie={movie} key={movie.id} onClick={() => selectMovie(movie)}/>)}</div>
      </section>
      <section className="experiences" id="experiences"><div><p className="eyebrow">MAKE A DAY OF IT</p><h2>More than a movie.</h2><p>Comedy nights, concerts and spectacular experiences — all in one place.</p><button className="outline">Explore experiences</button></div><div className="experience-tile"><span>LIVE</span><b>Friday<br/>after dark</b><small>Discover what’s on</small></div></section>
    </main> : <MovieDetail movie={activeMovie} city={city} onBack={() => setActiveMovie(null)} onBook={(showId) => { setSeatShowId(showId); setSeatOpen(true); }} />}

    {seatOpen && activeMovie && <SeatPicker movie={activeMovie} showId={seatShowId} selected={selected} toggle={toggleSeat} close={() => setSeatOpen(false)} />}
    <footer><a className="brand"><span>book</span>myseat</a><p>Made for your next great night out.</p><div>© 2026 BookMySeat · <a href="#">Terms</a> · <a href="#">Privacy</a></div></footer>
  </>;
}

function toMovie(movie: ApiMovie, index: number): Movie {
  const template = demoMovies[index % demoMovies.length]!;
  return { id: movie.id, title: movie.title, genre: movie.genre, language: movie.language, duration: `${Math.floor(movie.durationMinutes / 60)}h ${movie.durationMinutes % 60}m`, rating: template.rating, color: template.color, art: template.art };
}

function MovieCard({ movie, onClick }: { movie: Movie; onClick: () => void }) { return <article className="movie-card" onClick={onClick}><div className="poster" style={{background: `linear-gradient(145deg, ${movie.color}, #10121a)`}}><span className="poster-art">{movie.art}</span><div className="poster-title">{movie.title}</div><div className="poster-fade"/></div><div className="movie-info"><h3>{movie.title}</h3><p><Star size={14} fill="currentColor"/> {movie.rating} &nbsp;·&nbsp; {movie.language}</p><small>{movie.genre}</small></div></article> }

function MovieDetail({ movie, city, onBack, onBook }: { movie: Movie; city: string; onBack: () => void; onBook: (showId?: number) => void }) {
  const [shows, setShows] = useState<ApiShow[]>([]);
  useEffect(() => { api.shows(movie.id, city).then(setShows).catch(() => setShows([])); }, [movie.id, city]);
  const grouped = shows.reduce<Record<string, ApiShow[]>>((all, show) => ({ ...all, [show.theatreName]: [...(all[show.theatreName] ?? []), show] }), {});
  return <main className="detail"><button className="back" onClick={onBack}>← Back to movies</button><section className="detail-hero"><div className="detail-poster poster" style={{background: `linear-gradient(145deg, ${movie.color}, #10121a)`}}><span className="poster-art">{movie.art}</span><div className="poster-title">{movie.title}</div></div><div><p className="eyebrow coral">IN CINEMAS NOW</p><h1>{movie.title}</h1><div className="metadata"><span><Star size={17} fill="currentColor"/> {movie.rating}/10</span><span>{movie.duration}</span><span>{movie.language}</span><span>UA 13+</span></div><p className="description">A sweeping, emotional journey that stays with you long after the credits roll. Experience the story on the biggest screen near you.</p><p className="chips"><b>{movie.genre.split(' · ')[0]}</b><b>{movie.genre.split(' · ')[1]}</b></p></div></section><section className="showtimes"><div className="section-head"><div><p className="eyebrow coral">BOOK YOUR SHOW</p><h2>Showtimes in {city}</h2></div><div className="date-pills"><button className="active">TODAY<br/><b>SHOWS</b></button></div></div>{Object.entries(grouped).length ? Object.entries(grouped).map(([theatre, theatreShows]) => <div className="theatre" key={theatre}><div><h3>{theatre}</h3><p><span className="dot"/> M-Ticket &nbsp; · &nbsp; {theatreShows[0]?.availableSeats} seats available</p></div><div className="times">{theatreShows.map((show) => <button onClick={() => onBook(show.id)} key={show.id}>{new Date(show.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}<small>₹{show.basePrice}</small></button>)}</div></div>) : <div className="empty-state">No live shows found for this movie in {city}. Start the backend and seed the database to book live inventory.</div>}</section></main> }

function SeatPicker({ movie, showId, selected, toggle, close }: { movie: Movie; showId?: number; selected: string[]; toggle: (seat: string) => void; close: () => void }) {
  const [liveSeats, setLiveSeats] = useState<ApiSeat[]>([]);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('alice@example.com');
  const [password, setPassword] = useState('Password1');
  useEffect(() => { if (showId) api.seats(showId).then((map) => setLiveSeats(map.rows.flatMap((row) => row.seats))).catch(() => setMessage('Could not load live seat inventory. You are viewing preview seats.')); }, [showId]);
  const live = liveSeats.length > 0;
  const seatRows = live ? liveSeats.reduce<Record<string, ApiSeat[]>>((all, seat) => ({ ...all, [seat.row]: [...(all[seat.row] ?? []), seat] }), {}) : Object.fromEntries(rows.map((row) => [row, Array.from({ length: 12 }, (_, n) => ({ label: `${row}${n + 1}`, number: n + 1, showSeatId: 0, status: taken.has(`${row}${n + 1}`) ? 'BOOKED' : 'AVAILABLE', price: 220 }))]));
  const selectedSeats = liveSeats.filter((seat) => selected.includes(seat.label));
  const total = live ? selectedSeats.reduce((sum, seat) => sum + seat.price, 0) : selected.length * 220;
  const hold = async () => {
    if (!showId || !live) { setMessage('Preview mode: start the backend and select a live show to create a booking.'); return; }
    try {
      let token = localStorage.getItem('bookmyseat-token');
      if (!token) { const session = await api.login(email, password); token = session.token; localStorage.setItem('bookmyseat-token', token); }
      const booking = await api.hold(showId, selectedSeats.map((seat) => seat.showSeatId), token);
      setMessage(`Seats held! Booking ${booking.reference} is reserved for ${Math.ceil(booking.holdSecondsRemaining / 60)} minutes.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not reserve these seats.'); }
  };
  return <div className="modal-wrap"><div className="seat-modal"><button className="close" onClick={close}><X/></button><div className="seat-head"><p className="eyebrow coral">{live ? 'LIVE INVENTORY' : 'PREVIEW INVENTORY'}</p><h2>{movie.title} <span>· Choose your seats</span></h2></div><div className="legend"><span><i className="available"/> Available</span><span><i className="chosen"/> Selected</span><span><i className="unavailable"/> Sold</span></div><div className="seat-layout">{Object.entries(seatRows).map(([row, seats]) => <div className="seat-row" key={row}><label>{row}</label>{seats.map((seat, index) => { const sold = seat.status !== 'AVAILABLE'; return <button aria-label={`Seat ${seat.label}`} key={seat.label} disabled={sold} onClick={() => toggle(seat.label)} className={`seat ${sold ? 'sold' : ''} ${selected.includes(seat.label) ? 'selected' : ''} ${(index === 3 || index === 7) ? 'gap' : ''}`}>{seat.number}</button> })}</div>)}</div><div className="screen">SCREEN THIS WAY</div>{message && <p className="booking-message">{message}</p>}<div className="booking-bar"><div><small>{selected.length ? selected.join(', ') : 'Select your seats'}</small><b>{selected.length ? `₹${total}` : ' '}</b></div><button disabled={!selected.length} className="primary" onClick={hold}>Reserve seats <span>→</span></button></div>{live && !localStorage.getItem('bookmyseat-token') && <div className="login-hint"><b>Demo sign-in</b><input aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} /><input aria-label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /><small>Your seat hold is created after you select Reserve seats.</small></div>}</div></div> }

createRoot(document.getElementById('root')!).render(<App />);
