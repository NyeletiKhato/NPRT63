import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeSVG } from 'qrcode.react';
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
      <header className="topbar">
        <div className="nav-arrows" aria-label="Page navigation">
          <button type="button" onClick={goBack} disabled={historyIndex === 0} aria-label="Go back">‹</button>
          <button type="button" onClick={goForward} disabled={historyIndex >= history.length - 1} aria-label="Go forward">›</button>
        </div>
        <div>
          <p className="eyebrow">Library Management System</p>
          <h1>{user ? `${user.role === 'admin' ? 'Admin' : 'Student'} Workspace` : 'Library Portal'}</h1>
        </div>
        {user && (
          <div className="session">
            {user.role === 'user' && <NotificationBell api={api} openNotifications={() => navigateView('notifications')} />}
            <span>{user.username}</span>
            <button type="button" onClick={handleLogout}>Sign out</button>
          </div>
        )}
      </header>

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
              <AdminWorkspace api={api} view={view} setView={navigateView} showMessage={showMessage} />
            ) : (
              <UserWorkspace api={api} view={view} setView={navigateView} showMessage={showMessage} />
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
        title="User Login"
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
        title="User Registration"
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
  const accessUrl = import.meta.env.VITE_LIBRARY_URL || window.location.href;
  const isLocalOnly = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

  return (
    <section className="entry-shell">
      <div className="entry-hero">
        <div>
          <p className="eyebrow">React Library Portal</p>
          <h2>Manage books, members, borrowing, and fines with a focused dashboard.</h2>
          <p>Choose your access type to continue into the library system.</p>
        </div>
      </div>
      <div className="entry-actions">
        <button type="button" className="entry-card admin-card" onClick={() => setAuthScreen('login-admin')}>
          <span>Admin</span>
          <strong>Admin Login</strong>
          <small>Manage books, users, borrowed records, and reports.</small>
        </button>
        <button type="button" className="entry-card user-card" onClick={() => setAuthScreen('login-user')}>
          <span>User</span>
          <strong>User Login</strong>
          <small>Browse books, borrow titles, return books, and pay fines.</small>
        </button>
        <button type="button" className="entry-card signup-card" onClick={() => setAuthScreen('signup')}>
          <span>New User</span>
          <strong>Create Account</strong>
          <small>Register for a library account and start borrowing.</small>
        </button>
        <aside className="qr-access" aria-labelledby="qr-access-title">
          <QRCodeSVG value={accessUrl} size={144} level="M" includeMargin />
          <div>
            <span>Mobile Access</span>
            <strong id="qr-access-title">Scan to open the library</strong>
            <small>{isLocalOnly ? 'Open this site using its Wi-Fi network address before scanning from a phone.' : 'Use your phone camera to open this library portal.'}</small>
          </div>
        </aside>
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
        <p className="eyebrow">{mode === 'register' ? 'New library user' : role === 'admin' ? 'Staff access' : 'Member access'}</p>
        <h2>{title}</h2>
        <p>
          {mode === 'register'
            ? 'Create your account to browse the catalogue, borrow books, and manage payments.'
            : 'Sign in to continue to your dashboard and manage your library tasks.'}
        </p>
      </div>
      <form className="panel auth-form" onSubmit={submit}>
        <h3>{title}</h3>
        <label>
          Username
          <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
        </label>
        {mode === 'register' && (
          <label>
            Email
          <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
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
        <p className="eyebrow">Account recovery</p>
        <h2>Reset your password</h2>
        <p>{step === 'request' ? 'Enter your account details to request a one-time reset code.' : 'Enter the one-time code and choose a new password.'}</p>
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
    ? [['dashboard', 'Dashboard'], ['books', 'Books'], ['borrowed', 'Borrowed'], ['reservations', 'Reservations'], ['users', 'Users'], ['reports', 'Reports']]
    : [['dashboard', 'Dashboard'], ['books', 'Books'], ['recommendations', 'Recommendations'], ['my-books', 'My Books'], ['reservations', 'Reservations'], ['notifications', 'Notifications'], ['fines', 'Fines']];

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

function UserWorkspace({ api, view, setView, showMessage }) {
  if (view === 'dashboard') {
    return <UserDashboard setView={setView} />;
  }
  if (view === 'my-books' || view === 'fines') {
    return <BorrowedBooks api={api} finesOnly={view === 'fines'} showMessage={showMessage} />;
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
  return <BookBrowser api={api} canBorrow showMessage={showMessage} />;
}

function AdminWorkspace({ api, view, setView, showMessage }) {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api.get('/api/admin/summary/').then(setSummary).catch((error) => showMessage(error.message));
  }, [api, showMessage]);

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
    return <RecordTable records={summary.records} />;
  }
  if (view === 'reservations') {
    return <ReservationTable reservations={summary.reservations} />;
  }
  if (view === 'users') {
    return (
      <section className="panel">
        <h2>Users</h2>
        <div className="table">
          {summary.users.map((item) => (
            <div className="row" key={item.id}>
              <span>{item.username}</span>
              <span>{item.email || 'No email'}</span>
              <span className="badge">{item.role}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }
  if (view === 'reports') {
    return (
      <section className="panel report-panel">
        <div className="report-heading">
          <div>
            <h2>Library Administration Report</h2>
            <p>Borrowing, outstanding balances, and successful login activity.</p>
          </div>
          <div className="report-actions">
            <button type="button" className="secondary" onClick={() => { window.location.href = '/api/admin/reports/download/'; }}>Download CSV</button>
            <button type="button" className="primary" onClick={() => window.print()}>Print Report</button>
          </div>
        </div>
        <div className="stats-grid compact">
          <Stat label="Books in catalogue" value={summary.stats.total_books} />
          <Stat label="Borrowed (all time)" value={summary.report_stats.total_borrowed} />
          <Stat label="Books currently owed" value={summary.report_stats.books_owed} />
          <Stat label="Outstanding amount" value={`R${Number(summary.report_stats.amount_owed).toFixed(2)}`} />
          <Stat label="Active reservations" value={summary.stats.active_reservations} />
        </div>
        <ReportTable title="Borrowing Records" columns={['Borrower', 'Book', 'Borrowed', 'Due', 'Status', 'Fine', 'Paid']} rows={summary.records.map((record) => [
          record.user.username, record.book.title, record.borrow_date, record.due_date, record.status,
          `R${Number(record.fine_amount).toFixed(2)}`, record.fine_paid ? 'Yes' : 'No',
        ])} emptyText="No borrowing records yet." />
        <ReportTable title="Active Reservation Queue" columns={['Student', 'Book', 'Queue position', 'Status', 'Reserved at']} rows={summary.reservations.map((reservation) => [
          reservation.user.username, reservation.book.title, reservation.queue_position, reservation.status, new Date(reservation.created_at).toLocaleString(),
        ])} emptyText="No active reservations." />
        <ReportTable title="Successful Login History" columns={['Username', 'Email', 'Role', 'Logged in at']} rows={summary.login_activities.map((activity) => [
          activity.user.username, activity.user.email || 'No email', activity.user.role,
          new Date(activity.logged_in_at).toLocaleString(),
        ])} emptyText="Login history will appear after users sign in." />
      </section>
    );
  }
  return null;
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
        <p className="eyebrow">User Dashboard</p>
        <h2>Welcome back to your library workspace.</h2>
        <p>Browse available books, search the catalogue, check borrowed items, and settle outstanding fines.</p>
      </div>
      <div className="dashboard-grid">
        <DashboardAction tone="blue" title="View Books" text="See all available books in the library." action="Open catalogue" onClick={() => setView('books')} />
        <DashboardAction tone="cyan" title="Search Book" text="Search by title, author, category, or ISBN." action="Find a book" onClick={() => setView('books')} />
        <DashboardAction tone="green" title="Recommended Books" text="Browse suggested books selected from available library titles." action="Explore picks" onClick={() => setView('recommendations')} />
        <DashboardAction tone="amber" title="My Borrowed Books" text="View books you have borrowed and return them." action="View records" onClick={() => setView('my-books')} />
        <DashboardAction tone="green" title="My Reservations" text="Track your place in book waiting lists." action="View queue" onClick={() => setView('reservations')} />
        <DashboardAction tone="red" title="Fine Payment" text="View and pay your outstanding fines." action="Pay fines" onClick={() => setView('fines')} />
      </div>
    </section>
  );
}

function AdminDashboard({ summary, setView }) {
  return (
    <section className="dashboard">
      <div className="admin-overview-grid">
        <div className="dashboard-intro admin-intro">
          <p className="eyebrow">Admin Dashboard</p>
          <h2>Control the library catalogue and daily borrowing work.</h2>
          <p>Use the admin tools to maintain books, view users, inspect borrowed records, and track activity.</p>
        </div>
        <div className="admin-stat-grid">
          <Stat label="Total books" value={summary.stats.total_books} />
          <Stat label="Borrowed" value={summary.stats.total_borrowed} />
          <Stat label="Returned" value={summary.stats.total_returned} />
          <Stat label="Users" value={summary.stats.total_users} />
          <Stat label="Reservations" value={summary.stats.active_reservations} />
        </div>
      </div>
      <div className="dashboard-grid">
        <DashboardAction tone="blue" title="Manage Books" text="Add, update, and delete books." action="Manage" onClick={() => setView('books')} />
        <DashboardAction tone="cyan" title="Manage Users" text="View all users and admins." action="View users" onClick={() => setView('users')} />
        <DashboardAction tone="amber" title="View Borrowed Books" text="See all borrowed books." action="View records" onClick={() => setView('borrowed')} />
        <DashboardAction tone="red" title="Reservation Queue" text="View students waiting for unavailable books." action="Open queue" onClick={() => setView('reservations')} />
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
        const availableBooks = data.books.filter((book) => book.available_copies > 0);
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

  async function borrowRecommended(book) {
    try {
      await api.post(`/api/books/${book.id}/borrow/`);
      showMessage(`Borrowed ${book.title}.`);
      const data = await api.get('/api/books/');
      setBooks(data.books.filter((item) => item.available_copies > 0));
    } catch (error) {
      showMessage(error.message);
    }
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
        <div>
          <p className="eyebrow">Book Recommendations</p>
          <h2>Chat with your personal reading advisor.</h2>
          <p>Type what you love, what you need, or what mood you want. The advisor will shape recommendations around you.</p>
        </div>
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
            <img className="book-cover" src={getBookImage(book)} alt={`${book.title} cover`} loading="lazy" />
            <div>
              <h3>{book.title}</h3>
              <p>{book.author}</p>
              <span>{book.category} - {book.available_copies}/{book.quantity} available</span>
              <small className="match-score">{book.score > 0 ? `${book.score} match points` : 'Popular available title'}</small>
              <small className="recommendation-reason">Recommended because it {recommendationReason(book)}.</small>
            </div>
            <button type="button" onClick={() => borrowRecommended(book)}>Borrow</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function BookBrowser({ api, canBorrow, showMessage }) {
  const [books, setBooks] = useState([]);
  const [query, setQuery] = useState('');

  async function loadBooks(search = query) {
    const data = await api.get(`/api/books/?q=${encodeURIComponent(search)}`);
    setBooks(data.books);
  }

  useEffect(() => {
    loadBooks('').catch((error) => showMessage(error.message));
  }, []);

  async function borrow(book) {
    try {
      await api.post(`/api/books/${book.id}/borrow/`);
      showMessage(`Borrowed ${book.title}.`);
      await loadBooks();
    } catch (error) {
      showMessage(error.message);
    }
  }

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
        <div>
          <p className="eyebrow">Library Catalogue</p>
          <h2>Find your next book from the shelves.</h2>
          <p>Search by title, author, ISBN, or category and borrow available books directly from your workspace.</p>
        </div>
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
            <img className="book-cover" src={getBookImage(book)} alt={`${book.title} cover`} loading="lazy" />
            <div>
              <h3>{book.title}</h3>
              <p>{book.author}</p>
              <span>{book.category} - ISBN {book.isbn}</span>
            </div>
            <div className="book-actions">
              <strong>{book.available_copies}/{book.quantity} available</strong>
              {canBorrow && (book.available_copies > 0
                ? <button type="button" onClick={() => borrow(book)}>Borrow</button>
                : <button type="button" className="secondary" onClick={() => reserve(book)}>Reserve</button>)}
            </div>
          </article>
        ))}
      </div>
      </div>
    </section>
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

function BorrowedBooks({ api, finesOnly, showMessage }) {
  const [records, setRecords] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [receipt, setReceipt] = useState(null);

  async function loadRecords() {
    const data = await api.get('/api/my-books/');
    setRecords(data.records);
  }

  useEffect(() => {
    loadRecords().catch((error) => showMessage(error.message));
  }, []);

  async function act(path, success, body = {}) {
    try {
      const data = await api.post(path, body);
      showMessage(success);
      loadRecords();
      return data;
    } catch (error) {
      showMessage(error.message);
      return null;
    }
  }

  const visibleRecords = finesOnly
    ? records.filter((record) => Number(record.fine_amount) > 0 && !record.fine_paid)
    : records;
  const totalFine = visibleRecords.reduce((total, record) => total + Number(record.fine_amount), 0);
  const paymentLabel = {
    card: 'Bank card',
    eft: 'EFT',
    cash: 'Cash at library desk',
  }[paymentMethod];

  async function payFine(record) {
    const data = await act(
      `/api/my-books/${record.id}/pay-fine/`,
      `Fine paid by ${paymentLabel}.`,
      { payment_method: paymentMethod },
    );

    if (!data?.record) {
      return;
    }

    setReceipt({
      receiptNumber: `LMS-${data.record.id}-${Date.now().toString().slice(-6)}`,
      paidAt: new Date().toLocaleString(),
      student: data.record.user.username,
      book: data.record.book.title,
      amount: data.record.fine_amount,
      method: paymentLabel,
      status: 'Paid',
    });
  }

  return (
    <section className="panel">
      <div className="fine-heading">
        <h2>{finesOnly ? 'Outstanding Fines' : 'My Borrowed Books'}</h2>
        {finesOnly && (
          <strong className="fine-total">Total: R{totalFine.toFixed(2)}</strong>
        )}
      </div>
      {finesOnly && (
        <div className="payment-panel">
          <div>
            <p className="eyebrow">Payment Option</p>
            <h3>Choose how you want to pay</h3>
          </div>
          <div className="payment-options">
            <label className={paymentMethod === 'card' ? 'payment-option active' : 'payment-option'}>
              <input type="radio" name="payment" value="card" checked={paymentMethod === 'card'} onChange={(event) => setPaymentMethod(event.target.value)} />
              <span>Bank card</span>
            </label>
            <label className={paymentMethod === 'eft' ? 'payment-option active' : 'payment-option'}>
              <input type="radio" name="payment" value="eft" checked={paymentMethod === 'eft'} onChange={(event) => setPaymentMethod(event.target.value)} />
              <span>EFT</span>
            </label>
            <label className={paymentMethod === 'cash' ? 'payment-option active' : 'payment-option'}>
              <input type="radio" name="payment" value="cash" checked={paymentMethod === 'cash'} onChange={(event) => setPaymentMethod(event.target.value)} />
              <span>Cash</span>
            </label>
          </div>
        </div>
      )}
      <div className="table">
        {visibleRecords.map((record) => (
          <div className="row" key={record.id}>
            <span>{record.book.title}</span>
            <span>{record.status}</span>
            <span>Due {record.due_date}</span>
            <span>R{record.fine_amount}</span>
            {!finesOnly && record.status !== 'returned' && (
              <button type="button" onClick={() => act(`/api/my-books/${record.id}/return/`, 'Book returned.')}>Return</button>
            )}
            {finesOnly && (
              record.status === 'returned'
                ? <button type="button" onClick={() => payFine(record)}>Pay</button>
                : <span className="badge danger-badge">Return first</span>
            )}
          </div>
        ))}
        {visibleRecords.length === 0 && (
          <div className="empty-state">No outstanding fines.</div>
        )}
      </div>
      {finesOnly && receipt && (
        <div className="receipt">
          <div className="receipt-header">
            <div>
              <p className="eyebrow">Payment Receipt</p>
              <h3>Library Fine Receipt</h3>
            </div>
            <strong>{receipt.status}</strong>
          </div>
          <div className="receipt-grid">
            <span>Receipt No.</span>
            <strong>{receipt.receiptNumber}</strong>
            <span>Date</span>
            <strong>{receipt.paidAt}</strong>
            <span>Student</span>
            <strong>{receipt.student}</strong>
            <span>Book</span>
            <strong>{receipt.book}</strong>
            <span>Payment Method</span>
            <strong>{receipt.method}</strong>
            <span>Amount Paid</span>
            <strong>R{Number(receipt.amount).toFixed(2)}</strong>
          </div>
          <button type="button" className="primary print-button" onClick={() => window.print()}>Print Receipt</button>
        </div>
      )}
    </section>
  );
}

function BookManager({ api, showMessage }) {
  const [editing, setEditing] = useState(emptyBook);
  const [booksKey, setBooksKey] = useState(0);

  async function saveBook(event) {
    event.preventDefault();
    try {
      if (editing.id) {
        await api.put(`/api/books/${editing.id}/`, editing);
        showMessage('Book updated.');
      } else {
        await api.post('/api/books/', editing);
        showMessage('Book added.');
      }
      setEditing(emptyBook);
      setBooksKey((key) => key + 1);
    } catch (error) {
      showMessage(error.message);
    }
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
        <button className="primary" type="submit">Save book</button>
      </form>
      <ManagedBookList key={booksKey} api={api} onEdit={setEditing} onDelete={removeBook} showMessage={showMessage} />
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
            <button type="button" onClick={() => onEdit(book)}>Edit</button>
            <button type="button" className="danger" onClick={() => onDelete(book)}>Delete</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecordTable({ records }) {
  return (
    <section className="panel">
      <h2>Borrowed Books</h2>
      <div className="table">
        {records.map((record) => (
          <div className="row" key={record.id}>
            <span>{record.user.username}</span>
            <span>{record.book.title}</span>
            <span>{record.status}</span>
            <span>Due {record.due_date}</span>
            <span>R{record.fine_amount}</span>
          </div>
        ))}
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
        {!reservations.length && <div className="empty-state">No students are waiting for a book.</div>}
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
