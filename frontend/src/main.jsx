import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeSVG } from 'qrcode.react';
import libraryBooks from './library-books.svg';
import './styles.css';

const emptyBook = {
  title: '',
  author: '',
  isbn: '',
  category: '',
  quantity: 1,
  available_copies: 1,
};

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
    response = await fetch(path, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
        ...(options.headers || {}),
      },
      ...options,
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
    upload: (path, file) => request(path, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file }, csrfToken),
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
            {user.role === 'user' && <NotificationBell api={api} openNotifications={() => navigateView('notifications')} />}
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
          <small>Sign in to find books, manage loans, and pick up where you left off.</small>
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
        <p>This library was created for Rustenburg communities whose local libraries relied on manual systems to manage books and borrowing. It brings those services into one easier-to-use place, helping readers discover books, borrow and return them, and keep track of their loans.</p>
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

  async function submit(event) {
    event.preventDefault();
    try {
      const data = mode === 'register'
        ? await api.post('/api/register/', form)
        : await api.post('/api/login/', { ...form, role });
      if (data.csrfToken) {
        setCsrfToken(data.csrfToken);
      }
      setUser(data.user);
      setView('dashboard');
      resetHistory({ type: 'view', value: 'dashboard' });
      showMessage('Signed in successfully.');
    } catch (error) {
      showMessage(error.message);
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-copy">
        <button type="button" className="link-button" onClick={() => setAuthScreen('entry')}>Back to portal</button>
        <div className="auth-copy-layout">
          <div className="auth-copy-text">
            <p className="eyebrow">{mode === 'register' ? 'A new chapter starts here' : role === 'admin' ? 'Library team' : 'Welcome back'}</p>
            <h2>{mode === 'register' ? 'Make yourself at home.' : role === 'admin' ? 'Good to see you.' : 'Ready for your next read?'}</h2>
            <p>
              {mode === 'register'
                ? 'Create your account and start exploring the collection.'
                : role === 'admin'
                  ? 'Sign in to care for the collection and support your readers.'
                  : 'Sign in to browse books and pick up where you left off.'}
            </p>
          </div>
          <img className="auth-art" src={libraryBooks} alt="" />
        </div>
      </div>
      <form className="panel auth-form" onSubmit={submit}>
        <h3>{mode === 'register' ? 'Join the library' : role === 'admin' ? 'Staff sign in' : 'Sign in'}</h3>
        <label>
          Username
          <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
        </label>
        {mode === 'register' && (
          <label>
            Email
            <input type="text" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </label>
        )}
        <label>
          Password
          <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
        </label>
        <button className="primary" type="submit">{mode === 'register' ? 'Create account' : 'Sign in'}</button>
        {mode === 'register' ? (
          <p className="auth-switch">Already have an account? <button type="button" onClick={() => setAuthScreen('login-user')}>Login</button></p>
        ) : role === 'user' ? (
          <>
            <p className="auth-switch"><button type="button" onClick={() => setAuthScreen('password-reset')}>Forgot password?</button></p>
            <p className="auth-switch">Do not have an account? <button type="button" onClick={() => setAuthScreen('signup')}>Register</button></p>
          </>
        ) : null}
      </form>
    </section>
  );
}

function PasswordResetPanel({ api, setAuthScreen, showMessage }) {
  const [step, setStep] = useState('request');
  const [form, setForm] = useState({ username: '', email: '', code: '', password: '' });
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
            <p>{step === 'request' ? 'Enter your account details to request a one-time reset code.' : 'Enter the one-time code and choose a new password.'}</p>
          </div>
          <img className="auth-art" src={libraryBooks} alt="" />
        </div>
      </div>
      {step === 'request' ? (
        <form className="panel auth-form" onSubmit={requestCode}>
          <h3>Request reset code</h3>
          <label>Username<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label>
          <label>Email address<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
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
    ? [['dashboard', 'Dashboard'], ['books', 'Books'], ['borrowed', 'Borrowed'], ['reservations', 'Reservations'], ['users', 'Members'], ['reports', 'Reports'], ['account', 'Account']]
    : [['dashboard', 'Dashboard'], ['books', 'Books'], ['recommendations', 'Recommendations'], ['my-books', 'My Books'], ['reservations', 'Reservations'], ['notifications', 'Notifications'], ['account', 'Account']];

  return (
    <nav className="tabs">
      {items.map(([id, label]) => (
        <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => setView(id)}>
          {label}
        </button>
      ))}
    </nav>
  );
}

function UserWorkspace({ api, user, onUserChange, view, setView, showMessage, onDeactivated }) {
  if (view === 'dashboard') {
    return <UserDashboard setView={setView} />;
  }
  if (view === 'my-books') {
    return <BorrowedBooks api={api} showMessage={showMessage} />;
  }
  if (view === 'reservations') {
    return <MyReservations api={api} showMessage={showMessage} />;
  }
  if (view === 'notifications') {
    return <NotificationCenter api={api} showMessage={showMessage} />;
  }
  if (view === 'recommendations') {
    return <Recommendations api={api} showMessage={showMessage} />;
  }
  if (view === 'account') {
    return <AccountSettings api={api} user={user} onUserChange={onUserChange} onDeactivated={onDeactivated} showMessage={showMessage} />;
  }
  return <BookBrowser api={api} canBorrow showMessage={showMessage} />;
}

function AdminWorkspace({ api, user, onUserChange, view, setView, showMessage }) {
  const [summary, setSummary] = useState(null);
  const loadSummary = useCallback(() => api.get('/api/admin/summary/').then(setSummary).catch((error) => showMessage(error.message)), [api, showMessage]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  if (!summary) {
    return <section className="panel">Loading admin data...</section>;
  }

  if (view === 'dashboard') {
    return <AdminDashboard summary={summary} setView={setView} />;
  }
  if (view === 'books') {
    return <BookManager api={api} showMessage={showMessage} />;
  }
  if (view === 'borrowed') {
    return <RecordTable records={summary.records} api={api} reload={loadSummary} showMessage={showMessage} />;
  }
  if (view === 'reservations') {
    return <ReservationTable reservations={summary.reservations} />;
  }
  if (view === 'users') {
    return <UserManager users={summary.users} api={api} reload={loadSummary} showMessage={showMessage} />;
  }
  if (view === 'account') {
    return <AccountSettings api={api} user={user} onUserChange={onUserChange} showMessage={showMessage} />;
  }
  if (view === 'reports') {
    return (
      <section className="panel report-panel">
        <div className="report-heading">
          <div>
            <h2>Library Administration Report</h2>
            <p>Catalogue holdings, borrowing, reservations, and successful login activity.</p>
          </div>
          <div className="report-actions">
            <button type="button" className="secondary" onClick={() => { window.location.href = '/api/admin/reports/download/'; }}>Download CSV</button>
            <button type="button" className="primary" onClick={() => window.print()}>Print Report</button>
          </div>
        </div>
        <div className="stats-grid compact">
          <Stat label="Books in catalogue" value={summary.stats.total_books} />
          <Stat label="Total copies" value={summary.stats.total_copies} />
          <Stat label="Borrowed (all time)" value={summary.report_stats.total_borrowed} />
          <Stat label="Active reservations" value={summary.stats.active_reservations} />
        </div>
        <ReportTable title="Borrowing Records" columns={['Borrower', 'Book', 'Borrowed', 'Due', 'Status']} rows={summary.records.map((record) => [
          record.user.username, record.book.title, record.borrow_date, record.due_date, record.status,
        ])} emptyText="No borrowing records yet." />
        <ReportTable title="Active Reservation Queue" columns={['Member', 'Book', 'Queue position', 'Status', 'Reserved at']} rows={summary.reservations.map((reservation) => [
          reservation.user.username, reservation.book.title, reservation.queue_position, reservation.status, new Date(reservation.created_at).toLocaleString(),
        ])} emptyText="No active reservations." />
        <ReportTable title="Successful Login History" columns={['Username', 'Email', 'Role', 'Logged in at']} rows={summary.login_activities.map((activity) => [
          activity.user.username, activity.user.email || 'No email', activity.user.role === 'user' ? 'Member' : 'Admin',
          new Date(activity.logged_in_at).toLocaleString(),
        ])} emptyText="Login history will appear after members sign in." />
      </section>
    );
  }
  return null;
}

function UserManager({ users, api, reload, showMessage }) {
  async function removeUser(item) {
    if (!window.confirm(`Remove ${item.username}? This permanently deletes their account and related library activity.`)) return;
    try {
      await api.delete(`/api/admin/users/${item.id}/`);
      await reload();
      showMessage(`${item.username} was removed.`);
    } catch (error) { showMessage(error.message); }
  }
  return <section className="panel user-manager">
    <div className="section-heading"><div><p className="eyebrow">Member directory</p><h2>Members</h2><p>Removing a member permanently clears their account and connected library activity.</p></div></div>
    <div className="table">
      {users.map((item) => <div className="row user-row" key={item.id}>
        <div><strong>{item.username}</strong><span>{item.email || 'No email'}</span></div>
        <span className={`badge ${item.role !== 'admin' && !item.is_active ? 'danger-badge' : ''}`}>{item.role === 'admin' ? 'Admin' : item.is_active ? 'Active member' : 'Deactivated'}</span>
        {item.role === 'user' ? <button type="button" className="danger" onClick={() => removeUser(item)}>Remove member</button> : <span className="admin-protected">Protected</span>}
      </div>)}
    </div>
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
  return <section className="panel account-panel"><p className="eyebrow">Account settings</p><h2>Manage your profile</h2><p>Choose a photo to personalise your library account. It appears alongside your name while you are signed in.</p><div className="profile-photo-editor"><div className="profile-photo-preview">{user.profile_photo ? <img src={user.profile_photo} alt="Your profile" /> : <span>{user.username.slice(0, 1).toUpperCase()}</span>}</div><div><strong>{user.username}</strong><span className="profile-role">{user.role === 'admin' ? 'Library administrator' : 'Library member'}</span><label className="photo-upload">{photoBusy ? 'Saving photo...' : 'Choose profile photo'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={photoBusy} onChange={(event) => { updatePhoto(event.target.files?.[0]).catch(() => showMessage('Could not read that image.')); event.target.value = ''; }} /></label>{user.profile_photo && <button type="button" className="link-button" onClick={removePhoto} disabled={photoBusy}>Remove photo</button>}<small>PNG, JPEG, WEBP, or GIF — maximum 1.5 MB.</small></div></div>{user.role === 'user' && <div className="danger-zone"><div><strong>Deactivate account</strong><span>Signing in, borrowing, reservations, and notifications will no longer be available.</span></div>{confirming ? <div className="confirm-actions"><button type="button" className="secondary" onClick={() => setConfirming(false)} disabled={busy}>Keep account</button><button type="button" className="danger" onClick={deactivate} disabled={busy}>{busy ? 'Deactivating...' : 'Confirm deactivation'}</button></div> : <button type="button" className="danger" onClick={() => setConfirming(true)}>Deactivate account</button>}</div>}</section>;
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

function UserDashboard({ setView }) {
  return (
    <section className="dashboard">
      <div className="dashboard-intro">
        <div className="dashboard-intro-copy">
          <p className="eyebrow">Member Dashboard</p>
          <h2>Welcome back to your library workspace.</h2>
          <p>Browse available books, search the catalogue, and check borrowed items.</p>
        </div>
        <img className="shared-hero-art" src={libraryBooks} alt="A colorful stack of library books" />
      </div>
      <div className="dashboard-grid">
        <DashboardAction tone="blue" title="View Books" text="See all available books in the library." action="Open catalogue" onClick={() => setView('books')} />
        <DashboardAction tone="cyan" title="Search Book" text="Search by title, author, category, or ISBN." action="Find a book" onClick={() => setView('books')} />
        <DashboardAction tone="green" title="Recommended Books" text="Browse suggested books selected from available library titles." action="Explore picks" onClick={() => setView('recommendations')} />
        <DashboardAction tone="amber" title="My Borrowed Books" text="View books you have borrowed and return them." action="View records" onClick={() => setView('my-books')} />
        <DashboardAction tone="green" title="My Reservations" text="Track your place in book waiting lists." action="View queue" onClick={() => setView('reservations')} />
      </div>
    </section>
  );
}

function AdminDashboard({ summary, setView }) {
  return (
    <section className="dashboard">
      <div className="admin-overview-grid">
        <div className="dashboard-intro admin-intro">
          <div className="dashboard-intro-copy">
            <p className="eyebrow">Admin Dashboard</p>
            <h2>Control the library catalogue and daily borrowing work.</h2>
            <p>Use the admin tools to maintain books, view members, inspect borrowed records, and track activity.</p>
          </div>
          <img className="shared-hero-art" src={libraryBooks} alt="A colorful stack of library books" />
        </div>
        <div className="admin-stat-grid">
          <Stat label="Total books" value={summary.stats.total_books} />
          <Stat label="Borrowed" value={summary.stats.total_borrowed} />
          <Stat label="Returned" value={summary.stats.total_returned} />
          <Stat label="Members" value={summary.stats.total_users} />
          <Stat label="Reservations" value={summary.stats.active_reservations} />
        </div>
      </div>
      <div className="dashboard-grid">
        <DashboardAction tone="blue" title="Manage Books" text="Add, update, and delete books." action="Manage" onClick={() => setView('books')} />
        <DashboardAction tone="cyan" title="Manage Members" text="View library members and administrators." action="View members" onClick={() => setView('users')} />
        <DashboardAction tone="amber" title="View Borrowed Books" text="See all borrowed books." action="View records" onClick={() => setView('borrowed')} />
        <DashboardAction tone="red" title="Reservation Queue" text="View members waiting for unavailable books." action="Open queue" onClick={() => setView('reservations')} />
        <DashboardAction tone="green" title="View Reports" text="Review totals and library activity." action="Open reports" onClick={() => setView('reports')} />
      </div>
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
  const [borrowChoiceBook, setBorrowChoiceBook] = useState(null);
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
        const availableBooks = data.books.filter((book) => book.available_copies > 0 || book.has_virtual_version);
        setBooks(availableBooks);
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
      score += book.available_copies;
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
    .sort((a, b) => b.score - a.score || b.available_copies - a.available_copies)
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
              <span>{book.category} - {book.available_copies}/{book.quantity} available</span>
              <small className="match-score">{book.score > 0 ? `${book.score} match points` : 'Popular available title'}</small>
              <small className="recommendation-reason">Recommended because it {recommendationReason(book)}.</small>
            </div>
            <button type="button" onClick={() => setBorrowChoiceBook(book)}>Borrow Book</button>
          </article>
        ))}
      </div>
      {borrowChoiceBook && <BorrowFormatDialog
        api={api}
        book={borrowChoiceBook}
        onClose={() => setBorrowChoiceBook(null)}
        onBorrowed={async () => {
          setBorrowChoiceBook(null);
          const data = await api.get('/api/books/');
          setBooks(data.books.filter((item) => item.available_copies > 0 || item.has_virtual_version));
        }}
        onReserve={async () => {
          try {
            const result = await api.post(`/api/books/${borrowChoiceBook.id}/reserve/`, {});
            setBorrowChoiceBook(null);
            showMessage(`Physical book reserved. Queue position: ${result.reservation.queue_position}.`);
          } catch (error) {
            showMessage(error.message);
          }
        }}
        showMessage={showMessage}
      />}
    </section>
  );
}

function BookBrowser({ api, canBorrow, showMessage }) {
  const [books, setBooks] = useState([]);
  const [query, setQuery] = useState('');
  const [borrowChoiceBook, setBorrowChoiceBook] = useState(null);

  async function loadBooks(search = query) {
    const data = await api.get(`/api/books/?q=${encodeURIComponent(search)}`);
    setBooks(data.books);
  }

  useEffect(() => {
    loadBooks('').catch((error) => showMessage(error.message));
  }, []);

  async function reserve(book) {
    try {
      const data = await api.post(`/api/books/${book.id}/reserve/`);
      showMessage(`Reserved ${book.title}. You are number ${data.reservation.queue_position} in the queue.`);
    } catch (error) {
      showMessage(error.message);
    }
  }

  return (
    <section className="books-page">
      <div className="books-hero">
        <div className="page-hero-copy">
          <p className="eyebrow">Library Catalogue</p>
          <h2>Find your next book from the shelves.</h2>
          <p>Search by title, author, ISBN, or category and borrow available books directly from your workspace.</p>
        </div>
        <img className="shared-hero-art" src={libraryBooks} alt="A colorful stack of library books" />
      </div>
      <div className="panel">
      <div className="toolbar">
        <h2>Books</h2>
        <form onSubmit={(event) => { event.preventDefault(); loadBooks(); }}>
          <input placeholder="Search title, author, ISBN, category" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button type="submit">Search</button>
        </form>
      </div>
      <div className="book-grid">
        {books.map((book) => (
          <article className="book-card" key={book.id}>
            <div className="book-3d"><img className="book-cover" src={getBookImage(book)} alt={`${book.title} cover`} loading="lazy" /></div>
            <div>
              <h3>{book.title}</h3>
              <p>{book.author}</p>
              <span>{book.category} - ISBN {book.isbn}</span>
              {book.has_virtual_version && <span className="format-badge virtual-badge">Virtual Book available</span>}
            </div>
            <div className="book-actions">
              <strong>{book.available_copies}/{book.quantity} available</strong>
              {canBorrow && (book.available_copies > 0 || book.has_virtual_version
                ? <button type="button" onClick={() => setBorrowChoiceBook(book)}>Borrow Book</button>
                : <button type="button" className="secondary" onClick={() => reserve(book)}>Reserve Physical Copy</button>)}
              {canBorrow && book.available_copies <= 0 && book.has_virtual_version && <button type="button" className="secondary" onClick={() => reserve(book)}>Reserve Physical Copy</button>}
            </div>
          </article>
        ))}
      </div>
      </div>
      {borrowChoiceBook && <BorrowFormatDialog
        api={api}
        book={borrowChoiceBook}
        onClose={() => setBorrowChoiceBook(null)}
        onBorrowed={async () => { setBorrowChoiceBook(null); await loadBooks(); }}
        onReserve={() => { setBorrowChoiceBook(null); reserve(borrowChoiceBook); }}
        showMessage={showMessage}
      />}
    </section>
  );
}

function BorrowFormatDialog({ api, book, onClose, onBorrowed, onReserve, showMessage }) {
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState('');

  async function borrow(format) {
    setBusy(true);
    setChoice(format);
    try {
      await api.post(`/api/books/${book.id}/borrow/`, { format });
      showMessage(format === 'physical'
        ? 'Your physical book has been reserved for collection. Please collect it from the library.'
        : 'Virtual Book borrowed. Open My Borrowed Books to read or download it.');
      await onBorrowed();
    } catch (error) {
      showMessage(error.message);
    } finally {
      setBusy(false);
      setChoice('');
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="borrow-dialog panel" role="dialog" aria-modal="true" aria-labelledby="borrow-choice-title">
        <button className="dialog-close" type="button" aria-label="Close" onClick={onClose} disabled={busy}>×</button>
        <p className="eyebrow">Borrow Book</p>
        <h2 id="borrow-choice-title">How would you like to borrow this book?</h2>
        <p className="dialog-book-title">{book.title} · {book.author}</p>
        <div className="format-choice-grid">
          {book.has_virtual_version && <article className="format-choice virtual-choice">
            <span className="format-badge virtual-badge">Virtual Book</span>
            <p>Read it in the library system or download it to your device.</p>
            <button type="button" disabled={busy} onClick={() => borrow('virtual')}>{choice === 'virtual' ? 'Borrowing…' : 'Read / Borrow Virtual Book'}</button>
          </article>}
          <article className="format-choice physical-choice">
            <span className="format-badge physical-badge">Physical Book</span>
            <p>{book.available_copies > 0 ? 'Borrow the library copy and collect it from the library.' : 'There are no physical copies available right now.'}</p>
            {book.available_copies > 0
              ? <button type="button" disabled={busy} onClick={() => borrow('physical')}>{choice === 'physical' ? 'Borrowing…' : 'Borrow Physical Book'}</button>
              : <button type="button" className="secondary" disabled={busy} onClick={onReserve}>Reserve Physical Copy</button>}
          </article>
        </div>
        <button type="button" className="secondary dialog-cancel" onClick={onClose} disabled={busy}>Cancel</button>
      </section>
    </div>
  );
}

function NotificationBell({ api, openNotifications }) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () => api.get('/api/notifications/')
      .then((data) => { if (active) setUnreadCount(data.unread_count); })
      .catch(() => {});
    load();
    const timer = window.setInterval(load, 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, [api]);

  return (
    <button type="button" className="notification-bell" onClick={openNotifications} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}>
      <span aria-hidden="true">&#128276;</span>
      {unreadCount > 0 && <strong>{unreadCount > 9 ? '9+' : unreadCount}</strong>}
    </button>
  );
}

function NotificationCenter({ api, showMessage }) {
  const [notifications, setNotifications] = useState([]);

  const loadNotifications = useCallback(async () => {
    const data = await api.get('/api/notifications/');
    setNotifications(data.notifications);
  }, [api]);

  useEffect(() => {
    loadNotifications().catch((error) => showMessage(error.message));
  }, [loadNotifications, showMessage]);

  async function markRead(notification) {
    try {
      await api.post(`/api/notifications/${notification.id}/read/`);
      setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, is_read: true } : item));
    } catch (error) { showMessage(error.message); }
  }

  async function markAllRead() {
    try {
      await api.post('/api/notifications/read-all/');
      setNotifications((items) => items.map((item) => ({ ...item, is_read: true })));
      showMessage('All notifications marked as read.');
    } catch (error) { showMessage(error.message); }
  }

  const unreadCount = notifications.filter((notification) => !notification.is_read).length;
  return (
    <section className="panel notifications-panel">
      <div className="notification-heading">
        <div><p className="eyebrow">Library Updates</p><h2>Notifications</h2><p>Due dates, overdue books, and reservation updates appear here.</p></div>
        {unreadCount > 0 && <button type="button" className="secondary" onClick={markAllRead}>Mark all as read</button>}
      </div>
      <div className="notification-list">
        {notifications.map((notification) => (
          <article className={notification.is_read ? 'notification-item' : 'notification-item unread'} key={notification.id}>
            <div><span className={`notification-type ${notification.type}`}>{notification.type.replace('_', ' ')}</span><h3>{notification.title}</h3><p>{notification.message}</p><small>{new Date(notification.created_at).toLocaleString()}</small></div>
            {!notification.is_read && <button type="button" onClick={() => markRead(notification)}>Mark read</button>}
          </article>
        ))}
        {!notifications.length && <div className="empty-state">You have no notifications yet.</div>}
      </div>
    </section>
  );
}

function MyReservations({ api, showMessage }) {
  const [reservations, setReservations] = useState([]);

  async function loadReservations() {
    const data = await api.get('/api/my-reservations/');
    setReservations(data.reservations);
  }

  useEffect(() => {
    loadReservations().catch((error) => showMessage(error.message));
  }, []);

  async function cancel(reservation) {
    try {
      await api.post(`/api/my-reservations/${reservation.id}/cancel/`);
      showMessage(`Cancelled reservation for ${reservation.book.title}.`);
      loadReservations();
    } catch (error) {
      showMessage(error.message);
    }
  }

  return (
    <section className="panel">
      <div className="reservation-heading">
        <div>
          <p className="eyebrow">Reservation Queue</p>
          <h2>My Reservations</h2>
        </div>
        <p>When a copy is returned, the first person in the queue is marked ready to borrow it.</p>
      </div>
      <div className="table">
        {reservations.map((reservation) => (
          <div className="row reservation-row" key={reservation.id}>
            <span>{reservation.book.title}</span>
            <span>Position #{reservation.queue_position}</span>
            <span className={reservation.status === 'ready' ? 'badge ready-badge' : 'badge'}>{reservation.status === 'ready' ? 'Ready to borrow' : 'Waiting'}</span>
            <button type="button" className="danger" onClick={() => cancel(reservation)}>Cancel</button>
          </div>
        ))}
        {!reservations.length && <div className="empty-state">You have no active reservations.</div>}
      </div>
    </section>
  );
}

function BorrowedBooks({ api, showMessage }) {
  const [records, setRecords] = useState([]);
  const [readerRecord, setReaderRecord] = useState(null);

  async function loadRecords() {
    const data = await api.get('/api/my-books/');
    setRecords(data.records);
  }

  useEffect(() => {
    loadRecords().catch((error) => showMessage(error.message));
  }, []);

  async function returnBook(record) {
    try {
      await api.post('/api/my-books/' + record.id + '/return/');
      showMessage(record.book_format === 'physical'
        ? 'Return submitted. The library administrator must confirm receipt.'
        : 'Book returned.');
      await loadRecords();
    } catch (error) {
      showMessage(error.message);
    }
  }

  if (readerRecord) {
    return <BookReader api={api} record={readerRecord} onClose={() => setReaderRecord(null)} showMessage={showMessage} />;
  }

  return (
    <section className="panel">
      <h2>My Borrowed Books</h2>
      <p className="loan-policy-note">Please return physical books by their due date. Books still unreturned 14 days after borrowing are automatically returned, and the member account is deactivated.</p>
      <div className="table">
        {records.map((record) => {
          const isVirtual = record.book_format === 'virtual';
          const isActive = record.status !== 'returned';
          return <div className="row borrowed-book-row" key={record.id}>
            <span><strong>{record.book.title}</strong><small>{record.book.author}</small></span>
            <span className={'format-badge ' + (isVirtual ? 'virtual-badge' : 'physical-badge')}>{isVirtual ? 'Virtual Book' : 'Physical Book'}</span>
            <span>{record.return_confirmation_pending ? 'Return Pending Confirmation' : record.status}</span>
            <span>Due {record.due_date}</span>
            {isVirtual && isActive && <div className="borrowed-book-actions">
              <button type="button" onClick={() => setReaderRecord(record)}>Read Book</button>
              <a className="button-link secondary" href={'/api/my-books/' + record.id + '/content/?download=1'}>Download Book</a>
            </div>}
            {!isVirtual && isActive && <span className={record.return_confirmation_pending ? 'collection-pending' : record.collection_confirmed ? 'collection-confirmed' : 'collection-required'}>
              {record.return_confirmation_pending
                ? 'Return received by the library; awaiting administrator confirmation.'
                : record.collection_confirmed
                  ? 'Collection confirmed by the library.'
                  : 'Collection Required: collect this book from the library. An administrator must confirm collection before return.'}
            </span>}
            {isVirtual && isActive && <button type="button" className="secondary" onClick={() => returnBook(record)}>Return Book</button>}
            {!isVirtual && isActive && record.collection_confirmed && !record.return_confirmation_pending && <button type="button" className="secondary" onClick={() => returnBook(record)}>Submit Return</button>}
          </div>;
        })}
        {!records.length && <div className="empty-state">You have no borrowed books.</div>}
      </div>
    </section>
  );
}

function BookReader({ api, record, onClose, showMessage }) {
  const [text, setText] = useState('');
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const isPdf = record.book.virtual_file_type === 'application/pdf';
  const pages = isPdf ? [] : (text.match(/[\s\S]{1,3200}/g) || ['']);

  useEffect(() => {
    if (isPdf) return;
    api.get('/api/my-books/' + record.id + '/read/')
      .then((data) => setText(data.text))
      .catch((error) => showMessage(error.message));
  }, [api, record.id, isPdf, showMessage]);

  const pdfSource = '/api/my-books/' + record.id + '/content/#page=' + (page + 1) + '&zoom=' + Math.round(zoom * 100);
  return (
    <section className="panel book-reader">
      <div className="reader-header">
        <div><p className="eyebrow">Virtual Book</p><h2>{record.book.title}</h2><p>{record.book.author}</p></div>
        <button type="button" className="secondary" onClick={onClose}>Back to My Borrowed Books</button>
      </div>
      <div className="reader-toolbar">
        <button type="button" className="secondary" disabled={page <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous Page</button>
        <span>{isPdf ? 'Page ' + (page + 1) : 'Page ' + (Math.min(page + 1, pages.length || 1)) + ' of ' + (pages.length || 1)}</span>
        <button type="button" className="secondary" disabled={!isPdf && page >= pages.length - 1} onClick={() => setPage((value) => value + 1)}>Next Page</button>
        {isPdf && <>
          <button type="button" className="secondary" aria-label="Zoom out" disabled={zoom <= .6} onClick={() => setZoom((value) => Math.max(.6, value - .1))}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" className="secondary" onClick={() => setZoom((value) => Math.min(2, value + .1))}>+</button>
        </>}
        {!isPdf && <>
          <button type="button" className="secondary" aria-label="Zoom out" disabled={zoom <= .6} onClick={() => setZoom((value) => Math.max(.6, value - .1))}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" className="secondary" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + .1))}>+</button>
        </>}
      </div>
      {isPdf
        ? <iframe className="pdf-reader-frame" title={'Reading ' + record.book.title} src={pdfSource} />
        : <article className="text-reader-page" style={{ fontSize: zoom + 'rem' }}>{text ? pages[page] : 'Loading virtual book…'}</article>}
      <div className="reader-footer">
        <button type="button" className="secondary" onClick={onClose}>Close Reader</button>
        <a className="button-link" href={'/api/my-books/' + record.id + '/content/?download=1'}>Download Book</a>
      </div>
    </section>
  );
}

function BookManager({ api, showMessage }) {
  const [editing, setEditing] = useState(emptyBook);
  const [virtualFile, setVirtualFile] = useState(null);
  const [booksKey, setBooksKey] = useState(0);

  async function saveBook(event) {
    event.preventDefault();
    try {
      let saved;
      if (editing.id) {
        saved = await api.put(`/api/books/${editing.id}/`, editing);
      } else {
        saved = await api.post('/api/books/', editing);
      }
      setEditing(saved.book);
      if (virtualFile) {
        await api.upload(`/api/admin/books/${saved.book.id}/virtual-file/?filename=${encodeURIComponent(virtualFile.name)}`, virtualFile);
      }
      showMessage(virtualFile ? 'Book saved with its virtual version.' : editing.id ? 'Book updated.' : 'Book added.');
      setEditing(emptyBook);
      setVirtualFile(null);
      setBooksKey((key) => key + 1);
    } catch (error) {
      showMessage(error.message);
    }
  }

  async function removeVirtualVersion() {
    try {
      await api.delete(`/api/admin/books/${editing.id}/virtual-file/`);
      setEditing({ ...editing, has_virtual_version: false, virtual_file_name: '' });
      showMessage('Virtual book version removed.');
      setBooksKey((key) => key + 1);
    } catch (error) { showMessage(error.message); }
  }

  async function removeBook(book) {
    try {
      await api.delete(`/api/books/${book.id}/`);
      showMessage('Book deleted.');
      setBooksKey((key) => key + 1);
    } catch (error) {
      showMessage(error.message);
    }
  }

  return (
    <div className="split">
      <form className="panel form-grid" onSubmit={saveBook}>
        <h2>{editing.id ? 'Edit Book' : 'Add Book'}</h2>
        {['title', 'author', 'isbn', 'category'].map((field) => (
          <label key={field}>
            {field.replace('_', ' ')}
            <input value={editing[field]} onChange={(event) => setEditing({ ...editing, [field]: event.target.value })} required />
          </label>
        ))}
        <label>
          Quantity
          <input type="number" min="0" value={editing.quantity} onChange={(event) => setEditing({ ...editing, quantity: event.target.value })} />
        </label>
        <label>
          Available copies
          <input type="number" min="0" value={editing.available_copies} onChange={(event) => setEditing({ ...editing, available_copies: event.target.value })} />
        </label>
        <label>
          Virtual book file (PDF or TXT)
          <input type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={(event) => setVirtualFile(event.target.files?.[0] || null)} />
        </label>
        <p className="form-hint">PDF or plain text, up to 50 MB. The file is private and members can access it only while they have an active virtual loan.</p>
        {editing.id && editing.has_virtual_version && <div className="virtual-file-current"><span>Virtual version: {editing.virtual_file_name}</span><button type="button" className="danger" onClick={removeVirtualVersion}>Remove virtual version</button></div>}
        <button className="primary" type="submit">Save book</button>
      </form>
      <ManagedBookList key={booksKey} api={api} onEdit={(book) => { setEditing(book); setVirtualFile(null); }} onDelete={removeBook} showMessage={showMessage} />
    </div>
  );
}

function ManagedBookList({ api, onEdit, onDelete, showMessage }) {
  const [books, setBooks] = useState([]);

  useEffect(() => {
    api.get('/api/books/').then((data) => setBooks(data.books)).catch((error) => showMessage(error.message));
  }, [api, showMessage]);

  return (
    <section className="panel">
      <h2>Manage Books</h2>
      <div className="table">
        {books.map((book) => (
          <div className="row" key={book.id}>
            <span>{book.title}</span>
            <span>{book.author}</span>
            <span>{book.available_copies}/{book.quantity}</span>
            <span className={book.has_virtual_version ? 'format-badge virtual-badge' : 'format-badge physical-badge'}>{book.has_virtual_version ? 'Virtual + physical' : 'Physical only'}</span>
            <button type="button" onClick={() => onEdit(book)}>Edit</button>
            <button type="button" className="danger" onClick={() => onDelete(book)}>Delete</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecordTable({ records, api, reload, showMessage }) {
  async function confirmCollection(record) {
    try {
      await api.post('/api/admin/borrow-records/' + record.id + '/collection/');
      await reload();
      showMessage('Collection confirmed for ' + record.user.username + '.');
    } catch (error) {
      showMessage(error.message);
    }
  }

  async function confirmReturn(record) {
    try {
      await api.post('/api/admin/borrow-records/' + record.id + '/return/');
      await reload();
      showMessage('Return confirmed for ' + record.user.username + '.');
    } catch (error) {
      showMessage(error.message);
    }
  }

  return (
    <section className="panel">
      <h2>Borrowed Books</h2>
      <div className="table admin-record-table">
        <div className="row admin-record-header" aria-hidden="true">
          <strong>Member</strong><strong>Book</strong><strong>Format</strong><strong>Loan Status</strong><strong>Due Date</strong><strong>Collection</strong><strong>Admin Action</strong>
        </div>
        {records.map((record) => (
          <div className="row admin-borrow-record-row" key={record.id}>
            <span>{record.user.username}</span>
            <span>{record.book.title}</span>
            <span className={'format-badge ' + (record.book_format === 'virtual' ? 'virtual-badge' : 'physical-badge')}>{record.book_format === 'virtual' ? 'Virtual Book' : 'Physical Book'}</span>
            <span>{record.return_confirmation_pending ? 'Return Pending Confirmation' : record.status}</span>
            <span>Due {record.due_date}</span>
            <span>{record.book_format === 'virtual' ? 'Not required' : record.collection_confirmed ? 'Collected' : 'Awaiting collection'}</span>
            <div className="admin-record-actions">
              {record.book_format !== 'virtual' && record.status !== 'returned' && !record.collection_confirmed && <button type="button" onClick={() => confirmCollection(record)}>Confirm Collection</button>}
              {record.book_format !== 'virtual' && record.status !== 'returned' && record.return_confirmation_pending && <button type="button" onClick={() => confirmReturn(record)}>Confirm Return</button>}
              {record.book_format !== 'virtual' && record.status !== 'returned' && !record.return_confirmation_pending && record.collection_confirmed && <span className="collection-confirmed">Waiting for member return</span>}
              {record.status === 'returned' && <span className="collection-confirmed">Complete</span>}
              {record.book_format === 'virtual' && record.status !== 'returned' && <span>Member managed</span>}
            </div>
          </div>
        ))}
        {!records.length && <div className="empty-state">No borrowing records yet.</div>}
      </div>
    </section>
  );
}

function ReservationTable({ reservations }) {
  return (
    <section className="panel">
      <h2>Active Reservation Queue</h2>
      <div className="table">
        {reservations.map((reservation) => (
          <div className="row reservation-row" key={reservation.id}>
            <span>{reservation.user.username}</span>
            <span>{reservation.book.title}</span>
            <span>Position #{reservation.queue_position}</span>
            <span className={reservation.status === 'ready' ? 'badge ready-badge' : 'badge'}>{reservation.status}</span>
          </div>
        ))}
        {!reservations.length && <div className="empty-state">No members are waiting for a book.</div>}
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
