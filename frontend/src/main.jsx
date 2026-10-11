import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeSVG } from 'qrcode.react';
import libraryBooks from './library-books.svg';
import './styles.css';

const ReaderPdfDocument = React.lazy(() => import('./ReaderPdfDocument.jsx'));

const emptyBook = {
  title: '',
  author: '',
  isbn: '',
  category: '',
  description: '',
  publication_year: '',
  publisher: '',
  language: '',
  tags: [],
  is_featured: false,
  status: 'published',
  category_id: '',
  author_id: '',
};

async function resizeBookCover(file) {
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const type = file.type === 'image/png' ? 'image/webp' : file.type;
    let quality = 0.86;
    let blob;
    do {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
      if (!blob || blob.size <= 1024 * 1024 || quality <= 0.5) break;
      quality -= 0.12;
    } while (quality > 0.38);
    if (!blob) throw new Error('Could not resize this cover image. Choose another image and try again.');
    const outputType = blob.type || type;
    const extension = outputType === 'image/webp' ? 'webp' : outputType === 'image/png' ? 'png' : 'jpg';
    return new File([blob], `cover.${extension}`, { type: outputType });
  } finally {
    image.close();
  }
}

const categoryImages = {
  adventure: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=700&q=80',
  drama: 'https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=700&q=80',
  education: 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=700&q=80',
  fantasy: 'https://images.unsplash.com/photo-1532012197267-da84d127e765?auto=format&fit=crop&w=700&q=80',
  fiction: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=700&q=80',
  horror: 'https://images.unsplash.com/photo-1509248961158-e54f6934749c?auto=format&fit=crop&w=700&q=80',
  mathematics: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?auto=format&fit=crop&w=700&q=80',
  mystery: 'https://images.unsplash.com/photo-1495640388908-05fa85288e61?auto=format&fit=crop&w=700&q=80',
  psychology: 'https://images.unsplash.com/photo-1507413245164-6160d8298b31?auto=format&fit=crop&w=700&q=80',
  romance: 'https://images.unsplash.com/photo-1518199266791-5375a83190b7?auto=format&fit=crop&w=700&q=80',
  'science fiction': 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=700&q=80',
  technology: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=700&q=80',
  thriller: 'https://images.unsplash.com/photo-1528459105426-b9548367069b?auto=format&fit=crop&w=700&q=80',
};

function getBookImage(book) {
  if (book.cover_url) return book.cover_url;
  return categoryImages[book.category?.toLowerCase()] || 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=700&q=80';
}

function getSouthAfricanPublicHolidays(year) {
  const holidays = [
    ['01-01', "New Year's Day"], ['03-21', 'Human Rights Day'], ['04-27', 'Freedom Day'],
    ['05-01', "Workers' Day"], ['06-16', 'Youth Day'], ['08-09', "National Women's Day"],
    ['09-24', 'Heritage Day'], ['12-16', 'Day of Reconciliation'], ['12-25', 'Christmas Day'],
    ['12-26', 'Day of Goodwill'],
  ].map(([date, name]) => ({ date: `${year}-${date}`, name }));

  // Meeus/Jones/Butcher Gregorian Easter calculation; Easter determines Good Friday and Family Day.
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterMonth = Math.floor((h + l - 7 * m + 114) / 31);
  const easterDay = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, easterMonth - 1, easterDay));
  const isoDate = (date) => date.toISOString().slice(0, 10);
  const offsetDate = (days) => { const date = new Date(easter); date.setUTCDate(date.getUTCDate() + days); return isoDate(date); };
  holidays.push({ date: offsetDate(-2), name: 'Good Friday' }, { date: offsetDate(1), name: 'Family Day' });

  // Under the Public Holidays Act, a holiday falling on Sunday is observed on Monday.
  const sundayHolidays = holidays.filter(({ date }) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0);
  sundayHolidays.forEach(({ date, name }) => {
    const monday = new Date(`${date}T00:00:00Z`); monday.setUTCDate(monday.getUTCDate() + 1);
    holidays.push({ date: isoDate(monday), name: `${name} (observed)` });
  });

  // The President declared 4 November 2026 a public holiday for local government elections.
  if (year === 2026) holidays.push({ date: '2026-11-04', name: 'Local Government Elections' });
  return holidays.sort((left, right) => left.date.localeCompare(right.date));
}

async function request(path, options = {}, csrfToken = '') {
  let response;
  try {
    const { headers: extraHeaders = {}, ...fetchOptions } = options;
    response = await fetch(path, {
      ...fetchOptions,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
        ...extraHeaders,
      },
    });
  } catch {
    throw new Error('Cannot connect to the library service. Start the app with npm run dev and try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

function App() {
  const [csrfToken, setCsrfToken] = useState('');
  const [user, setUser] = useState(null);
  const [view, setView] = useState('dashboard');
  const [authScreen, setAuthScreen] = useState('entry');
  const [history, setHistory] = useState([{ type: 'auth', value: 'entry' }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const pushNavigation = useCallback((entry) => {
    setHistory((items) => {
      const nextItems = items.slice(0, historyIndex + 1);
      nextItems.push(entry);
      return nextItems;
    });
    setHistoryIndex((index) => index + 1);
  }, [historyIndex]);

  const navigateView = useCallback((nextView) => {
    setView(nextView);
    pushNavigation({ type: 'view', value: nextView });
  }, [pushNavigation]);

  const navigateAuth = useCallback((nextScreen) => {
    setAuthScreen(nextScreen);
    pushNavigation({ type: 'auth', value: nextScreen });
  }, [pushNavigation]);

  function applyNavigation(entry) {
    if (entry.type === 'auth') {
      setAuthScreen(entry.value);
    } else {
      setView(entry.value);
    }
  }

  function goBack() {
    if (historyIndex === 0) {
      return;
    }
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    applyNavigation(history[nextIndex]);
  }

  function goForward() {
    if (historyIndex >= history.length - 1) {
      return;
    }
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    applyNavigation(history[nextIndex]);
  }

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('email_confirmed') === '1') {
      setAuthScreen('login-user');
      setMessage('Email confirmed. You can now sign in.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    request('/api/session/')
      .then((data) => {
        setCsrfToken(data.csrfToken);
        setUser(data.user);
        setView('dashboard');
        if (data.user) {
          setHistory([{ type: 'view', value: 'dashboard' }]);
          setHistoryIndex(0);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const api = useMemo(() => ({
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) }, csrfToken),
    put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body || {}) }, csrfToken),
    patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body || {}) }, csrfToken),
    upload: (path, file, onProgress = () => {}) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest(); xhr.open('PUT', path); xhr.withCredentials = true; xhr.setRequestHeader('Content-Type', file.type);
      if (csrfToken) xhr.setRequestHeader('X-CSRFToken', csrfToken);
      xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
      xhr.onerror = () => reject(new Error('Could not upload the selected file. Check your connection and try again.'));
      xhr.onload = () => { let data = {}; try { data = JSON.parse(xhr.responseText); } catch {} if (xhr.status < 200 || xhr.status >= 300) reject(new Error(data.error || 'File upload failed.')); else resolve(data); };
      xhr.send(file);
    }),
    delete: (path) => request(path, { method: 'DELETE' }, csrfToken),
  }), [csrfToken]);

  const showMessage = useCallback((text) => {
    setMessage(text);
    window.clearTimeout(showMessage.timer);
    showMessage.timer = window.setTimeout(() => setMessage(''), 3500);
  }, []);

  async function handleLogout() {
    try {
      await api.post('/api/logout/');
    } catch (error) {
      showMessage(error.message);
    } finally {
      setUser(null);
      setView('dashboard');
      setAuthScreen('entry');
      setCsrfToken('');
      setHistory([{ type: 'auth', value: 'entry' }]);
      setHistoryIndex(0);
    }
  }

  if (loading) {
    return <main className="screen center">Loading library...</main>;
  }

  return (
    <main className="screen">
      {user && <header className="topbar">
        <div className="nav-arrows" aria-label="Page navigation">
          <button type="button" onClick={goBack} disabled={historyIndex === 0} aria-label="Go back">‹</button>
          <button type="button" onClick={goForward} disabled={historyIndex >= history.length - 1} aria-label="Go forward">›</button>
        </div>
        <div>
          <p className="eyebrow">Library Management System</p>
          <h1>{user ? `${user.role === 'admin' ? 'Admin' : 'Member'} Workspace` : 'Library Portal'}</h1>
        </div>
        {user && (
          <div className="session">
            {user.profile_photo ? <img className="session-avatar" src={user.profile_photo} alt="Your profile" /> : <span className="session-avatar avatar-fallback" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>}
            <span>{user.username}</span>
            <button type="button" onClick={handleLogout}>Sign out</button>
          </div>
        )}
      </header>}

      {message && <div className="notice">{message}</div>}

      <div className="app-content">
      {!user ? (
        <AuthRoutes
          api={api}
          authScreen={authScreen}
          setAuthScreen={navigateAuth}
          setCsrfToken={setCsrfToken}
          setUser={setUser}
          setView={setView}
          resetHistory={(entry) => {
            setHistory([entry]);
            setHistoryIndex(0);
          }}
          showMessage={showMessage}
        />
      ) : (
        <>
          <Nav role={user.role} view={view} setView={navigateView} />
          <div className="workspace">
            {user.role === 'admin' ? (
              <AdminWorkspace api={api} user={user} onUserChange={setUser} view={view} setView={navigateView} showMessage={showMessage} />
            ) : (
              <UserWorkspace api={api} user={user} onUserChange={setUser} view={view} setView={navigateView} showMessage={showMessage} onDeactivated={handleLogout} />
            )}
          </div>
        </>
      )}
      </div>
    </main>
  );
}

function AuthRoutes({ api, authScreen, setAuthScreen, setCsrfToken, setUser, setView, resetHistory, showMessage }) {
  if (authScreen === 'login-admin') {
    return (
      <AuthPanel
        api={api}
        mode="login"
        role="admin"
        title="Admin Login"
        setAuthScreen={setAuthScreen}
        setCsrfToken={setCsrfToken}
        setUser={setUser}
        setView={setView}
        resetHistory={resetHistory}
        showMessage={showMessage}
      />
    );
  }
  if (authScreen === 'login-user') {
    return (
      <AuthPanel
        api={api}
        mode="login"
        role="user"
        title="Member Login"
        setAuthScreen={setAuthScreen}
        setCsrfToken={setCsrfToken}
        setUser={setUser}
        setView={setView}
        resetHistory={resetHistory}
        showMessage={showMessage}
      />
    );
  }
  if (authScreen === 'signup') {
    return (
      <AuthPanel
        api={api}
        mode="register"
        role="user"
        title="Member Registration"
        setAuthScreen={setAuthScreen}
        setCsrfToken={setCsrfToken}
        setUser={setUser}
        setView={setView}
        resetHistory={resetHistory}
        showMessage={showMessage}
      />
    );
  }
  if (authScreen === 'password-reset') {
    return <PasswordResetPanel api={api} setAuthScreen={setAuthScreen} showMessage={showMessage} />;
  }
  return <EntryScreen setAuthScreen={setAuthScreen} />;
}

function EntryScreen({ setAuthScreen }) {
  const configuredAccessUrl = import.meta.env.VITE_LIBRARY_URL;
  const isLocalOnly = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const [accessUrl, setAccessUrl] = useState(configuredAccessUrl || window.location.href);

  useEffect(() => {
    if (configuredAccessUrl || !isLocalOnly) return;
    fetch('/api/network-address/')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data?.address) return;
        const phoneUrl = new URL(window.location.href);
        phoneUrl.hostname = data.address;
        setAccessUrl(phoneUrl.toString());
      })
      .catch(() => {});
  }, [configuredAccessUrl, isLocalOnly]);

  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterMessage, setNewsletterMessage] = useState('');
  const [newsletterState, setNewsletterState] = useState('');
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calendarCells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  const holidaysByDate = useMemo(() => new Map(getSouthAfricanPublicHolidays(year).map((holiday) => [holiday.date, holiday.name])), [year]);
  const currentMonthHolidays = [...holidaysByDate.entries()].filter(([date]) => Number(date.slice(5, 7)) === month + 1);

  async function subscribeToNewsletter(event) {
    event.preventDefault();
    setNewsletterMessage('');
    setNewsletterState('');
    try {
      const data = await request('/api/newsletter/subscribe/', { method: 'POST', body: JSON.stringify({ email: newsletterEmail }) });
      setNewsletterMessage(data.message);
      setNewsletterState('success');
      setNewsletterEmail('');
    } catch (error) {
      setNewsletterMessage(error.message);
      setNewsletterState('error');
    }
  }

  return (
    <section className="entry-shell">
      <div className="entry-hero">
        <div className="entry-stage">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-mark" aria-hidden="true"></span> Rustenburg community library</p>
            <h2>Find your next <em>favourite.</em></h2>
            <p>A good story, a new idea, a quiet place to explore. Your next great read is waiting right here.</p>
            <button type="button" className="explore-button" onClick={() => setAuthScreen('login-user')}>
              Explore the library <span aria-hidden="true">&rarr;</span>
            </button>
            <div className="hero-note"><span aria-hidden="true"></span> Come in, get curious, and make yourself at home.</div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-sun"></div>
            <div className="art-photo-wrap">
              <img className="art-photo" src={libraryBooks} alt="" />
            </div>
            <span className="art-sticker sticker-read">A world<br />between covers</span>
            <span className="art-sparkle sparkle-left"></span>
            <span className="art-sparkle sparkle-top"></span>
            <span className="art-caption"><span className="caption-dot"></span> DISCOVER SOMETHING NEW</span>
          </div>
        </div>
        <div className="entry-actions" aria-label="Choose how to access the library">
        <button type="button" className="entry-card admin-card" onClick={() => setAuthScreen('login-admin')}>
          <span className="entry-card-label">For library staff</span>
          <span className="entry-card-title"><span className="access-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20V5h4v15M10 20V8h4v12M16 20V3h4v17M2 20h20" /></svg></span><strong>Library team</strong></span>
          <small>Sign in to manage the collection and support readers.</small>
        </button>
        <button type="button" className="entry-card user-card" onClick={() => setAuthScreen('login-user')}>
          <span className="entry-card-label">For readers</span>
          <span className="entry-card-title"><span className="access-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 6C9 3.5 5.5 3 2.5 4v15c3.2-1.1 6.6-.5 9.5 2 2.9-2.5 6.3-3.1 9.5-2V4c-3-.9-6.5-.5-9.5 2ZM12 6v15" /></svg></span><strong>Welcome back</strong></span>
          <small>Sign in to find digital books and continue reading.</small>
        </button>
        <button type="button" className="entry-card signup-card" onClick={() => setAuthScreen('signup')}>
          <span className="entry-card-label">Start here</span>
          <span className="entry-card-title"><span className="access-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 4h13a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V4ZM7 4v16M13 9v6M10 12h6" /></svg></span><strong>Join the library</strong></span>
          <small>Create your account and start exploring the collection.</small>
        </button>
        <aside className="qr-access" aria-labelledby="qr-access-title">
          <QRCodeSVG value={accessUrl} size={144} level="M" includeMargin />
          <div>
            <span>Mobile Access</span>
            <strong id="qr-access-title">Scan to open the library</strong>
            <small>{isLocalOnly ? 'This QR code uses this computer’s Wi-Fi address. Connect your phone to the same network before scanning.' : 'Use your phone camera to open this library portal.'}</small>
          </div>
        </aside>
        </div>
      </div>
      <section className="community-intro" aria-labelledby="community-intro-title">
        <p className="eyebrow">Our story</p>
        <h2 id="community-intro-title">A library built for Rustenburg</h2>
        <p>This library was created for Rustenburg communities whose local libraries relied on manual systems to manage books. It brings digital reading into one easier-to-use place, helping readers discover books and read them online.</p>
      </section>
      <div className="community-sections">
        <section className="community-panel calendar-panel" aria-labelledby="calendar-title">
          <div className="community-panel-heading">
            <div><p className="eyebrow">South Africa</p><h2 id="calendar-title">Public holiday calendar</h2><p>National public holidays are marked on the calendar.</p></div>
            <div className="calendar-controls"><button type="button" aria-label="Previous month" onClick={() => setCalendarMonth(new Date(year, month - 1, 1))}>‹</button><button type="button" aria-label="Next month" onClick={() => setCalendarMonth(new Date(year, month + 1, 1))}>›</button></div>
          </div>
          <div className="calendar-month">{calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
          <div className="calendar-grid" role="grid" aria-label={calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span className="calendar-weekday" role="columnheader" key={day}>{day}</span>)}
            {calendarCells.map((day, index) => {
              const dateKey = day ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
              const holidayName = holidaysByDate.get(dateKey);
              const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
              return <span className={`calendar-day${holidayName ? ' public-holiday' : ''}${isToday ? ' today' : ''}`} role="gridcell" aria-label={day ? `${new Date(year, month, day).toLocaleDateString(undefined, { dateStyle: 'full' })}${holidayName ? `, ${holidayName}, public holiday` : ''}` : undefined} title={holidayName || undefined} key={`${year}-${month}-${index}`}>{day || ''}</span>;
            })}
          </div>
          <div className="holiday-list" aria-live="polite">
            <h3>Public holidays this month</h3>
            {currentMonthHolidays.length ? <ul>{currentMonthHolidays.map(([date, name]) => <li key={date}><time dateTime={date}>{new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</time><span>{name}</span></li>)}</ul> : <p>No national public holidays this month.</p>}
          </div>
          <p className="calendar-note">Includes public holidays provided for by the Public Holidays Act and officially declared additional holidays.</p>
        </section>
        <section className="community-panel newsletter-panel" aria-labelledby="newsletter-title">
          <p className="eyebrow">From the library</p>
          <h2 id="newsletter-title">Community newsletter</h2>
          <p>Get occasional updates about new books, reading ideas, and upcoming library news.</p>
          <form className="newsletter-form" onSubmit={subscribeToNewsletter}>
            <label htmlFor="newsletter-email">Email address</label>
            <div className="newsletter-input-row"><input id="newsletter-email" type="email" autoComplete="email" required value={newsletterEmail} onChange={(event) => setNewsletterEmail(event.target.value)} placeholder="you@example.com" /><button type="submit">Subscribe</button></div>
          </form>
          <p className="newsletter-privacy">Subscribe to receive occasional library updates. You can unsubscribe at any time by contacting the library.</p>
          {newsletterMessage && <p className={`newsletter-feedback ${newsletterState}`} role="status">{newsletterMessage}</p>}
        </section>
      </div>
    </section>
  );
}

function AuthPanel({ api, mode, role, title, setAuthScreen, setCsrfToken, setUser, setView, resetHistory, showMessage }) {
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [resendMode, setResendMode] = useState(false);
  const [resendIdentifier, setResendIdentifier] = useState('');
  const [mfaStep, setMfaStep] = useState('credentials');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaUrl, setMfaUrl] = useState('');

  async function submit(event) {
    event.preventDefault();
    try {
      if (resendMode) {
        const result = await api.post('/api/email/resend-confirmation/', { identifier: resendIdentifier });
        showMessage(result.message);
        setResendMode(false);
        return;
      }
      let data;
      if (mode === 'login' && role === 'admin' && mfaStep !== 'credentials') {
        const endpoint = mfaStep === 'setup' ? '/api/admin/mfa/confirm-setup/' : '/api/admin/mfa/verify/';
        data = await api.post(endpoint, { code: mfaCode });
      } else {
        data = mode === 'register'
          ? await api.post('/api/register/', form)
          : await api.post('/api/login/', { ...form, role });
      }
      if (mode === 'register' && data.verification_required) { showMessage(data.message); setAuthScreen('login-user'); return; }
      if (data.csrfToken) setCsrfToken(data.csrfToken);
      if (data.mfa_required) { setMfaStep('challenge'); setMfaCode(''); return; }
      if (data.mfa_setup_required) { setMfaStep('setup'); const setup = await request('/api/admin/mfa/setup/', { method: 'POST', body: '{}' }, data.csrfToken); setMfaUrl(setup.otpauthUrl); setMfaCode(''); return; }
      if (!data.user) throw new Error('Admin verification was not completed. Please sign in again.');
      // Verify the browser received a usable persisted session before switching workspaces.
      const activeSession = await request('/api/session/');
      if (!activeSession.user || activeSession.user.id !== data.user.id) throw new Error('Your sign-in could not be saved. Refresh the page and try again.');
      if (activeSession.csrfToken) setCsrfToken(activeSession.csrfToken);
      setUser(activeSession.user); setView('dashboard'); resetHistory({ type: 'view', value: 'dashboard' }); showMessage('Signed in successfully.');
    } catch (error) { showMessage(error.message); }
  }

  const mfaFlow = mode === 'login' && role === 'admin' && mfaStep !== 'credentials';
  return (
    <section className="auth-page">
      <div className="auth-copy">
        <button type="button" className="link-button" onClick={() => setAuthScreen('entry')}>Back to portal</button>
        <div className="auth-copy-layout">
          <div className="auth-copy-text">
            <p className="eyebrow">{mode === 'register' ? 'A new chapter starts here' : role === 'admin' ? 'Library team' : 'Welcome back'}</p>
            <h2>{mfaStep === 'setup' ? 'Secure your admin account.' : mfaFlow ? 'Verify your identity.' : mode === 'register' ? 'Make yourself at home.' : role === 'admin' ? 'Good to see you.' : 'Ready for your next read?'}</h2>
            <p>{mfaStep === 'setup' ? 'Scan this code with an authenticator app, then enter its six-digit code.' : mfaFlow ? 'Enter the current six-digit code from your authenticator app.' : mode === 'register' ? 'Create your account and start exploring the collection.' : role === 'admin' ? 'Sign in to care for the collection and support your readers.' : 'Sign in to browse books and pick up where you left off.'}</p>
          </div>
          <img className="auth-art" src={libraryBooks} alt="" />
        </div>
      </div>
      <form className="panel auth-form" onSubmit={submit}>
        <h3>{mfaStep === 'setup' ? 'Set up authenticator' : mfaStep === 'challenge' ? 'Admin verification' : mode === 'register' ? 'Join the library' : role === 'admin' ? 'Staff sign in' : 'Sign in'}</h3>
        {!mfaFlow ? resendMode ? <>
          <p>Enter the email address you used to register. If no message arrives, check your spam folder.</p>
          <label>Email address<input type="email" autoComplete="email" placeholder="you@example.com" value={resendIdentifier} onChange={(event) => setResendIdentifier(event.target.value)} required /></label>
          <button className="primary" type="submit">Send confirmation email</button>
          <p className="auth-switch"><button type="button" onClick={() => setResendMode(false)}>Return to sign in</button></p>
        </> : <>
          <label>{mode === 'login' && role === 'user' ? 'Username or email' : 'Username'}<input autoComplete="username" placeholder={mode === 'login' ? 'Enter your username or registered email' : ''} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label>
          {mode === 'register' && <label>Email<input type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>}
          <label>Password<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label>
          <button className="primary" type="submit">{mode === 'register' ? 'Create account' : 'Continue'}</button>
        </> : <>
          {mfaStep === 'setup' && mfaUrl && <div className="mfa-setup-code"><QRCodeSVG value={mfaUrl} size={190} level="M" includeMargin /><p>Scan with Google Authenticator, Microsoft Authenticator, or another TOTP app.</p></div>}
          <label>Six-digit code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
          <button className="primary" type="submit">{mfaStep === 'setup' ? 'Enable and sign in' : 'Verify and sign in'}</button>
        </>}
        {mode === 'register' ? <p className="auth-switch">Already have an account? <button type="button" onClick={() => setAuthScreen('login-user')}>Login</button></p> : !mfaFlow && role === 'user' && !resendMode ? <><p className="auth-switch"><button type="button" onClick={() => setAuthScreen('password-reset')}>Forgot password?</button></p><p className="auth-switch"><button type="button" onClick={() => { setResendIdentifier(''); setResendMode(true); }}>Resend confirmation email</button></p><p className="auth-switch">Do not have an account? <button type="button" onClick={() => setAuthScreen('signup')}>Register</button></p></> : null}
      </form>
    </section>
  );
}

function PasswordResetPanel({ api, setAuthScreen, showMessage }) {
  const [step, setStep] = useState('request');
  const [form, setForm] = useState({ username: '', code: '', password: '' });
  const [demoCode, setDemoCode] = useState('');

  async function requestCode(event) {
    event.preventDefault();
    try {
      const data = await api.post('/api/password-reset/request/', form);
      setDemoCode(data.reset_code || '');
      setStep('confirm');
      showMessage(data.message);
    } catch (error) { showMessage(error.message); }
  }

  async function resetPassword(event) {
    event.preventDefault();
    try {
      const data = await api.post('/api/password-reset/confirm/', form);
      showMessage(data.message);
      setAuthScreen('login-user');
    } catch (error) { showMessage(error.message); }
  }

  return (
    <section className="auth-page">
      <div className="auth-copy">
        <button type="button" className="link-button" onClick={() => setAuthScreen('login-user')}>Back to login</button>
        <div className="auth-copy-layout">
          <div className="auth-copy-text">
            <p className="eyebrow">Account recovery</p>
            <h2>Let's get you back in.</h2>
            <p>{step === 'request' ? 'Enter your username or registered email to request a one-time reset code.' : 'Enter the one-time code and choose a new password.'}</p>
          </div>
          <img className="auth-art" src={libraryBooks} alt="" />
        </div>
      </div>
      {step === 'request' ? (
        <form className="panel auth-form" onSubmit={requestCode}>
          <h3>Request reset code</h3>
          <label>Username or email<input autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label>
          <button className="primary" type="submit">Request code</button>
        </form>
      ) : (
        <form className="panel auth-form" onSubmit={resetPassword}>
          <h3>Choose a new password</h3>
          {demoCode && <p className="reset-code">Demo reset code: <strong>{demoCode}</strong></p>}
          <label>Reset code<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required /></label>
          <label>New password<input type="password" minLength="8" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label>
          <button className="primary" type="submit">Reset password</button>
        </form>
      )}
    </section>
  );
}

function Nav({ role, view, setView }) {
  const items = role === 'admin'
    ? [['dashboard', 'Dashboard'], ['books', 'Books & Catalogue'], ['categories', 'Categories & Genres'], ['authors', 'Authors'], ['users', 'Readers'], ['reports', 'Analytics & Reports'], ['audit', 'Audit Logs'], ['storage', 'Storage Health'], ['settings', 'System Settings'], ['security', 'Admin Security']]
    : [['dashboard', 'Home'], ['books', 'Explore Library'], ['categories', 'Categories'], ['authors', 'Authors'], ['favourites', 'My Favourites'], ['history', 'Recently Read'], ['recommendations', 'Recommendations'], ['account', 'Account Settings']];

  return (
    <nav className="tabs">
      {items.map(([id, label]) => (
        <button key={id} type="button" className={view === id || (id === 'books' && (view.startsWith('search:') || /^category-\d+$/.test(view) || /^author-\d+$/.test(view))) ? 'active' : ''} onClick={() => setView(id)}>
          {label}
        </button>
      ))}
    </nav>
  );
}

function UserWorkspace({ api, user, onUserChange, view, setView, showMessage, onDeactivated }) {
  if (view === 'dashboard') {
    return <UserDashboard api={api} setView={setView} showMessage={showMessage} />;
  }
  if (view === 'recommendations') {
    return <Recommendations api={api} showMessage={showMessage} />;
  }
  if (view === 'categories') return <CategoryBrowser api={api} setView={setView} showMessage={showMessage} />;
  if (view === 'authors') return <AuthorBrowser api={api} setView={setView} showMessage={showMessage} />;
  if (view === 'favourites') return <ReaderLibraryList api={api} kind="favourites" showMessage={showMessage} />;
  if (view === 'history') return <ReaderLibraryList api={api} kind="history" showMessage={showMessage} />;
  if (/^category-\d+$/.test(view)) return <BookBrowser key={view} api={api} canRead showMessage={showMessage} categoryId={view.slice(9)} />;
  if (/^author-\d+$/.test(view)) return <BookBrowser key={view} api={api} canRead showMessage={showMessage} authorId={view.slice(7)} />;
  if (view.startsWith('search:')) return <BookBrowser key={view} api={api} canRead showMessage={showMessage} initialQuery={decodeURIComponent(view.slice(7))} />;
  if (view === 'account') {
    return <AccountSettings api={api} user={user} onUserChange={onUserChange} onDeactivated={onDeactivated} showMessage={showMessage} />;
  }
  return <BookBrowser api={api} canRead showMessage={showMessage} />;
}

function AdminWorkspace({ api, user, onUserChange, view, setView, showMessage }) {
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');
  const loadSummary = useCallback(() => {
    setSummaryError('');
    return api.get('/api/admin/summary/')
      .then((data) => { setSummary(data); setSummaryError(''); })
      .catch((error) => { setSummaryError(error.message); showMessage(error.message); });
  }, [api, showMessage]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  if (!summary) {
    return (
      <section className="panel" role={summaryError ? 'alert' : 'status'}>
        {summaryError ? (
          <>
            <h2>Admin data could not be loaded</h2>
            <p>{summaryError}</p>
            <button type="button" className="secondary" onClick={loadSummary}>Try again</button>
          </>
        ) : 'Loading admin data...'}
      </section>
    );
  }

  if (view === 'dashboard') {
    return <AdminDashboard summary={summary} setView={setView} />;
  }
  if (view === 'books') {
    return <BookManager api={api} showMessage={showMessage} />;
  }
  if (view === 'categories' || view === 'authors') {
    return <AdminEntityManager api={api} kind={view} showMessage={showMessage} />;
  }
  if (view === 'users') {
    return <UserManager users={summary.users} api={api} reload={loadSummary} showMessage={showMessage} />;
  }
  if (view === 'account') {
    return <AccountSettings api={api} user={user} onUserChange={onUserChange} showMessage={showMessage} />;
  }
  if (view === 'security') return <AdminSecurity api={api} user={user} setView={setView} showMessage={showMessage} />;
  if (view === 'audit') return <AuditLogViewer api={api} showMessage={showMessage} />;
  if (view === 'storage') return <StorageHealth api={api} showMessage={showMessage} />;
  if (view === 'settings') return <SystemSettings api={api} showMessage={showMessage} />;
  if (view === 'reports') {
    return <AdminAnalytics api={api} summary={summary} showMessage={showMessage} />;
  }
  return null;
}

function AdminEntityManager({ api, kind, showMessage }) {
  const isCategory = kind === 'categories', endpoint = isCategory ? 'categories' : 'authors';
  const [items,setItems]=useState([]),[query,setQuery]=useState(''),[editing,setEditing]=useState(null),[busy,setBusy]=useState(false);
  const blank = isCategory ? {name:'',description:'',is_active:true} : {name:'',biography:''};
  const load=useCallback(()=>api.get(`/api/admin/${endpoint}/`).then((data)=>setItems(data[endpoint])),[api,endpoint]);
  useEffect(()=>{load().catch((error)=>showMessage(error.message));},[load,showMessage]);
  async function save(event){event.preventDefault();setBusy(true);try{if(editing?.id)await api.put(`/api/admin/${endpoint}/${editing.id}/`,editing);else await api.post(`/api/admin/${endpoint}/`,editing||blank);setEditing(null);await load();showMessage(`${isCategory?'Category':'Author'} saved.`);}catch(error){showMessage(error.message);}finally{setBusy(false);}}
  const filtered=items.filter((item)=>`${item.name} ${item.description||item.biography||''}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="panel admin-section"><div className="section-heading"><div><p className="eyebrow">Catalogue organization</p><h2>{isCategory?'Categories and genres':'Author management'}</h2><p>{isCategory?'Group books by subject and archive unused categories safely.':'Manage author records and see the books associated with each author.'}</p></div></div>
    <div className="admin-two-column"><form className="form-grid entity-form" onSubmit={save}><h3>{editing?.id?'Edit':'Add'} {isCategory?'category':'author'}</h3><label>Name<input required maxLength="120" value={(editing||blank).name} onChange={(e)=>setEditing({...editing||blank,name:e.target.value})}/></label><label>{isCategory?'Description':'Biography'}<textarea rows="4" value={(editing||blank)[isCategory?'description':'biography']} onChange={(e)=>setEditing({...editing||blank,[isCategory?'description':'biography']:e.target.value})}/></label>{isCategory&&editing?.id&&<label className="check-label"><input type="checkbox" checked={editing.is_active} onChange={(e)=>setEditing({...editing,is_active:e.target.checked})}/> Active category</label>}<div className="button-row"><button className="primary" disabled={busy}>{busy?'Saving...':'Save'}</button>{editing&&<button type="button" className="secondary" onClick={()=>setEditing(null)}>Cancel</button>}</div></form>
      <div className="entity-list"><div className="section-heading compact-heading"><h3>{isCategory?'All categories':'All authors'}</h3><span>{filtered.length} shown</span></div><label className="search-label">Search<input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder={`Search ${endpoint}`}/></label>{filtered.length?filtered.map((item)=><article className="entity-row" key={item.id}><div><strong>{item.name}</strong><small>{isCategory?item.description:item.biography}</small><span>{item.book_count} {item.book_count===1?'book':'books'}{isCategory&&!item.is_active?' · Archived':''}</span></div><button type="button" className="secondary" onClick={()=>setEditing(item)}>Edit</button></article>):<p className="empty-state">No matching {endpoint} yet.</p>}</div></div>
  </section>;
}

function AdminAnalytics({api,summary,showMessage}){
  const [days,setDays]=useState(30),[data,setData]=useState(null),[busy,setBusy]=useState(true);
  const load=useCallback(()=>{setBusy(true);return api.get(`/api/admin/analytics/?days=${days}`).then(setData).catch((error)=>showMessage(error.message)).finally(()=>setBusy(false));},[api,days,showMessage]);
  useEffect(()=>{load();},[load]);
  const metrics=data;
  return <section className="panel admin-section"><div className="section-heading section-heading-row"><div><p className="eyebrow">Reader activity</p><h2>Analytics and reports</h2><p>Real catalogue, account, and recorded book-open data. An open is not counted as a completed read.</p></div><div className="button-row"><label className="filter-label">Period<select value={days} onChange={(e)=>setDays(Number(e.target.value))}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label><a className="button-link secondary" href={`/api/admin/reports/analytics.csv?days=${days}`}>Download CSV</a></div></div>
    {busy&&!metrics?<p className="loading-state">Loading analytics…</p>:metrics&&<><div className="analytics-stat-grid"><Stat label="Total book opens" value={metrics.activity.opens}/><Stat label="Unique readers" value={metrics.activity.unique_readers}/><Stat label="Reader registrations" value={metrics.readers.registrations}/><Stat label="Published books" value={metrics.books.published}/><Stat label="Active readers" value={metrics.readers.active_readers}/><Stat label="Tracked book storage" value={formatBytes(metrics.books.file_bytes)}/></div>
      <div className="admin-two-column"><div className="data-card"><h3>Most opened books</h3>{metrics.most_read.length?metrics.most_read.map((book)=><div className="metric-row" key={book.id}><span>{book.title}</span><strong>{book.opens}</strong></div>):<p className="empty-state">No book opens have been recorded in this period.</p>}</div><div className="data-card"><h3>Popular categories</h3>{metrics.popular_categories.length?metrics.popular_categories.map((item)=><div className="metric-row" key={item.category}><span>{item.category}</span><strong>{item.opens}</strong></div>):<p className="empty-state">No category activity in this period.</p>}</div></div>
      <div className="data-card"><h3>Book opens by day</h3>{metrics.daily.length?<div className="daily-activity">{metrics.daily.map((item)=><div key={item.day}><time>{new Date(`${item.day}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</time><strong>{item.opens}</strong><small>{item.readers} readers</small></div>)}</div>:<p className="empty-state">No activity has been recorded in this period.</p>}</div>
      <div className="data-card"><h3>Recent catalogue additions</h3>{summary.books.filter((book)=>book.created_at).slice(0,8).length?summary.books.filter((book)=>book.created_at).slice(0,8).map((book)=><div className="metric-row" key={book.id}><span>{book.title} · {book.author}</span><small>{new Date(book.created_at).toLocaleDateString()}</small></div>):<p className="empty-state">No recent book records.</p>}</div>
      <div className="data-card"><h3>Content needing attention</h3><div className="metric-row"><span>Books without digital files</span><strong>{summary.books.filter((book)=>!book.has_virtual_version).length}</strong></div><div className="metric-row"><span>Missing covers</span><strong>{metrics.books.missing_cover}</strong></div><div className="metric-row"><span>Incomplete description or language</span><strong>{metrics.books.incomplete_metadata}</strong></div></div>
    </>}{!busy&&metrics&&<button className="secondary" type="button" onClick={load}>Refresh report</button>}</section>;
}
function formatBytes(value){const size=Number(value)||0;if(size<1024)return `${size} B`;const units=['KB','MB','GB','TB'];let amount=size/1024,index=0;while(amount>=1024&&index<units.length-1){amount/=1024;index++;}return `${amount.toFixed(1)} ${units[index]}`;}

function AuditLogViewer({api,showMessage}){
  const [q,setQ]=useState(''),[event,setEvent]=useState(''),[page,setPage]=useState(0),[result,setResult]=useState({records:[],total:0}),[busy,setBusy]=useState(true);
  const load=useCallback(()=>{setBusy(true);return api.get(`/api/admin/audit/?page=${page}&q=${encodeURIComponent(q)}&event=${encodeURIComponent(event)}`).then(setResult).catch((error)=>showMessage(error.message)).finally(()=>setBusy(false));},[api,page,q,event,showMessage]);useEffect(()=>{load();},[load]);
  return <section className="panel admin-section"><div className="section-heading"><p className="eyebrow">Append-only administrator activity</p><h2>Audit logs</h2><p>Administrative actions are retained in Supabase and cannot be edited or deleted through this application.</p></div><form className="filter-bar" onSubmit={(e)=>{e.preventDefault();setPage(0);load();}}><label>Search event<input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="For example: book_updated"/></label><label>Action type<input value={event} onChange={(e)=>setEvent(e.target.value)} placeholder="Filter exact action type"/></label><button className="primary">Search</button></form>{busy?<p className="loading-state">Loading audit records…</p>:result.records.length?<div className="audit-list">{result.records.map((record)=><article key={record.id} className="audit-row"><div><strong>{record.event.replaceAll('_',' ')}</strong><span>{record.actor?.username||'System'} · {record.target_type||'system'} {record.target_id?`#${record.target_id}`:''}</span>{Object.keys(record.details||{}).length>0&&<small>{JSON.stringify(record.details)}</small>}</div><time>{new Date(record.created_at).toLocaleString()}</time></article>)}</div>:<p className="empty-state">No matching audit records.</p>}<div className="pagination"><span>{result.total} records</span><button className="secondary" disabled={page===0} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page+1}</span><button className="secondary" disabled={(page+1)*50>=result.total} onClick={()=>setPage(page+1)}>Next</button></div></section>;
}

function StorageHealth({api,showMessage}){
  const [health,setHealth]=useState(null),[busy,setBusy]=useState(true),[checking,setChecking]=useState(null);
  const load=useCallback(()=>{setBusy(true);return api.get('/api/admin/storage-health/').then(setHealth).catch((error)=>showMessage(error.message)).finally(()=>setBusy(false));},[api,showMessage]);useEffect(()=>{load();},[load]);
  async function validate(book){setChecking(book.id);try{const result=await api.get(`/api/admin/books/${book.id}/validate/`);showMessage(result.valid?'Digital file opened successfully.':`Validation failed: ${Object.entries(result.checks).filter(([,ok])=>!ok).map(([key])=>key).join(', ')}`);await load();}catch(error){showMessage(error.message);}finally{setChecking(null);}}
  return <section className="panel admin-section"><div className="section-heading section-heading-row"><div><p className="eyebrow">Private Supabase storage</p><h2>Storage and file health</h2><p>Checks database references against every stored object in the private book and cover buckets.</p></div><button className="secondary" onClick={load}>Refresh check</button></div>{busy?<p className="loading-state">Checking storage…</p>:health&&<><div className="analytics-stat-grid"><Stat label="Book files" value={`${health.book_bucket.objects} · ${formatBytes(health.book_bucket.bytes)}`}/><Stat label="Cover files" value={`${health.cover_bucket.objects} · ${formatBytes(health.cover_bucket.bytes)}`}/><Stat label="Book files without a record" value={health.book_bucket.orphaned.length}/><Stat label="Cover files without a record" value={health.cover_bucket.orphaned.length}/></div><div className="admin-two-column"><div className="data-card"><h3>Books without digital files</h3>{health.missing_books.length?health.missing_books.map(book=><div className="metric-row" key={book.id}><span>{book.title}</span><button className="secondary" disabled={checking===book.id} onClick={()=>validate(book)}>{checking===book.id?'Checking…':'Validate'}</button></div>):<p className="empty-state">Every non-archived book has a stored file reference.</p>}</div><div className="data-card"><h3>Book files missing from storage</h3>{health.unavailable_books.length?health.unavailable_books.map(book=><div className="metric-row" key={book.id}><span>{book.title} · {book.status}</span><button className="secondary" disabled={checking===book.id} onClick={()=>validate(book)}>{checking===book.id?'Checking…':'Check file'}</button></div>):<p className="empty-state">Every referenced book file exists in private storage.</p>}<small>To restore a missing file, open the book in Book Management and upload its PDF again.</small></div><div className="data-card"><h3>Books without covers</h3>{health.missing_covers.length?health.missing_covers.map(book=><div className="metric-row" key={book.id}><span>{book.title}</span><small>Optional cover</small></div>):<p className="empty-state">Every non-archived book has a cover.</p>}{health.unavailable_covers.length>0&&<p>{health.unavailable_covers.length} saved cover file(s) are missing from storage.</p>}</div></div><div className="data-card"><h3>Unreferenced files</h3><p>Review these before removing anything. Cleanup is intentionally manual.</p><div className="admin-two-column"><div><strong>Book bucket</strong>{health.book_bucket.orphaned.map(name=><code className="file-key" key={name}>{name}</code>)}</div><div><strong>Cover bucket</strong>{health.cover_bucket.orphaned.map(name=><code className="file-key" key={name}>{name}</code>)}</div></div></div></>}</section>;
}

function SystemSettings({api,showMessage}){
  const [branding,setBranding]=useState({name:'',contact_email:'',contact_phone:'',logo_url:''}),[catalogue,setCatalogue]=useState({registration_enabled:true,featured_book_ids:[]}),[books,setBooks]=useState([]),[busy,setBusy]=useState(true),[saving,setSaving]=useState(false);
  const load=useCallback(()=>{setBusy(true);return Promise.all([api.get('/api/admin/settings/'),api.get('/api/books/?include_unreadable=1')]).then(([settings,result])=>{setBranding(settings.settings.branding||branding);setCatalogue(settings.settings.catalogue||catalogue);setBooks(result.books.filter(book=>book.status!=='archived'));}).catch((error)=>showMessage(error.message)).finally(()=>setBusy(false));},[api,showMessage]);useEffect(()=>{load();},[load]);
  async function save(key,value){setSaving(true);try{const result=await api.put(`/api/admin/settings/${key}/`,{value});if(key==='branding')setBranding(result.value);else setCatalogue(result.value);showMessage('Library settings saved.');}catch(error){showMessage(error.message);}finally{setSaving(false);}}
  function toggleFeatured(id){setCatalogue(current=>({...current,featured_book_ids:current.featured_book_ids.includes(id)?current.featured_book_ids.filter(x=>x!==id):[...current.featured_book_ids,id]}));}
  return <section className="panel admin-section"><div className="section-heading"><p className="eyebrow">Reader-facing configuration</p><h2>System settings</h2><p>Only supported application settings are editable here. SMTP credentials and security keys remain in server environment settings.</p></div>{busy?<p className="loading-state">Loading settings…</p>:<><form className="form-grid settings-form" onSubmit={(e)=>{e.preventDefault();save('branding',branding);}}><h3>Library identity</h3><label>Library name<input maxLength="100" required value={branding.name} onChange={(e)=>setBranding({...branding,name:e.target.value})}/></label><label>Contact email<input type="email" value={branding.contact_email} onChange={(e)=>setBranding({...branding,contact_email:e.target.value})}/></label><label>Contact phone<input value={branding.contact_phone} onChange={(e)=>setBranding({...branding,contact_phone:e.target.value})}/></label><label>Logo URL (optional)<input type="url" value={branding.logo_url} onChange={(e)=>setBranding({...branding,logo_url:e.target.value})}/></label><button className="primary" disabled={saving}>Save identity</button></form><form className="form-grid settings-form" onSubmit={(e)=>{e.preventDefault();save('catalogue',catalogue);}}><h3>Reader access and homepage</h3><label className="check-label"><input type="checkbox" checked={catalogue.registration_enabled} onChange={(e)=>setCatalogue({...catalogue,registration_enabled:e.target.checked})}/> Allow new member registration</label><h4>Featured books</h4><p className="form-hint">Select up to 12 published books. Selected order is used on the member homepage.</p><div className="featured-settings">{books.filter(book=>book.status==='published'&&book.has_virtual_version).map(book=><label className="check-label" key={book.id}><input type="checkbox" checked={catalogue.featured_book_ids.includes(book.id)} disabled={!catalogue.featured_book_ids.includes(book.id)&&catalogue.featured_book_ids.length>=12} onChange={()=>toggleFeatured(book.id)}/>{book.title}</label>)}</div><button className="primary" disabled={saving}>Save catalogue settings</button></form><div className="data-card"><h3>Email and deployment configuration</h3><p>SMTP host, port, account, app password, session keys, MFA encryption key, and Supabase service-role key must be configured in the server environment on Render or your local .env file. They are never stored in this public settings form.</p></div></>}</section>;
}

function AdminSecurity({api,user,setView,showMessage}){
  const [status,setStatus]=useState(null);useEffect(()=>{api.get('/api/admin/security/').then(setStatus).catch((error)=>showMessage(error.message));},[api,showMessage]);
  return <section className="panel admin-section"><div className="section-heading"><p className="eyebrow">Administrator account</p><h2>Account and security</h2><p>Admin routes require server-side role checks and a verified authenticator challenge on each sign-in.</p></div><div className="analytics-stat-grid"><article className="stat"><span>Signed in as</span><strong>{user.username}</strong></article><article className="stat"><span>Two-factor authentication</span><strong>{status?status.mfa_enabled?'Enabled':'Setup required':'Checking…'}</strong></article><article className="stat"><span>Active administrators</span><strong>{status?.active_admins??'…'}</strong></article><article className="stat"><span>Email delivery</span><strong>{status?status.smtp_configured?status.email_provider||'Configured':'Not configured':'Checking…'}</strong></article></div><div className="data-card"><h3>Security guidance</h3><ul><li>Use an authenticator app and keep recovery access to it secure.</li><li>Never share the server-only Supabase service-role key.</li><li>Use the password recovery flow to set a unique account password.</li><li>Account status and permissions are enforced by the server on every API request.</li></ul><button className="secondary" onClick={()=>setView('account')}>Manage admin profile</button></div></section>;
}

function UserManager({ api, reload, showMessage }) {
  const [users,setUsers]=useState([]),[q,setQ]=useState(''),[status,setStatus]=useState('all'),[role,setRole]=useState('all'),[page,setPage]=useState(0),[total,setTotal]=useState(0),[busy,setBusy]=useState(true);
  const load=useCallback(()=>{setBusy(true);const params=new URLSearchParams({page:String(page)});if(q)params.set('q',q);if(status!=='all')params.set('status',status);if(role!=='all')params.set('role',role);return api.get(`/api/admin/users/?${params}`).then(data=>{setUsers(data.users);setTotal(data.total);}).catch(error=>showMessage(error.message)).finally(()=>setBusy(false));},[api,page,q,status,role,showMessage]);useEffect(()=>{load();},[load]);
  async function setAccount(item,changes){try{await api.patch(`/api/admin/users/${item.id}/`,changes);await load();await reload();showMessage('Reader account updated.');}catch(error){showMessage(error.message);}}
  async function confirmEmail(item){if(!window.confirm(`Mark ${item.username}'s email as confirmed? Do this only after you have verified that ${item.email} belongs to this member.`))return;try{const result=await api.post(`/api/admin/users/${item.id}/confirm-email/`);await load();await reload();showMessage(result.message);}catch(error){showMessage(error.message);}}
  async function removeUser(item) {
    if (!window.confirm(`Permanently delete ${item.username} and their account data? This cannot be undone. Deactivate the account instead if you only need to block sign-in.`)) return;
    try {
      await api.delete(`/api/admin/users/${item.id}/`);
      await reload();
      showMessage(`${item.username} was removed.`);
    } catch (error) { showMessage(error.message); }
  }
  return <section className="panel user-manager">
    <div className="section-heading"><div><p className="eyebrow">Reader directory</p><h2>Reader management</h2><p>Search accounts, review registration dates, and update access. Passwords are never displayed.</p></div></div>
    <form className="filter-bar" onSubmit={(e)=>{e.preventDefault();setPage(0);load();}}><label>Search name or email<input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Username or email"/></label><label>Status<select value={status} onChange={(e)=>{setStatus(e.target.value);setPage(0);}}><option value="all">All statuses</option><option value="active">Active</option><option value="deactivated">Deactivated</option></select></label><label>Role<select value={role} onChange={(e)=>{setRole(e.target.value);setPage(0);}}><option value="all">All roles</option><option value="user">Readers</option><option value="admin">Admins</option></select></label><button className="primary">Search</button></form>
    {busy?<p className="loading-state">Loading reader accounts…</p>:<div className="table">{users.length?users.map((item)=><div className="row user-row" key={item.id}>
        <div><strong>{item.username}</strong><span>{item.email||'No email'} · Joined {item.created_at?new Date(item.created_at).toLocaleDateString():'date unavailable'}</span><small>{item.email_verified?'Email confirmed':'Email not confirmed'}</small></div>
        <span className={`badge ${!item.is_active?'danger-badge':''}`}>{item.role==='admin'?'Administrator':item.is_active?'Active reader':'Deactivated'}</span>
        <div className="button-row">{item.role==='user'?<>{!item.email_verified&&<button type="button" className="secondary" disabled={!item.email} onClick={()=>confirmEmail(item)}>Confirm email</button>}<button type="button" className="secondary" onClick={()=>setAccount(item,{is_active:!item.is_active})}>{item.is_active?'Deactivate':'Activate'}</button><button type="button" className="secondary" disabled={!item.email} onClick={async()=>{try{const result=await api.post(`/api/admin/users/${item.id}/recovery/`);showMessage(result.message);}catch(error){showMessage(error.message);}}}>Send recovery</button><button type="button" className="secondary" onClick={()=>{if(window.confirm(`Promote ${item.username} to administrator? They will need to set up two-factor authentication at their next login.`))setAccount(item,{role:'admin'});}}>Promote</button><button type="button" className="danger" onClick={()=>removeUser(item)}>Delete</button></>:<span className="admin-protected">Protected administrator</span>}</div>
      </div>):<p className="empty-state">No accounts match these filters.</p>}</div>}
    <div className="pagination"><span>{total} accounts</span><button className="secondary" disabled={page===0} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page+1}</span><button className="secondary" disabled={(page+1)*50>=total} onClick={()=>setPage(page+1)}>Next</button></div>
  </section>;
}

function AccountSettings({ api, user, onUserChange, onDeactivated, showMessage }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  async function updatePhoto(file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) return showMessage('Choose a PNG, JPEG, WEBP, or GIF image.');
    if (file.size > 1500000) return showMessage('Choose an image smaller than 1.5 MB.');
    const photo = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    setPhotoBusy(true);
    try {
      const data = await api.put('/api/account/profile-photo/', { photo });
      onUserChange(data.user);
      showMessage('Profile photo updated.');
    } catch (error) { showMessage(error.message); } finally { setPhotoBusy(false); }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      const data = await api.delete('/api/account/profile-photo/');
      onUserChange(data.user);
      showMessage('Profile photo removed.');
    } catch (error) { showMessage(error.message); } finally { setPhotoBusy(false); }
  }

  async function deactivate() {
    setBusy(true);
    try {
      await api.post('/api/account/deactivate/');
      onDeactivated();
      showMessage('Your account has been deactivated.');
    } catch (error) { showMessage(error.message); setBusy(false); }
  }
  return <section className="panel account-panel"><p className="eyebrow">Account settings</p><h2>Manage your profile</h2><p>Choose a photo to personalise your library account. It appears alongside your name while you are signed in.</p><div className="profile-photo-editor"><div className="profile-photo-preview">{user.profile_photo ? <img src={user.profile_photo} alt="Your profile" /> : <span>{user.username.slice(0, 1).toUpperCase()}</span>}</div><div><strong>{user.username}</strong><span className="profile-role">{user.role === 'admin' ? 'Library administrator' : 'Library member'}</span><label className="photo-upload">{photoBusy ? 'Saving photo...' : 'Choose profile photo'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={photoBusy} onChange={(event) => { updatePhoto(event.target.files?.[0]).catch(() => showMessage('Could not read that image.')); event.target.value = ''; }} /></label>{user.profile_photo && <button type="button" className="link-button" onClick={removePhoto} disabled={photoBusy}>Remove photo</button>}<small>PNG, JPEG, WEBP, or GIF — maximum 1.5 MB.</small></div></div>{user.role === 'user' && <div className="danger-zone"><div><strong>Deactivate account</strong><span>Signing in and digital book reading will no longer be available.</span></div>{confirming ? <div className="confirm-actions"><button type="button" className="secondary" onClick={() => setConfirming(false)} disabled={busy}>Keep account</button><button type="button" className="danger" onClick={deactivate} disabled={busy}>{busy ? 'Deactivating...' : 'Confirm deactivation'}</button></div> : <button type="button" className="danger" onClick={() => setConfirming(true)}>Deactivate account</button>}</div>}</section>;
}

function ReportTable({ title, columns, rows, emptyText }) {
  return (
    <section className="report-table-section">
      <h3>{title}</h3>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
          <tbody>
            {rows.length ? rows.map((row, index) => <tr key={`${title}-${index}`}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>) : (
              <tr><td colSpan={columns.length}>{emptyText}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DashboardAction({ tone, title, text, action, onClick }) {
  return (
    <button type="button" className={`dashboard-card ${tone}`} onClick={onClick}>
      <span>{action}</span>
      <strong>{title}</strong>
      <small>{text}</small>
    </button>
  );
}

function UserDashboard({ api, setView, showMessage }) {
  const [homepage,setHomepage]=useState({featured:[],recent:[]}),[readerHome,setReaderHome]=useState({continue_reading:[],recently_read:[],popular:[]}),[readerBook,setReaderBook]=useState(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[search,setSearch]=useState('');
  const load=useCallback(()=>{setLoading(true);setLoadError('');Promise.all([api.get('/api/catalogue/homepage/'),api.get('/api/reader/home/')]).then(([catalogue,home])=>{setHomepage(catalogue);setReaderHome(home);}).catch(error=>{setLoadError(error.message);showMessage(error.message);}).finally(()=>setLoading(false));},[api,showMessage]);
  useEffect(()=>{load();},[load]);
  const continueBooks=readerHome.continue_reading.map(item=>({...item.book,resumePage:item.location?.page||1}));
  const recentlyBooks=readerHome.recently_read.map(item=>({...item.book,lastOpened:item.last_opened_at}));
  return (
    <section className="dashboard">
      <div className="dashboard-intro">
        <div className="dashboard-intro-copy">
          <p className="eyebrow">Member Dashboard</p>
          <h2>Welcome back. What would you like to read?</h2>
          <p>Search the collection, pick up where you left off, or explore a popular title.</p>
          <form className="home-search" onSubmit={event=>{event.preventDefault();const term=search.trim();setView(term?`search:${encodeURIComponent(term)}`:'books');}}><label className="sr-only" htmlFor="home-book-search">Search the library</label><input id="home-book-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search titles, authors, subjects…"/><button type="submit" className="primary">Search</button></form>
        </div>
        <img className="shared-hero-art" src={libraryBooks} alt="A colorful stack of library books" />
      </div>
      <div className="dashboard-grid">
        <DashboardAction tone="blue" title="Explore the library" text="Search and filter published digital books." action="Browse books" onClick={() => setView('books')} />
        <DashboardAction tone="cyan" title="My favourites" text="Return to books you have saved." action="Open favourites" onClick={() => setView('favourites')} />
        <DashboardAction tone="green" title="Your categories" text="Explore the collection by subject." action="Browse categories" onClick={() => setView('categories')} />
      </div>
      <div className="homepage-books">
        <div className="section-heading section-heading-row"><div><p className="eyebrow">Picked for the library</p><h2>Featured books</h2></div><button type="button" className="secondary" onClick={()=>setView('books')}>Browse all books</button></div>
        {loading?<p className="loading-state">Loading your library…</p>:loadError?<div className="empty-state"><p>We couldn’t load your library right now.</p><button type="button" className="secondary" onClick={load}>Try again</button></div>:homepage.featured.length?<BookShelf books={homepage.featured.slice(0,4)} onOpen={setReaderBook} onDetails={(book)=>setReaderBook(book)}/>:<p className="empty-state">No featured books yet. Explore the catalogue to discover available reading.</p>}
        {continueBooks.length>0&&<ReaderShelf title="Continue reading" books={continueBooks} onOpen={setReaderBook} />}
        {recentlyBooks.length>0&&<ReaderShelf title="Recently read" books={recentlyBooks} onOpen={setReaderBook} />}
        {readerHome.popular.length>0?<ReaderShelf title="Popular this month" books={readerHome.popular} onOpen={setReaderBook} />:<div className="data-card"><h3>Popular books</h3><p className="empty-state">Reader activity will appear here as the collection is explored.</p></div>}
        {homepage.recent.length>0&&<ReaderShelf title="Recently added" books={homepage.recent} onOpen={setReaderBook} />}
      </div>
      {readerBook&&<BookReader api={api} book={readerBook} onClose={()=>{setReaderBook(null);load();}} showMessage={showMessage}/>}
    </section>
  );
}

function BookShelf({books,onOpen}) { return <ReaderShelf title="Featured books" books={books} onOpen={onOpen}/>; }
function ReaderShelf({title,books,onOpen}) { return <section className="reader-shelf"><div className="section-heading section-heading-row"><h3>{title}</h3></div><div className="book-grid">{books.map(book=><article className="book-card" key={book.id}><button type="button" className="book-cover-button" onClick={()=>onOpen(book)} aria-label={`Open ${book.title} details`}><img className="book-cover" src={getBookImage(book)} alt={`${book.title} cover`} loading="lazy"/></button><div><h3>{book.title}</h3><p>{book.author}</p><span>{book.category||'Digital book'} · Read online</span>{book.resumePage&&<small>Last page: {book.resumePage}</small>}{book.lastOpened&&<small>Opened {new Date(book.lastOpened).toLocaleDateString()}</small>}</div><button type="button" className="primary" onClick={()=>onOpen(book)}>Read Book</button></article>)}</div></section>; }

function AdminDashboard({ summary, setView }) {
  return (
    <section className="dashboard">
      <div className="admin-overview-grid">
        <div className="dashboard-intro admin-intro">
          <div className="dashboard-intro-copy">
            <p className="eyebrow">Admin Dashboard</p>
            <h2>Manage the digital library catalogue.</h2>
            <p>Add online reading material, manage members, and review library activity.</p>
          </div>
          <img className="shared-hero-art" src={libraryBooks} alt="A colorful stack of library books" />
        </div>
        <div className="admin-stat-grid">
          <Stat label="Total books" value={summary.stats.total_books} />
          <Stat label="Published" value={summary.stats.published_books} />
          <Stat label="Drafts" value={summary.stats.draft_books} />
          <Stat label="Active readers" value={summary.stats.active_users} />
          <Stat label="Deactivated readers" value={summary.stats.deactivated_users} />
          <Stat label="Book opens · 30 days" value={summary.stats.total_opens} />
        </div>
      </div>
      <div className="dashboard-grid">
        <DashboardAction tone="blue" title="Books & catalogue" text="Add new titles, edit existing records, upload files, and manage publication." action="Open catalogue" onClick={() => setView('books')} />
        <DashboardAction tone="green" title="Manage readers" text="Search, activate, deactivate, and recover accounts." action="Reader access" onClick={() => setView('users')} />
        <DashboardAction tone="green" title="Review activity" text="See recorded opens, popular titles, and reports." action="Analytics" onClick={() => setView('reports')} />
      </div>
      <div className="admin-two-column dashboard-lower"><div className="data-card"><div className="section-heading section-heading-row"><h3>Most opened</h3><button className="link-button" onClick={()=>setView('reports')}>View analytics</button></div>{summary.most_read.length?summary.most_read.slice(0,5).map(book=><div className="metric-row" key={book.id}><span>{book.title}</span><strong>{book.opens} opens</strong></div>):<p className="empty-state">Reader activity will appear after a book is opened.</p>}</div><div className="data-card"><div className="section-heading section-heading-row"><h3>Recent admin actions</h3><button className="link-button" onClick={()=>setView('audit')}>Open audit log</button></div>{summary.recent_actions.length?summary.recent_actions.slice(0,5).map(action=><div className="metric-row" key={action.id}><span>{action.actor?.username||'System'} · {action.event.replaceAll('_',' ')}</span><small>{new Date(action.created_at).toLocaleDateString()}</small></div>):<p className="empty-state">Administrative activity will be recorded here.</p>}</div></div>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <article className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Recommendations({ api, showMessage }) {
  const [books, setBooks] = useState([]);
  const [readerBook, setReaderBook] = useState(null);
  const [input, setInput] = useState('');
  const [profile, setProfile] = useState({
    categories: [],
    tones: [],
    goals: [],
    keywords: [],
  });
  const [messages, setMessages] = useState([
    {
      role: 'bot',
      text: 'Tell me what you like reading. You can type things like: I love dark mysteries, I want books for coding, or recommend something romantic and easy.',
    },
  ]);

  useEffect(() => {
    api.get('/api/books/')
      .then((data) => {
        setBooks(data.books);
      })
      .catch((error) => showMessage(error.message));
  }, [api, showMessage]);

  const quickPrompts = [
    'I want coding and technology books',
    'Recommend dark mystery or thriller books',
    'I like fantasy and adventure',
    'I need books for class',
    'I want something calm and romantic',
  ];

  const categoryMap = {
    adventure: ['adventure'],
    fantasy: ['fantasy'],
    mystery: ['mystery'],
    thriller: ['thriller'],
    horror: ['horror'],
    romance: ['romance'],
    drama: ['drama'],
    fiction: ['fiction'],
    education: ['education'],
    school: ['education'],
    class: ['education', 'mathematics'],
    study: ['education'],
    technology: ['technology'],
    coding: ['technology', 'education'],
    code: ['technology', 'education'],
    programming: ['technology', 'education'],
    python: ['technology', 'education'],
    java: ['technology', 'education'],
    maths: ['mathematics'],
    math: ['mathematics'],
    psychology: ['psychology'],
    mind: ['psychology'],
    science: ['science fiction', 'technology'],
  };

  const toneMap = {
    dark: ['dark', 'intense'],
    scary: ['dark', 'intense'],
    intense: ['intense'],
    suspense: ['suspense'],
    exciting: ['fast', 'exciting'],
    fast: ['fast'],
    calm: ['calm'],
    easy: ['easy'],
    light: ['easy', 'light'],
    practical: ['practical'],
    useful: ['practical'],
    emotional: ['emotional'],
    romantic: ['emotional', 'light'],
  };

  const goalMap = {
    learn: ['learn'],
    skill: ['learn'],
    class: ['class'],
    assignment: ['class'],
    exam: ['class'],
    relax: ['relax'],
    fun: ['fun'],
    challenge: ['challenge'],
  };

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function parsePreferences(text) {
    const normalized = text.toLowerCase();
    const categories = [];
    const tones = [];
    const goals = [];
    const keywords = normalized
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2)
      .slice(0, 10);

    Object.entries(categoryMap).forEach(([word, mapped]) => {
      if (normalized.includes(word)) categories.push(...mapped);
    });
    Object.entries(toneMap).forEach(([word, mapped]) => {
      if (normalized.includes(word)) tones.push(...mapped);
    });
    Object.entries(goalMap).forEach(([word, mapped]) => {
      if (normalized.includes(word)) goals.push(...mapped);
    });

    return {
      categories: unique(categories),
      tones: unique(tones),
      goals: unique(goals),
      keywords: unique(keywords),
    };
  }

  function mergeProfile(nextProfile) {
    setProfile((current) => ({
      categories: unique([...current.categories, ...nextProfile.categories]),
      tones: unique([...current.tones, ...nextProfile.tones]),
      goals: unique([...current.goals, ...nextProfile.goals]),
      keywords: unique([...current.keywords, ...nextProfile.keywords]).slice(0, 12),
    }));
  }

  function botReply(nextProfile) {
    if (!nextProfile.categories.length && !nextProfile.tones.length && !nextProfile.goals.length) {
      return 'I need a little more detail. Try telling me a genre, subject, mood, or why you need the book.';
    }

    const parts = [];
    if (nextProfile.categories.length) parts.push(`categories like ${nextProfile.categories.join(', ')}`);
    if (nextProfile.tones.length) parts.push(`a ${nextProfile.tones.join(', ')} feeling`);
    if (nextProfile.goals.length) parts.push(`a goal to ${nextProfile.goals.join(', ')}`);
    return `Got it. I will look for ${parts.join(' with ')} and rank the best available books for you.`;
  }

  function sendMessage(text = input) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const nextProfile = parsePreferences(trimmed);
    setMessages((current) => [
      ...current,
      { role: 'user', text: trimmed },
      { role: 'bot', text: botReply(nextProfile) },
    ]);
    mergeProfile(nextProfile);
    setInput('');
  }

  function resetChat() {
    setProfile({ categories: [], tones: [], goals: [], keywords: [] });
    setMessages([
      {
        role: 'bot',
        text: 'Tell me what you like reading. You can type things like: I love dark mysteries, I want books for coding, or recommend something romantic and easy.',
      },
    ]);
    setInput('');
  }

  function recommendationScore(book) {
    const category = book.category.toLowerCase();
    const text = `${book.title} ${book.author} ${book.category}`.toLowerCase();
    let score = 0;

    profile.categories.forEach((wantedCategory) => {
      if (category === wantedCategory) score += 8;
      if (category.includes(wantedCategory) || wantedCategory.includes(category)) score += 5;
    });

    profile.tones.forEach((tone) => {
      if (tone === 'dark' && ['horror', 'thriller', 'mystery', 'fantasy'].includes(category)) score += 4;
      if (tone === 'suspense' && ['thriller', 'mystery', 'horror'].includes(category)) score += 4;
      if (tone === 'fast' && ['adventure', 'thriller', 'science fiction'].includes(category)) score += 3;
      if (tone === 'calm' && ['psychology', 'romance', 'fiction'].includes(category)) score += 3;
      if (tone === 'practical' && ['education', 'technology', 'mathematics'].includes(category)) score += 4;
      if (tone === 'emotional' && ['romance', 'drama', 'fiction'].includes(category)) score += 4;
    });

    profile.goals.forEach((goal) => {
      if (goal === 'learn' && ['education', 'technology', 'mathematics'].includes(category)) score += 5;
      if (goal === 'class' && ['education', 'mathematics', 'technology'].includes(category)) score += 5;
      if (goal === 'relax' && ['romance', 'fiction', 'psychology'].includes(category)) score += 4;
      if (goal === 'fun' && ['fantasy', 'adventure', 'fiction', 'romance'].includes(category)) score += 4;
      if (goal === 'challenge' && ['science fiction', 'thriller', 'mathematics'].includes(category)) score += 4;
    });

    profile.keywords.forEach((keyword) => {
      if (text.includes(keyword)) score += 2;
    });

    if (!profile.categories.length && !profile.tones.length && !profile.goals.length) {
      score += book.has_virtual_version ? 1 : 0;
    }

    return score;
  }

  function recommendationReason(book) {
    const category = book.category.toLowerCase();
    const reasons = [];

    if (profile.categories.some((wantedCategory) => category.includes(wantedCategory))) {
      reasons.push(`matches your interest in ${category}`);
    }
    if (profile.tones.includes('dark') && ['horror', 'thriller', 'mystery', 'fantasy'].includes(category)) {
      reasons.push('fits the darker mood you described');
    }
    if (profile.tones.includes('suspense') && ['thriller', 'horror', 'mystery'].includes(category)) {
      reasons.push('has the suspense you asked for');
    }
    if (profile.goals.includes('learn') && ['education', 'technology', 'mathematics'].includes(category)) {
      reasons.push('supports your learning goal');
    }
    if (profile.goals.includes('class') && ['education', 'mathematics', 'technology'].includes(category)) {
      reasons.push('can help with academic reading');
    }
    if (profile.goals.includes('relax') && ['romance', 'fiction', 'psychology'].includes(category)) {
      reasons.push('works well for relaxed reading');
    }

    return reasons.slice(0, 2).join(' and ') || 'is available and close to your reading profile';
  }

  const recommendedBooks = [...books]
    .map((book) => ({ ...book, score: recommendationScore(book) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  const hasProfile = profile.categories.length || profile.tones.length || profile.goals.length;
  const profileChips = unique([...profile.categories, ...profile.tones, ...profile.goals]).slice(0, 10);
  const confidence = Math.min(100, Math.max(15, profileChips.length * 14));

  return (
    <section className="recommendations-page">
      <div className="recommendations-hero">
        <div className="page-hero-copy">
          <p className="eyebrow">Book Recommendations</p>
          <h2>Chat with your personal reading advisor.</h2>
          <p>Type what you love, what you need, or what mood you want. The advisor will shape recommendations around you.</p>
        </div>
        <img className="shared-hero-art" src={libraryBooks} alt="A colorful stack of library books" />
      </div>
      <div className="recommendation-chat">
        <div className="advisor-topline">
          <div>
            <p className="eyebrow">Reading Advisor</p>
            <h3>{hasProfile ? 'Live reading profile' : 'Start the conversation'}</h3>
          </div>
          <span>{confidence}% match confidence</span>
        </div>
        <div className="progress-track">
          <div style={{ width: `${confidence}%` }} />
        </div>
        <div className="chat-window">
          {messages.map((message, index) => (
            <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
              <span>{message.role === 'bot' ? 'Library Bot' : 'You'}</span>
              <p>{message.text}</p>
            </div>
          ))}
        </div>
        <form className="chat-input" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Type what you love reading..."
          />
          <button type="submit" className="primary">Send</button>
        </form>
        <div className="chat-options">
          {quickPrompts.map((prompt) => (
            <button type="button" key={prompt} onClick={() => sendMessage(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
        <div className="chat-actions">
          <button type="button" onClick={resetChat}>Reset advisor</button>
        </div>
      </div>
      {hasProfile && (
        <div className="reader-profile">
          {profileChips.map((chip) => <span key={chip}>{chip}</span>)}
        </div>
      )}
      <div className="book-grid">
        {recommendedBooks.map((book) => (
          <article className="book-card recommendation-card" key={book.id}>
            <div className="book-3d"><img className="book-cover" src={getBookImage(book)} alt={`${book.title} cover`} loading="lazy" /></div>
            <div>
              <h3>{book.title}</h3>
              <p>{book.author}</p>
              <span>{book.category} · Read online</span>
              <small className="match-score">{book.score > 0 ? `${book.score} match points` : 'Popular available title'}</small>
              <small className="recommendation-reason">Recommended because it {recommendationReason(book)}.</small>
            </div>
            <button type="button" onClick={() => setReaderBook(book)}>Read Book</button>
          </article>
        ))}
      </div>
      {readerBook && <BookReader api={api} book={readerBook} onClose={() => setReaderBook(null)} showMessage={showMessage} />}
    </section>
  );
}

function BookBrowser({ api, canRead, showMessage, categoryId = '', authorId = '', initialQuery = '' }) {
  const [books,setBooks]=useState([]),[categories,setCategories]=useState([]),[selectedCategory,setSelectedCategory]=useState(categoryId),[query,setQuery]=useState(initialQuery),[language,setLanguage]=useState(''),[yearMin,setYearMin]=useState(''),[yearMax,setYearMax]=useState(''),[sort,setSort]=useState('title'),[page,setPage]=useState(0),[total,setTotal]=useState(0),[pages,setPages]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState(null),[readerBook,setReaderBook]=useState(null);
  useEffect(()=>{api.get('/api/reader/categories/').then(data=>setCategories(data.categories)).catch(()=>{});},[api]);
  const load=useCallback(async(nextPage=page)=>{setBusy(true);setError('');const params=new URLSearchParams({page:String(nextPage),sort});if(query.trim())params.set('q',query.trim());if(selectedCategory)params.set('category',selectedCategory);if(authorId)params.set('author',authorId);if(language.trim())params.set('language',language.trim());if(yearMin)params.set('year_min',yearMin);if(yearMax)params.set('year_max',yearMax);try{const data=await api.get(`/api/books/?${params}`);setBooks(data.books);setTotal(data.total);setPages(data.pages);setPage(data.page);}catch(err){setError(err.message);showMessage(err.message);}finally{setBusy(false);}},[api,page,sort,query,selectedCategory,authorId,language,yearMin,yearMax,showMessage]);
  useEffect(()=>{const timer=window.setTimeout(()=>load(page),query?250:0);return()=>window.clearTimeout(timer);},[load,page,query]);
  function clearFilters(){setQuery('');setSelectedCategory('');setLanguage('');setYearMin('');setYearMax('');setSort('title');setPage(0);}
  return <section className="books-page">
    <div className="books-hero"><div className="page-hero-copy"><p className="eyebrow">Explore Library</p><h2>Find a book to read online.</h2><p>Search and filter the published digital collection.</p></div><img className="shared-hero-art" src={libraryBooks} alt="A colorful stack of library books"/></div>
    <form className="panel catalogue-filters" onSubmit={event=>{event.preventDefault();setPage(0);}}><label>Search books<input aria-label="Search books" placeholder="Title, author, subject, keywords" value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}}/></label><label>Category<select value={selectedCategory} onChange={event=>{setSelectedCategory(event.target.value);setPage(0);}}><option value="">All categories</option>{categories.map(item=><option key={item.id} value={item.id}>{item.name} ({item.book_count})</option>)}</select></label><label>Language<input placeholder="Any language" value={language} onChange={event=>{setLanguage(event.target.value);setPage(0);}}/></label><label>Year from<input type="number" min="1000" max="3000" value={yearMin} onChange={event=>{setYearMin(event.target.value);setPage(0);}}/></label><label>Year to<input type="number" min="1000" max="3000" value={yearMax} onChange={event=>{setYearMax(event.target.value);setPage(0);}}/></label><label>Sort by<select value={sort} onChange={event=>{setSort(event.target.value);setPage(0);}}><option value="title">Title</option><option value="author">Author</option><option value="newest">Newest</option><option value="popular">Popular</option></select></label><button className="primary" type="submit">Search</button><button type="button" className="secondary" onClick={clearFilters}>Clear filters</button></form>
    <div className="section-heading section-heading-row"><h2>{authorId?'Books by selected author':selectedCategory?categories.find(item=>String(item.id)===String(selectedCategory))?.name||'Category':'Books'}</h2><span>{total} published books</span></div>
    {busy?<p className="loading-state">Loading books…</p>:error?<div className="empty-state"><p>We couldn’t load the catalogue.</p><button className="secondary" onClick={()=>load(page)}>Try again</button></div>:books.length?<><div className="book-grid">{books.map(book=><article className="book-card" key={book.id}><button type="button" className="book-cover-button" onClick={()=>setSelected(book)} aria-label={`View ${book.title} details`}><img className="book-cover" src={getBookImage(book)} alt={`${book.title} cover`} loading="lazy"/></button><div><button className="book-title-link" type="button" onClick={()=>setSelected(book)}><h3>{book.title}</h3></button><p>{book.author}</p>{book.category&&<span>{book.category}</span>}{book.publication_year&&<small>{book.publication_year}</small>}<span className="format-badge virtual-badge">{book.virtual_file_type==='application/pdf'?'PDF':'Text'} · Read online</span></div><div className="book-actions"><button type="button" className="secondary" onClick={()=>setSelected(book)}>Details</button>{canRead&&<button type="button" className="primary" onClick={()=>setReaderBook(book)}>Read</button>}</div></article>)}</div><div className="pagination"><span>Page {page+1} of {Math.max(1,pages)}</span><button className="secondary" disabled={page===0} onClick={()=>setPage(page-1)}>Previous</button><button className="secondary" disabled={page+1>=pages} onClick={()=>setPage(page+1)}>Next</button></div></>:<p className="empty-state">No published books match these filters. Clear a filter or try another search.</p>}
    {selected&&<BookDetails api={api} book={selected} books={books} onRead={book=>{setSelected(null);setReaderBook(book);}} onClose={()=>setSelected(null)} showMessage={showMessage}/>}
    {readerBook&&<BookReader api={api} book={readerBook} onClose={()=>{setReaderBook(null);load(page);}} showMessage={showMessage}/>}
  </section>;
}

function CategoryBrowser({api,setView,showMessage}){
  const [categories,setCategories]=useState([]),[busy,setBusy]=useState(true);
  useEffect(()=>{api.get('/api/reader/categories/').then(data=>setCategories(data.categories)).catch(error=>showMessage(error.message)).finally(()=>setBusy(false));},[api,showMessage]);
  return <section className="panel admin-section"><div className="section-heading"><p className="eyebrow">Explore by subject</p><h2>Categories</h2><p>Browse published digital books by category.</p></div>{busy?<p className="loading-state">Loading categories…</p>:categories.length?<div className="category-reader-grid">{categories.map(category=><button type="button" className="data-card category-reader-card" key={category.id} onClick={()=>setView(`category-${category.id}`)}><strong>{category.name}</strong><span>{category.book_count} {category.book_count===1?'book':'books'}</span>{category.description&&<small>{category.description}</small>}</button>)}</div>:<p className="empty-state">There are no categories in the published collection yet.</p>}</section>;
}

function AuthorBrowser({api,setView,showMessage}){
  const [authors,setAuthors]=useState([]),[busy,setBusy]=useState(true),[query,setQuery]=useState('');
  useEffect(()=>{api.get('/api/reader/authors/').then(data=>setAuthors(data.authors)).catch(error=>showMessage(error.message)).finally(()=>setBusy(false));},[api,showMessage]);
  const shown=authors.filter(author=>author.name.toLowerCase().includes(query.toLowerCase()));
  return <section className="panel admin-section"><div className="section-heading"><p className="eyebrow">Writers in the collection</p><h2>Authors</h2><p>Explore books by their recorded authors.</p></div><label className="author-search">Search authors<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Author name"/></label>{busy?<p className="loading-state">Loading authors…</p>:shown.length?<div className="category-reader-grid">{shown.map(author=><button type="button" className="data-card category-reader-card" key={author.id} onClick={()=>setView(`author-${author.id}`)}><strong>{author.name}</strong><span>{author.book_count} {author.book_count===1?'published book':'published books'}</span>{author.biography&&<small>{author.biography}</small>}</button>)}</div>:<p className="empty-state">No authors match your search.</p>}</section>;
}

function ReaderLibraryList({api,kind,showMessage}){
  const [items,setItems]=useState([]),[busy,setBusy]=useState(true),[readerBook,setReaderBook]=useState(null),[clearing,setClearing]=useState(false);
  const endpoint=kind==='favourites'?'/api/reader/favourites/':'/api/reader/history/';
  const load=useCallback(()=>{setBusy(true);return api.get(endpoint).then(data=>setItems(kind==='favourites'?data.favourites:data.history)).catch(error=>showMessage(error.message)).finally(()=>setBusy(false));},[api,endpoint,kind,showMessage]);useEffect(()=>{load();},[load]);
  async function remove(book){try{await api.delete(`/api/reader/books/${book.id}/favourite/`);await load();showMessage('Removed from favourites.');}catch(error){showMessage(error.message);}}
  async function clearHistory(){if(!window.confirm('Clear your personal recently read list and reading activity? This also removes your open events from library analytics.'))return;setClearing(true);try{await api.delete('/api/reader/history/');setItems([]);showMessage('Your reading history was cleared.');}catch(error){showMessage(error.message);}finally{setClearing(false);}}
  return <section className="panel admin-section"><div className="section-heading section-heading-row"><div><p className="eyebrow">Your library</p><h2>{kind==='favourites'?'My Favourites':'Recently Read'}</h2><p>{kind==='favourites'?'Books you have saved for later.':'Books you have opened recently, with your last saved page.'}</p></div>{kind==='history'&&<button className="danger" disabled={clearing||!items.length} onClick={clearHistory}>{clearing?'Clearing…':'Clear history'}</button>}</div>{busy?<p className="loading-state">Loading your {kind==='favourites'?'favourites':'reading history'}…</p>:items.length?<div className="reader-list">{items.map((item,index)=>item.book?<article className="reader-list-row" key={item.book.id}><img src={getBookImage(item.book)} alt=""/><div><strong>{item.book.title}</strong><span>{item.book.author}</span><small>{kind==='favourites'?`Saved ${new Date(item.created_at).toLocaleDateString()}`:`Last opened ${new Date(item.last_opened_at).toLocaleString()}${item.last_page?` · Page ${item.last_page}`:''}`}</small></div><button className="primary" onClick={()=>setReaderBook(item.book)}>Read</button>{kind==='favourites'&&<button className="secondary" onClick={()=>remove(item.book)}>Remove</button>}</article>:<article className="reader-list-row unavailable-row" key={`${kind}-unavailable-${index}`}><div><strong>This book is no longer available</strong><span>It may have been unpublished or archived by the library.</span></div>{kind==='favourites'&&<button className="secondary" onClick={async()=>{try{await api.delete(`/api/reader/books/${item.book_id}/favourite/`);await load();}catch(error){showMessage(error.message);}}}>Remove</button>}</article>)}</div>:<p className="empty-state">{kind==='favourites'?'You have not saved any favourites yet.':'Books you open will appear here.'}</p>}{readerBook&&<BookReader api={api} book={readerBook} onClose={()=>{setReaderBook(null);load();}} showMessage={showMessage}/>}</section>;
}

function BookDetails({api,book,books,onRead,onClose,showMessage}){
  const [state,setState]=useState(null),[related,setRelated]=useState([]),[busy,setBusy]=useState(true);
  useEffect(()=>{Promise.all([api.get(`/api/reader/books/${book.id}/state/`),book.category_id?api.get(`/api/books/?category=${book.category_id}&limit=5`):Promise.resolve({books:[]})]).then(([readerState,relatedBooks])=>{setState(readerState);setRelated(relatedBooks.books.filter(item=>item.id!==book.id).slice(0,4));}).catch(error=>showMessage(error.message)).finally(()=>setBusy(false));},[api,book.id,book.category_id,showMessage]);
  async function toggleFavourite(){try{if(state?.favourite){await api.delete(`/api/reader/books/${book.id}/favourite/`);setState({...state,favourite:false});showMessage('Removed from favourites.');}else{await api.post(`/api/reader/books/${book.id}/favourite/`);setState({...state,favourite:true});showMessage('Added to favourites.');}}catch(error){showMessage(error.message);}}
  const metadata=[['Category',book.category],['Publication year',book.publication_year],['Publisher',book.publisher],['ISBN',book.isbn],['Language',book.language],['Format',book.virtual_file_type==='application/pdf'?'PDF':book.virtual_file_type==='text/plain'?'Text':null],['File size',book.file_size?formatBytes(book.file_size):null]];
  return <div className="reader-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="panel book-details-modal" role="dialog" aria-modal="true" aria-labelledby="book-details-title"><button className="secondary modal-close" onClick={onClose}>Close</button><div className="book-details-layout"><img className="book-details-cover" src={getBookImage(book)} alt={`${book.title} cover`}/><div><p className="eyebrow">Book details</p><h2 id="book-details-title">{book.title}</h2><p className="book-detail-author">{book.author}</p>{book.description&&<p className="book-description">{book.description}</p>}<dl className="book-metadata">{metadata.filter(([,value])=>value!==null&&value!==undefined&&String(value).trim()!=='').map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{book.tags?.length>0&&<div className="tag-list">{book.tags.map(tag=><span key={tag}>{tag}</span>)}</div>}<div className="book-actions"><button className="primary" onClick={()=>onRead(book)}>Read Book</button><button className="secondary" disabled={busy||!state} onClick={toggleFavourite}>{state?.favourite?'♥ Saved':'♡ Add to favourites'}</button></div>{state?.progress&&<small>Continue from page {state.progress.page}.</small>}</div></div>{related.length>0&&<div className="related-books"><h3>Related books in {book.category}</h3>{related.map(item=><button key={item.id} onClick={()=>onRead(item)}>{item.title}<span>{item.author}</span></button>)}</div>}</section></div>;
}

function BookReader({api,book,onClose,showMessage}){
  const [text,setText]=useState(''),[pdfData,setPdfData]=useState(null),[page,setPage]=useState(1),[pageCount,setPageCount]=useState(0),[zoom,setZoom]=useState(1),[fitMode,setFitMode]=useState('width'),[state,setState]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[theme,setTheme]=useState(()=>localStorage.getItem('reader-theme')||'light');const readerRef=React.useRef(null);const isPdf=book.virtual_file_type==='application/pdf',isText=book.virtual_file_type==='text/plain';const pages=isText?(text.match(/[\s\S]{1,3200}/g)||['']):[];
  const onPdfPageCount=useCallback(count=>{setPageCount(count);setPage(current=>Math.min(Math.max(1,current),count));},[]);
  useEffect(()=>{let active=true;setBusy(true);setError('');setPdfData(null);setPageCount(0);const content=isText?api.get(`/api/books/${book.id}/read/`):isPdf?fetch(`/api/books/${book.id}/content/`,{credentials:'include'}).then(async response=>{if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'The stored PDF could not be opened.');}const blob=await response.blob();const signature=new Uint8Array(await blob.slice(0,5).arrayBuffer());if(String.fromCharCode(...signature)!=='%PDF-')throw new Error('The stored file is not a readable PDF.');const tail=await blob.slice(Math.max(0,blob.size-4096)).text();if(!tail.includes('%%EOF'))throw new Error('This PDF appears incomplete. Ask library staff to replace the file.');return {pdfData:new Uint8Array(await blob.arrayBuffer())};}):Promise.resolve(null);Promise.all([api.get(`/api/reader/books/${book.id}/state/`),content]).then(([readerState,file])=>{if(!active)return;setState(readerState);const savedPage=readerState.progress?.page||1;if(isText&&file){setText(file.text);setPage(Math.min(Math.max(1,Math.ceil(file.text.length/3200)||1),savedPage));}else setPage(savedPage);if(isPdf&&file?.pdfData)setPdfData(file.pdfData);return (isPdf||isText)?api.post(`/api/books/${book.id}/open/`):null;}).catch(err=>{if(active)setError(err.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[api,book.id,isPdf,isText,refresh]);
  useEffect(()=>{if(busy||error||!state)return;const timer=window.setTimeout(()=>api.put(`/api/reader/books/${book.id}/progress/`,{location:{page}}).catch(err=>showMessage(err.message)),650);return()=>window.clearTimeout(timer);},[api,book.id,page,busy,error,state,showMessage]);
  useEffect(()=>{localStorage.setItem('reader-theme',theme);},[theme]);
  useEffect(()=>{const handler=event=>{if(event.target instanceof HTMLElement&&['INPUT','TEXTAREA','SELECT','BUTTON'].includes(event.target.tagName))return;if(event.key==='ArrowRight')setPage(value=>value+1);if(event.key==='ArrowLeft')setPage(value=>Math.max(1,value-1));};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[]);
  async function toggleFavourite(){try{if(state.favourite){await api.delete(`/api/reader/books/${book.id}/favourite/`);setState({...state,favourite:false});showMessage('Removed from favourites.');}else{await api.post(`/api/reader/books/${book.id}/favourite/`);setState({...state,favourite:true});showMessage('Added to favourites.');}}catch(err){showMessage(err.message);}}
  async function addBookmark(){const name=window.prompt('Name this bookmark (optional):','');if(name===null)return;try{const result=await api.post(`/api/reader/books/${book.id}/bookmarks/`,{name,location:{page}});setState({...state,bookmarks:[result.bookmark,...(state.bookmarks||[])]});showMessage('Bookmark saved.');}catch(err){showMessage(err.message);}}
  async function removeBookmark(id){try{await api.delete(`/api/reader/bookmarks/${id}/`);setState({...state,bookmarks:state.bookmarks.filter(item=>item.id!==id)});showMessage('Bookmark removed.');}catch(err){showMessage(err.message);}}
  async function renameBookmark(mark){const name=window.prompt('Bookmark name:',mark.name||'');if(name===null)return;try{const result=await api.put(`/api/reader/bookmarks/${mark.id}/`,{name});setState({...state,bookmarks:state.bookmarks.map(item=>item.id===mark.id?result.bookmark:item)});showMessage('Bookmark updated.');}catch(err){showMessage(err.message);}}
  return <div className={`reader-modal-backdrop reader-backdrop-${theme}`}><section ref={readerRef} className={`panel book-reader reader-theme-${theme}`} aria-label={`Reading ${book.title}`}><div className="reader-header"><div><p className="eyebrow">Read Online</p><h2>{book.title}</h2><p>{book.author}</p></div><div className="book-actions"><button type="button" className="secondary" onClick={toggleFavourite} disabled={!state}>{state?.favourite?'♥ Favourite':'♡ Favourite'}</button><button type="button" className="secondary" onClick={()=>setTheme(theme==='light'?'dark':'light')}>Use {theme==='light'?'dark':'light'} theme</button><button type="button" className="secondary" onClick={onClose}>Back to book</button></div></div>
    {busy?<p className="loading-state">Opening your book…</p>:error?<div className="reader-error" role="alert"><h3>Unable to open this book</h3><p>{error}</p><button className="primary" onClick={()=>setRefresh(value=>value+1)}>Retry</button><button className="secondary" onClick={onClose}>Back to catalogue</button></div>:!isPdf&&!isText?<div className="reader-error"><h3>Unsupported file format</h3><p>This library currently supports PDF and plain text books. This file is marked as {book.virtual_file_type||'unknown format'}.</p></div>:<>
      {isPdf?<><div className="reader-toolbar"><button type="button" className="secondary" disabled={page<=1} onClick={()=>setPage(value=>Math.max(1,value-1))}>Previous page</button><label className="reader-page-control">Page<input type="number" min="1" max={pageCount||undefined} value={page} onChange={event=>setPage(Math.min(pageCount||100000,Math.max(1,Number(event.target.value)||1)))}/><span>of {pageCount||'…'}</span></label><button type="button" className="secondary" disabled={pageCount>0&&page>=pageCount} onClick={()=>setPage(value=>Math.min(pageCount||100000,value+1))}>Next page</button><button type="button" className="secondary" onClick={()=>{setFitMode(null);setZoom(value=>Math.max(.5,Number((value-.1).toFixed(1))));}} aria-label="Zoom out">−</button><span>{fitMode?`Fit ${fitMode}`:`${Math.round(zoom*100)}%`}</span><button type="button" className="secondary" onClick={()=>{setFitMode(null);setZoom(value=>Math.min(3,Number((value+.1).toFixed(1))));}} aria-label="Zoom in">+</button><button type="button" className="secondary" onClick={()=>setFitMode('width')}>Fit width</button><button type="button" className="secondary" onClick={()=>setFitMode('page')}>Fit page</button><button type="button" className="secondary" onClick={()=>readerRef.current?.requestFullscreen?.()}>Full screen</button></div>{pdfData&&<React.Suspense fallback={<p className="loading-state">Starting the PDF reader…</p>}><ReaderPdfDocument bytes={pdfData} page={page} zoom={zoom} fitMode={fitMode} onPageCount={onPdfPageCount} onPageChange={setPage} onError={setError}/></React.Suspense>}</>:<><div className="reader-toolbar"><button type="button" className="secondary" disabled={page<=1} onClick={()=>setPage(value=>Math.max(1,value-1))}>Previous page</button><label className="reader-page-control">Page<input type="number" min="1" max={pages.length} value={page} onChange={event=>setPage(Math.min(pages.length||1,Math.max(1,Number(event.target.value)||1)))}/><span>of {Math.max(1,pages.length)}</span></label><button type="button" className="secondary" disabled={page>=pages.length} onClick={()=>setPage(value=>value+1)}>Next page</button><button type="button" className="secondary" onClick={()=>setZoom(value=>Math.max(.7,Number((value-.1).toFixed(1))))} aria-label="Zoom out">−</button><span>{Math.round(zoom*100)}%</span><button type="button" className="secondary" onClick={()=>setZoom(value=>Math.min(1.8,Number((value+.1).toFixed(1))))} aria-label="Zoom in">+</button><button type="button" className="secondary" onClick={()=>readerRef.current?.requestFullscreen?.()}>Full screen</button><button type="button" className="secondary" onClick={()=>setRefresh(value=>value+1)}>Reload book</button></div><article className="text-reader-page" style={{fontSize:`${zoom}rem`}}>{pages[page-1]||'This page has no text.'}</article></>}
      <div className="reader-bookmarks"><div className="section-heading section-heading-row"><h3>Bookmarks</h3><button className="secondary" onClick={addBookmark}>Save this page</button></div>{state?.bookmarks?.length?state.bookmarks.map(mark=><div className="bookmark-row" key={mark.id}><button className="link-button" onClick={()=>setPage(mark.location.page)}>{mark.name||`Page ${mark.location.page}`}</button><span>Page {mark.location.page}</span><button className="link-button" onClick={()=>renameBookmark(mark)}>Rename</button><button className="link-button" onClick={()=>removeBookmark(mark.id)}>Remove</button></div>):<p className="empty-state">Save a page to find it again later.</p>}</div>
    </>}
    <div className="reader-footer"><small>Reading position saves automatically for your account.</small><button type="button" className="secondary" onClick={onClose}>Close Reader</button></div></section></div>;
}

function BookManager({ api, showMessage, startNew = false }) {
  const [editing,setEditing]=useState({...emptyBook}),[virtualFile,setVirtualFile]=useState(null),[coverFile,setCoverFile]=useState(null),[booksKey,setBooksKey]=useState(0),[options,setOptions]=useState({categories:[],authors:[]}),[progress,setProgress]=useState(null),[preview,setPreview]=useState(false),[checking,setChecking]=useState(false),[saving,setSaving]=useState(false);
  useEffect(()=>{Promise.all([api.get('/api/admin/categories/'),api.get('/api/admin/authors/')]).then(([categories,authors])=>setOptions({categories:categories.categories.filter(item=>item.is_active),authors:authors.authors})).catch(error=>showMessage(error.message));},[api,showMessage]);
  useEffect(()=>{if(startNew)setEditing({...emptyBook});},[startNew]);

  async function saveBook(event){event.preventDefault();if(saving)return;if(virtualFile&&(!['application/pdf','text/plain'].includes(virtualFile.type)||virtualFile.size>50*1024*1024))return showMessage('Select a PDF or TXT file smaller than 50 MB.');if(coverFile&&(!['image/jpeg','image/png','image/webp'].includes(coverFile.type)||coverFile.size>25*1024*1024))return showMessage('Select a JPEG, PNG, or WEBP cover smaller than 25 MB.');
    setSaving(true);setProgress(virtualFile||coverFile?0:null);try{const tags=Array.isArray(editing.tags)?editing.tags:String(editing.tags||'').split(',').map(tag=>tag.trim()).filter(Boolean);const desiredStatus=virtualFile?'published':editing.status;const payload={...editing,tags,status:virtualFile?'draft':(editing.status==='published'&&!editing.id?'draft':editing.status)};delete payload.id;delete payload.has_virtual_version;delete payload.has_cover;delete payload.cover_url;delete payload.virtual_file_name;delete payload.virtual_file_type;
      let saved=editing.id?await api.put(`/api/books/${editing.id}/`,payload):await api.post('/api/books/',payload);let book=saved.book;
      // Keep the saved database record in the form before uploading. If Storage is
      // temporarily unavailable, the next save updates this record instead of
      // creating a second book and the selected PDF remains available for retry.
      setEditing({...editing,...book,status:desiredStatus});
      if(virtualFile){const uploaded=await api.upload(`/api/admin/books/${book.id}/virtual-file/?filename=${encodeURIComponent(virtualFile.name)}`,virtualFile,setProgress);book=uploaded.book;}
      if(coverFile){const resizedCover=await resizeBookCover(coverFile);await api.upload(`/api/admin/books/${book.id}/cover/`,resizedCover);book={...book,has_cover:true,cover_url:`/api/books/${book.id}/cover/`};}
      if(book.status!==desiredStatus){const publishPayload={...payload,status:desiredStatus};book=(await api.put(`/api/books/${book.id}/`,publishPayload)).book;}
      showMessage(`${book.status==='published'?'Book published and ready for online reading':book.status==='archived'?'Book archived':'Book saved as a draft'}.`);setEditing({...emptyBook});setVirtualFile(null);setCoverFile(null);setProgress(null);setBooksKey(key=>key+1);
    }catch(error){showMessage(error.message);}finally{setProgress(null);setSaving(false);}}

  async function removeVirtualVersion(){if(!window.confirm('Remove this digital file? Readers will no longer be able to open the book until a new file is uploaded.'))return;try{const result=await api.delete(`/api/admin/books/${editing.id}/virtual-file/`);setEditing({...editing,...result.book});showMessage('Digital file removed.');setBooksKey(key=>key+1);}catch(error){showMessage(error.message);}}
  async function archiveBook(book){const archiving=book.status!=='archived';if(!window.confirm(archiving?`Archive “${book.title}”? It will disappear from the reader catalogue, while its audit and reading records remain.`:`Restore “${book.title}” as a draft? It will stay hidden until published.`))return;try{await api.put(`/api/books/${book.id}/`,{...book,status:archiving?'archived':'draft'});showMessage(archiving?'Book archived.':'Book restored as a draft.');setBooksKey(key=>key+1);}catch(error){showMessage(error.message);}}
  async function validateFile(){if(!editing.id)return;setChecking(true);try{const result=await api.get(`/api/admin/books/${editing.id}/validate/`);setEditing(result.book);showMessage(result.valid?'The digital book opened successfully and is validated.':`Validation failed: ${Object.entries(result.checks).filter(([,ok])=>!ok).map(([key])=>key).join(', ')}`);}catch(error){showMessage(error.message);}finally{setChecking(false);}}
  const [featuredPreview,setFeaturedPreview]=useState(false);
  return <div className="split admin-book-layout">
    <form className="panel form-grid book-editor" onSubmit={saveBook}>
      <div className="section-heading"><p className="eyebrow">Digital collection</p><h2>{editing.id?'Edit book':'Add new book'}</h2><p>Uploading a valid PDF or TXT publishes it for signed-in members. Books without a file stay private drafts.</p></div>
      <label>Book title<input maxLength="240" value={editing.title||''} onChange={e=>setEditing({...editing,title:e.target.value})} required/></label>
      <label>Author or authors<small>Choose existing author records; create a new author from the Authors section.</small><select multiple size="4" value={(editing.author_ids||[]).map(String)} onChange={e=>{const ids=[...e.target.selectedOptions].map(option=>Number(option.value));const names=options.authors.filter(author=>ids.includes(author.id)).map(author=>author.name);setEditing({...editing,author_ids:ids,author_id:ids[0]||'',author:names.join(', ')});}}>{options.authors.map(author=><option key={author.id} value={author.id}>{author.name}</option>)}</select>{options.authors.length===0&&<input aria-label="Author name" placeholder="Author name" value={editing.author||''} onChange={e=>setEditing({...editing,author:e.target.value})} required/>}</label>
      <div className="form-grid two-field-grid"><label>Category / genre<select value={editing.category_id||''} onChange={e=>{const item=options.categories.find(category=>String(category.id)===e.target.value);setEditing({...editing,category_id:e.target.value,category:item?.name||''});}}><option value="">Choose category</option>{options.categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Publication year<input type="number" min="1000" max={new Date().getFullYear()+1} value={editing.publication_year||''} onChange={e=>setEditing({...editing,publication_year:e.target.value})}/></label><label>ISBN (optional)<input value={editing.isbn||''} onChange={e=>setEditing({...editing,isbn:e.target.value})}/></label><label>Publisher<input value={editing.publisher||''} onChange={e=>setEditing({...editing,publisher:e.target.value})}/></label><label>Language<input value={editing.language||''} onChange={e=>setEditing({...editing,language:e.target.value})}/></label><label>Tags / keywords<input value={Array.isArray(editing.tags)?editing.tags.join(', '):editing.tags||''} onChange={e=>setEditing({...editing,tags:e.target.value})} placeholder="history, local, education"/></label></div>
      <label>Description / summary<textarea rows="5" maxLength="6000" value={editing.description||''} onChange={e=>setEditing({...editing,description:e.target.value})}/></label>
      <div className="form-grid two-field-grid"><label>Publication status<select value={editing.status||'draft'} onChange={e=>setEditing({...editing,status:e.target.value})}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label><label className="check-label"><input type="checkbox" checked={Boolean(editing.is_featured)} onChange={e=>setEditing({...editing,is_featured:e.target.checked})}/> Featured in catalogue</label></div>
      <label>Digital book file (PDF or TXT)<input type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={e=>setVirtualFile(e.target.files?.[0]||null)}/><small>Maximum 50 MB. Files are stored privately and streamed to signed-in readers.</small></label>
      {virtualFile&&<div className="upload-progress"><span>{virtualFile.name} · {formatBytes(virtualFile.size)}</span><progress max="100" value={progress??0}/><small>{progress==null?'Ready to upload':`${progress}% uploaded`}</small></div>}
      {editing.id&&editing.has_virtual_version&&<div className="virtual-file-current"><span>Digital file: {editing.virtual_file_name||'Stored file'} · {formatBytes(editing.file_size)}</span><div className="button-row"><button type="button" className="secondary" onClick={validateFile} disabled={checking}>{checking?'Checking…':'Validate file'}</button><button type="button" className="danger" onClick={removeVirtualVersion}>Remove file</button></div><small>{editing.validated_at?`Last validated ${new Date(editing.validated_at).toLocaleString()}`:'Not yet validated'}</small></div>}
      <label>Cover image (JPEG, PNG, or WEBP)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setCoverFile(e.target.files?.[0]||null)}/><small>Optional. Images up to 25 MB are resized automatically before upload.</small></label>
      {(coverFile||editing.cover_url)&&<img className="book-cover-preview" src={coverFile?URL.createObjectURL(coverFile):editing.cover_url} alt="Book cover preview"/>}
      <div className="button-row"><button className="primary" type="submit" disabled={saving}>{saving?'Saving…':'Save book'}</button>{editing.id&&editing.has_virtual_version&&<button type="button" className="secondary" onClick={()=>setFeaturedPreview(true)}>Preview book</button>}{editing.id&&<button type="button" className="secondary" onClick={()=>{setEditing({...emptyBook});setVirtualFile(null);setCoverFile(null);}}>New book</button>}</div>
    </form>
    {!startNew&&<ManagedBookList key={booksKey} api={api} onEdit={book=>{setEditing({...emptyBook,...book,tags:(book.tags||[]).join(', ')});setVirtualFile(null);setCoverFile(null);}} onDelete={archiveBook} showMessage={showMessage}/>}
    {featuredPreview&&<BookReader api={api} book={editing} onClose={()=>setFeaturedPreview(false)} showMessage={showMessage}/>}
  </div>;
}

function ManagedBookList({ api, onEdit, onDelete, showMessage }) {
  const [books, setBooks] = useState([]);

  useEffect(() => {
    api.get('/api/books/?include_unreadable=1').then((data) => setBooks(data.books)).catch((error) => showMessage(error.message));
  }, [api, showMessage]);

  return (
    <section className="panel">
      <h2>Manage Books</h2>
      <div className="table">
        {books.map((book) => (
          <div className="row" key={book.id}>
            <span>{book.title}</span>
            <span>{book.author}</span>
            <span>{book.has_virtual_version ? 'Readable online' : 'No digital file'}</span>
            <button type="button" onClick={() => onEdit(book)}>Edit</button>
            <button type="button" className="danger" onClick={() => onDelete(book)}>{book.status==='archived'?'Restore':'Archive'}</button>
          </div>
        ))}
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
