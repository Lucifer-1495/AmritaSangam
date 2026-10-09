import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, BarChart3, Bell, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, Compass, CreditCard, FolderKanban, Gauge, HandCoins,
  Laptop, LogOut, Menu, Megaphone, Moon, Plus, Search, ShieldCheck, Sparkles, Sun, Users,
  WalletCards, Download, X, UserRound, KeyRound, Camera, Trash2 } from 'lucide-react';
import { api, apiDownload } from '../services/api';
import PortalBrand from '../components/PortalBrand';
import '../App.css';

const allNavigation = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'clubs', label: 'Explore clubs', icon: Compass },
  { id: 'events', label: 'Events', icon: CalendarDays },
  { id: 'applications', label: 'Membership', icon: Users },
  { id: 'members', label: 'Club members', icon: Users },
  { id: 'chats', label: 'Club chats', icon: Users },
  { id: 'equipment', label: 'Equipment', icon: Laptop },
  { id: 'funding', label: 'Funding', icon: WalletCards },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'eventReports', label: 'Event reports', icon: FolderKanban },
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
  { id: 'profile', label: 'My profile', icon: UserRound },
];

const initialData = {
  clubs: [], managedClubs: [], memberships: [], venues: [], events: [], announcements: [], applications: [],
  registrations: [], participation: [], equipment: [], funding: [], transactions: [], borrows: [], profiles: [], eventReports: [],
  summary: { clubs: 0, events: 0, members: 0, pendingApplications: 0, allocated: 0, spent: 0, equipment: 0, clubReports: [] },
};

const roleNames = {
  student: 'Student',
  club_committee: 'Club committee',
  faculty_coordinator: 'Faculty mentor',
  college_admin: 'Admin',
  icts: 'ICTS',
};

const adminTypeNames = {
  student_affairs: 'Student Affairs',
  principal: 'Principal',
  other_authority: 'Other authority',
};

const trackNames = {
  'student-affairs': 'Student Affairs',
  mentor: 'Faculty mentor',
  president: 'Club president',
  'office-bearer': 'Office bearer',
  executive: 'Club executive',
  student: 'Student',
};

function isOfficeBearerPosition(membership) {
  return membership.membershipStatus !== 'pending'
    && (['office_bearer', 'president', 'vice_president', 'treasurer', 'secretary'].includes(membership.position)
      || (membership.position === 'executive' && membership.officeBearerGroup));
}

function profileTrackLabel(profile, track) {
  if (profile.role === 'college_admin') {
    const adminLabel = profile.adminType === 'other_authority'
      ? profile.designation || adminTypeNames.other_authority
      : adminTypeNames[profile.adminType] || adminTypeNames.student_affairs;
    return `${adminLabel} admin`;
  }
  return trackNames[track] || roleNames[profile.role] || profile.role;
}

function dashboardTrack(role, memberships) {
  if (role === 'college_admin') return 'student-affairs';
  if (role === 'faculty_coordinator') return 'mentor';
  if (memberships.some((membership) => membership.membershipStatus !== 'pending' && membership.position === 'president')) return 'president';
  if (memberships.some(isOfficeBearerPosition)) return 'office-bearer';
  if (memberships.some((membership) => membership.membershipStatus !== 'pending' && membership.position === 'executive')) return 'executive';
  return 'student';
}

function navigationFor(track) {
  const visible = {
    'student-affairs': ['overview', 'clubs', 'events', 'members', 'equipment', 'funding', 'reports', 'eventReports', 'announcements', 'profile'],
    mentor: ['overview', 'clubs', 'events', 'applications', 'members', 'equipment', 'funding', 'eventReports', 'announcements', 'profile'],
    president: ['overview', 'clubs', 'events', 'applications', 'members', 'chats', 'equipment', 'funding', 'reports', 'eventReports', 'announcements', 'profile'],
    'office-bearer': ['overview', 'clubs', 'events', 'applications', 'members', 'chats', 'funding', 'reports', 'announcements', 'profile'],
    executive: ['overview', 'clubs', 'events', 'chats', 'announcements', 'profile'],
    student: ['overview', 'clubs', 'events', 'applications', 'announcements', 'profile'],
  }[track];
  return allNavigation.filter(({ id }) => visible.includes(id));
}

function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!value) return 'Date to be announced';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date to be announced' : date.toLocaleDateString(undefined, options);
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(value || 0);
}

function statusClass(status) {
  return `status status-${String(status || 'pending').toLowerCase()}`;
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CS';
}

function clearLegacySupabaseSessions() {
  const storage = window.localStorage;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key && /^sb-[a-z0-9-]+-auth-token(?:-code-verifier)?$/i.test(key)) {
      storage.removeItem(key);
    }
  }
}

function loadTheme() {
  try {
    return window.localStorage.getItem('campussphere-theme') === 'dark' ? 'dark' : 'light';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') return 'light';
    throw error;
  }
}

function ThemeToggle({ theme, onToggle, className = '' }) {
  const isDark = theme === 'dark';
  const Icon = isDark ? Sun : Moon;
  return <button
    className={`icon-button theme-toggle ${className}`.trim()}
    type="button"
    onClick={onToggle}
    aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
  ><Icon size={18} /></button>;
}

function AuthScreen({ onAuthenticated, theme, onToggleTheme }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('error');

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setNotice('');
    try {
      onAuthenticated(await api('/auth/login', { method: 'POST', body: { email, password } }));
    } catch (error) {
      setNoticeType('error');
      setNotice(error.message || 'We could not complete that request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <ThemeToggle theme={theme} onToggle={onToggleTheme} className="auth-theme-toggle" />
      <section className="auth-story">
        <PortalBrand className="auth-brand" />
        <div className="story-copy">
          <h1>YOUR WINDOW TO CAMPUS LIFE</h1>
          <p>Find your people, show up for the moments that matter, and make campus life your own.</p>
          <span className="auth-story-divider" />
        </div>
        <div className="story-note">
          <div className="avatar-stack"><span>AK</span><span>RM</span><span>JD</span><b>+</b></div>
          <span>Good things happen when we do them together.</span>
        </div>
        <span className="story-orbit orbit-one" /><span className="story-orbit orbit-two" />
      </section>

      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <PortalBrand className="mobile-brand" />
          <div className="login-heading"><h2>LOGIN</h2><span aria-hidden="true"><ArrowRight size={21} /></span></div>
          <p className="eyebrow">WELCOME BACK</p>
          <p className="auth-subtitle">Sign in to your campus portal. Your college account gives you access to clubs, events, and student services.</p>

          <form className="auth-form" onSubmit={submit}>
            <label className="field-label">
              College email
              <input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@college.edu" required />
            </label>
            <label className="field-label">
              Password
              <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>
            {notice && <div className={`notice notice-${noticeType}`} role="status">{notice}</div>}
            <button className="button button-primary button-wide" type="submit" disabled={loading}>
              {loading ? 'One moment…' : 'Sign in'}
              {!loading && <ArrowRight size={17} />}
            </button>
          </form>

          <p className="auth-switch">Need access? Ask Student Affairs to create your college account.</p>
          <div className="auth-footnote"><ShieldCheck size={15} /> Your account is secured with Supabase Auth.</div>
        </div>
      </section>
    </main>
  );
}

function Modal({ type, clubs, profiles, venues, selectedClub, profile, onClose, onSubmit, busy }) {
  const [clubId, setClubId] = useState(selectedClub?._id || clubs[0]?._id || '');
  const [formError, setFormError] = useState('');
  const [logoPreview, setLogoPreview] = useState(selectedClub?.logoUrl || '');
  const [posterPreview, setPosterPreview] = useState('');
  const [eventStart, setEventStart] = useState('');
  const [eventEnd, setEventEnd] = useState('');
  const [venueAvailability, setVenueAvailability] = useState([]);
  const [availabilityError, setAvailabilityError] = useState('');
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const applicationClub = clubs.find((club) => club._id === clubId);

  useEffect(() => {
    if (type !== 'event' || !eventStart || !eventEnd || new Date(eventEnd) <= new Date(eventStart)) {
      setVenueAvailability([]);
      setAvailabilityError('');
      setCheckingAvailability(false);
      return undefined;
    }
    let active = true;
    setVenueAvailability([]);
    setCheckingAvailability(true);
    setAvailabilityError('');
    api(`/venues/availability?eventDate=${encodeURIComponent(new Date(eventStart).toISOString())}&endDate=${encodeURIComponent(new Date(eventEnd).toISOString())}`)
      .then((result) => { if (active) setVenueAvailability(result); })
      .catch((error) => { if (active) setAvailabilityError(error.message); })
      .finally(() => { if (active) setCheckingAvailability(false); });
    return () => { active = false; };
  }, [eventEnd, eventStart, type]);

  const submit = async (event) => {
    event.preventDefault();
    setFormError('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      if (isClubForm) values.logoUrl = logoPreview;
      if (type === 'event') {
        values.posterUrl = posterPreview;
        values.eventDate = new Date(eventStart).toISOString();
        values.endDate = new Date(eventEnd).toISOString();
      }
      const result = await onSubmit(type, { ...values, clubId });
      if (result) setFormError(result);
    } catch (error) {
      setFormError(error.message);
    }
  };

  const pickImage = async (event, kind) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const image = kind === 'logo'
        ? await resizeImage(file, 512, 'image/png')
        : await resizeImage(file, 1400, 'image/jpeg', false);
      if (kind === 'logo') setLogoPreview(image);
      else setPosterPreview(image);
      setFormError('');
    } catch (error) {
      setFormError(error.message);
    }
  };

  const modalTitles = {
    apply: 'Join the conversation',
    event: 'Create an event',
    announcement: 'Share an announcement',
    equipment: 'Add club equipment',
    funding: 'Request funding',
    budget: 'Set a club budget',
    transaction: 'Record a transaction',
    club: 'Create a club',
    editClub: 'Edit club details',
  };
  const isClubForm = type === 'club' || type === 'editClub';

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading">
          <div><span className="eyebrow">MY AMRITA</span><h2 id="modal-title">{modalTitles[type]}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
        </div>
        <form className="modal-form" onSubmit={submit}>
          {type === 'apply' && <p className="modal-intro">Tell the club a little about what brings you here.</p>}
          {type !== 'club' && type !== 'editClub' && type !== 'event' && (
            <label className="field-label">Club
              <select name="clubId" value={clubId} onChange={(event) => setClubId(event.target.value)} required>
                {clubs.map((club) => <option value={club._id} key={club._id}>{club.name}{club.clubType ? ` · ${club.clubType.replace('_', ' ')}` : ''}</option>)}
              </select>
            </label>
          )}
          {isClubForm && <>
            <label className="field-label">Club name<input name="name" required maxLength={100} defaultValue={selectedClub?.name} placeholder="e.g. Design Society" /></label>
            <label className="field-label">Category<input name="category" defaultValue={selectedClub?.category} placeholder="Arts, technology, community…" /></label>
            <label className="field-label">Application domains<textarea name="domains" required maxLength={1200} rows="3" defaultValue={selectedClub?.domains?.join('\n') || 'General'} placeholder={'For example:\nWeb development\nDesign\nEvents'} /><small>Enter one domain per line. Students choose from these when applying.</small></label>
            <label className="field-label">About the club<textarea name="description" required maxLength={2000} rows="3" defaultValue={selectedClub?.description} placeholder="What brings your community together?" /></label>
            <label className="field-label">Club logo (PNG, optional)<input type="file" accept="image/png" onChange={(event) => pickImage(event, 'logo')} /></label>
            {logoPreview && <div className="media-preview"><img src={logoPreview} alt="Club logo preview" /><button type="button" className="text-link" onClick={() => setLogoPreview('')}>Remove logo</button></div>}
            <label className="field-label">Club type<select name="clubType" defaultValue={selectedClub?.clubType || 'non_technical'} required><option value="technical">Technical</option><option value="non_technical">Non-technical</option></select></label>
            <label className="field-label">Faculty mentor<select name="mentor" defaultValue={selectedClub?.mentor?._id || selectedClub?.mentor || ''} required><option value="">{profiles.some((person) => person.role === 'faculty_coordinator') ? 'Choose a faculty mentor' : 'ICTS has not created any faculty accounts yet'}</option>{profiles.filter((person) => person.role === 'faculty_coordinator').map((person) => <option key={person._id} value={person._id}>{person.name} · {person.facultyId || person.email}</option>)}</select></label>
            <label className="checkbox-label"><input name="recruitmentOpen" type="checkbox" value="true" defaultChecked={selectedClub?.recruitmentOpen ?? true} /> Recruitment is open</label>
          </>}
          {type === 'budget' && <>
            <label className="field-label">Academic year<input name="academicYear" required placeholder="2026-2027" defaultValue="2026-2027" /></label>
            <label className="field-label">Initial allocation<input name="totalAllocated" type="number" min="0" step="1" required placeholder="Amount in INR" /></label>
          </>}
          {type === 'transaction' && <>
            <label className="field-label">Transaction type<select name="type"><option value="debit">Expense</option><option value="credit">Additional allocation</option></select></label>
            <label className="field-label">Amount<input name="amount" type="number" min="1" step="1" required placeholder="Amount in INR" /></label>
            <label className="field-label">Description<input name="description" required maxLength={1000} placeholder="What was this for?" /></label>
          </>}
          {type === 'apply' && <>
            <div className="application-profile-grid">
              <label className="field-label">Name<input value={profile.name || ''} readOnly /></label>
              <label className="field-label">Roll number<input value={profile.registerNumber || 'Not issued'} readOnly /></label>
              <label className="field-label">Department<input value={profile.department || 'Not provided'} readOnly /></label>
              <label className="field-label">Year of study<select name="yearOfStudy" defaultValue="" required><option value="" disabled>Select year</option><option value="1st">1st year</option><option value="2nd">2nd year</option><option value="3rd">3rd year</option><option value="4th">4th year</option><option value="Other">Other</option></select></label>
              <label className="field-label">Phone number<input name="applicantPhone" type="tel" defaultValue={profile.phone || ''} maxLength={20} required autoComplete="tel" /></label>
              <label className="field-label">Domain<select name="domain" required defaultValue={applicationClub?.domains?.[0] || 'General'}>{(applicationClub?.domains?.length ? applicationClub.domains : ['General']).map((domain) => <option key={domain} value={domain}>{domain}</option>)}</select></label>
            </div>
            <label className="field-label">What would you like to apply for?<select name="requestedPosition"><option value="member">Club membership</option><option value="executive">Executive consideration</option></select></label>
            <label className="field-label">Why would you like to join?<textarea name="reason" required minLength={3} maxLength={2000} rows="4" placeholder="Share what you're curious about…" /></label>
          </>}
          {type === 'event' && <>
            <p className="modal-intro">Event type follows the selected club: {clubs.find((club) => club._id === clubId)?.clubType?.replace('_', ' ') || 'club type'}.</p>
            <label className="field-label">Club hosting this event<select name="clubId" value={clubId} onChange={(event) => setClubId(event.target.value)} required>{clubs.map((club) => <option key={club._id} value={club._id}>{club.name}</option>)}</select></label>
            <label className="field-label">Event name<input name="title" required maxLength={150} placeholder="Give your event a name" /></label>
            <label className="field-label">What is it about?<textarea name="description" maxLength={3000} rows="3" placeholder="A few details for people who might come along…" /></label>
            <label className="field-label">Event poster (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => pickImage(event, 'poster')} /></label>
            {posterPreview && <div className="media-preview media-preview-poster"><img src={posterPreview} alt="Event poster preview" /><button type="button" className="text-link" onClick={() => setPosterPreview('')}>Remove poster</button></div>}
            <label className="field-label">Venue<select name="venueId" required defaultValue="" disabled={checkingAvailability}><option value="" disabled>{checkingAvailability ? 'Checking venue availability…' : 'Choose an available venue'}</option>{venues.map((venue) => {
              const availability = venueAvailability.find((item) => item._id === venue._id);
              return <option key={venue._id} value={venue._id} disabled={availability && !availability.available}>{venue.name} · {venue.location}{availability && !availability.available ? ' · Occupied' : ''}</option>;
            })}</select></label>
            {availabilityError && <div className="notice notice-error" role="alert">Could not check venue availability: {availabilityError} The server will check again when you submit.</div>}
            {eventStart && eventEnd && new Date(eventEnd) <= new Date(eventStart) && <div className="notice notice-error" role="alert">The end time must be after the start time.</div>}
            <div className="form-row">
              <label className="field-label">Starts<input name="eventDate" type="datetime-local" required value={eventStart} onChange={(event) => setEventStart(event.target.value)} /></label>
              <label className="field-label">Ends<input name="endDate" type="datetime-local" required min={eventStart || undefined} value={eventEnd} onChange={(event) => setEventEnd(event.target.value)} /></label>
              <label className="field-label">Capacity<input name="capacity" type="number" min="1" max="5000" defaultValue="100" required /></label>
            </div>
          </>}
          {type === 'announcement' && <>
            <label className="field-label">Headline<input name="title" required maxLength={150} placeholder="What's the news?" /></label>
            <label className="field-label">Message<textarea name="content" required maxLength={3000} rows="4" placeholder="Share the details with your community…" /></label>
            <label className="field-label">Priority<select name="priority"><option value="normal">Normal</option><option value="high">Important</option><option value="low">Low-key</option></select></label>
          </>}
          {type === 'equipment' && <>
            <label className="field-label">Equipment name<input name="name" required maxLength={120} placeholder="e.g. Camera tripod" /></label>
            <label className="field-label">Description<input name="description" maxLength={1000} placeholder="Optional details" /></label>
            <div className="form-row">
              <label className="field-label">Quantity<input name="totalQuantity" type="number" min="1" defaultValue="1" required /></label>
              <label className="field-label">Condition<select name="condition"><option value="good">Good</option><option value="new">New</option><option value="fair">Fair</option><option value="poor">Needs care</option></select></label>
            </div>
          </>}
          {type === 'funding' && <>
            <label className="field-label">How much do you need?<input name="requestedAmount" type="number" min="1" step="1" required placeholder="Amount in INR" /></label>
            <label className="field-label">What is it for?<textarea name="purpose" required maxLength={2000} rows="4" placeholder="Tell your coordinator how the funds will be used…" /></label>
          </>}
          {formError && <div className="notice notice-error" role="alert">{formError}</div>}
          <div className="modal-actions">
            <button className="button button-quiet" type="button" onClick={onClose}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={busy || checkingAvailability || (!clubs.length && !isClubForm) || (type === 'event' && eventEnd && new Date(eventEnd) <= new Date(eventStart))}>
              {busy ? 'Saving…' : type === 'apply' ? 'Send application' : type === 'funding' ? 'Send request' : 'Save'}
              {!busy && <ArrowRight size={16} />}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function OverviewEventCarousel({ events, onOpen }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingIndex, setPendingIndex] = useState(null);
  const [direction, setDirection] = useState(1);
  const [paused, setPaused] = useState(false);
  const transitioning = useRef(false);
  const transitionTimer = useRef(null);
  const safeIndex = events.length ? activeIndex % events.length : 0;
  const activeEvent = events[safeIndex];

  const finishTransition = useCallback((targetIndex) => {
    if (!transitioning.current || targetIndex === null) return;
    transitioning.current = false;
    window.clearTimeout(transitionTimer.current);
    transitionTimer.current = null;
    setActiveIndex(targetIndex);
    setPendingIndex(null);
  }, []);

  const moveTo = useCallback((nextIndex) => {
    if (transitioning.current || events.length < 2) return;
    const normalizedIndex = (nextIndex + events.length) % events.length;
    if (normalizedIndex === safeIndex) return;
    transitioning.current = true;
    setDirection(normalizedIndex > safeIndex || (safeIndex === events.length - 1 && normalizedIndex === 0) ? 1 : -1);
    setPendingIndex(normalizedIndex);
    transitionTimer.current = window.setTimeout(() => finishTransition(normalizedIndex), 650);
  }, [events.length, finishTransition, safeIndex]);

  useEffect(() => {
    if (events.length < 2 || paused || pendingIndex !== null) return undefined;
    const timer = window.setTimeout(() => moveTo(safeIndex + 1), 5000);
    return () => window.clearTimeout(timer);
  }, [events.length, moveTo, paused, pendingIndex, safeIndex]);

  useEffect(() => () => window.clearTimeout(transitionTimer.current), []);

  if (!activeEvent) return null;
  const nextIndex = (safeIndex + 1) % events.length;
  const previousIndex = (safeIndex - 1 + events.length) % events.length;
  const firstIndex = direction < 0 && pendingIndex !== null ? pendingIndex : safeIndex;
  const secondIndex = direction < 0 ? safeIndex : (pendingIndex ?? nextIndex);
  const renderSlide = (event, index) => {
    const start = event.eventDate ? new Date(event.eventDate) : null;
    const end = event.endDate ? new Date(event.endDate) : null;
    const validStart = start && !Number.isNaN(start.getTime());
    const time = validStart
      ? `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${end && !Number.isNaN(end.getTime()) ? ` – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}`
      : 'Time to be announced';
    return <article className="overview-event-slide" key={event._id}>
      <button className="overview-event-poster" type="button" onClick={() => onOpen(event)} aria-label={`Open ${event.title} details`}>
        {event.posterUrl
          ? <img src={event.posterUrl} alt={`${event.title} event poster`} />
          : <span className="overview-event-poster-fallback"><CalendarDays size={34} /><small>{event.clubId?.name || 'Campus event'}</small><strong>{event.title}</strong></span>}
        <span className="overview-event-poster-date">{formatDate(event.eventDate, { month: 'short', day: 'numeric' })}</span>
      </button>
      <div className="overview-event-copy">
        <div className="overview-event-topline"><span className="banner-kicker"><Sparkles size={14} />UPCOMING CAMPUS EVENT</span><span className="overview-event-count">{index + 1} / {events.length}</span></div>
        <span className="overview-event-club">{event.clubId?.name || 'Campus club'}</span>
        <h2>{event.title}</h2>
        <p className="overview-event-description">{event.description || 'Join your campus community for this upcoming event.'}</p>
        <div className="overview-event-meta">
          <span><CalendarDays size={16} /><span>{validStart ? formatDate(event.eventDate, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Date to be announced'}<small>{time}</small></span></span>
          {event.venueId?.name && <span><Compass size={16} /><span>{event.venueId.name}<small>{event.venueId.location || 'Campus venue'}</small></span></span>}
        </div>
        <div className="overview-event-bottom">
          <button className="button button-light" type="button" onClick={() => onOpen(event)}>Event details <ArrowRight size={16} /></button>
          {events.length > 1 && <div className="overview-event-controls" aria-label="Browse upcoming events">
            <button className="icon-button" type="button" onClick={() => moveTo(previousIndex)} disabled={pendingIndex !== null} aria-label="Previous event"><ChevronLeft size={18} /></button>
            <div className="overview-event-dots" aria-label={`Event ${safeIndex + 1} of ${events.length}`}>
              {events.map((item, itemIndex) => <button
                key={item._id}
                className={`overview-event-dot ${itemIndex === safeIndex ? 'overview-event-dot-active' : ''}`}
                type="button"
                onClick={() => moveTo(itemIndex)}
                disabled={pendingIndex !== null}
                aria-label={`Show event ${itemIndex + 1}: ${item.title}`}
                aria-current={itemIndex === safeIndex ? 'true' : undefined}
              />)}
            </div>
            <button className="icon-button" type="button" onClick={() => moveTo(nextIndex)} disabled={pendingIndex !== null} aria-label="Next event"><ChevronRight size={18} /></button>
          </div>}
        </div>
      </div>
    </article>;
  };
  const firstSlide = direction < 0 && pendingIndex !== null ? events[firstIndex] : activeEvent;
  const secondSlide = direction < 0 ? activeEvent : events[secondIndex];

  return <section
    className="overview-event-carousel"
    aria-label="Upcoming campus events"
    onMouseEnter={() => setPaused(true)}
    onMouseLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)}
    onBlur={(focusEvent) => {
      if (!focusEvent.currentTarget.contains(focusEvent.relatedTarget)) setPaused(false);
    }}
  >
    <div
      className={`overview-event-track ${pendingIndex !== null ? `overview-event-track-${direction > 0 ? 'next' : 'previous'}` : 'overview-event-track-idle'}`}
      onAnimationEnd={(animationEvent) => {
        if (animationEvent.target === animationEvent.currentTarget && pendingIndex !== null) finishTransition(pendingIndex);
      }}
    >
      {renderSlide(firstSlide, firstIndex)}
      {pendingIndex !== null && renderSlide(secondSlide, secondIndex)}
    </div>
  </section>;
}

function Dashboard({ profile, onLogout, onProfileUpdate, theme, onToggleTheme }) {
  const [page, setPage] = useState('overview');
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedClub, setSelectedClub] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [memberClubId, setMemberClubId] = useState('');
  const [members, setMembers] = useState([]);
  const [membersError, setMembersError] = useState('');
  const [memberActionError, setMemberActionError] = useState('');
  const [chatClubId, setChatClubId] = useState('');
  const [chatGroup, setChatGroup] = useState('members');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatError, setChatError] = useState('');
  const role = profile.role;
  const track = dashboardTrack(role, data.memberships);
  const copyTrack = track === 'president' ? 'office-bearer' : track;
  const navigation = useMemo(() => navigationFor(track), [track]);
  const isLeadership = (membership) => membership.membershipStatus !== 'pending'
    && (['executive', 'office_bearer', 'president', 'vice_president', 'treasurer', 'secretary'].includes(membership.position)
      || membership.officeBearerGroup);
  const isOfficeBearer = isOfficeBearerPosition;
  const canManage = role === 'college_admin' || data.memberships.some(isLeadership);
  const canReview = role === 'college_admin'
    || data.memberships.some(isOfficeBearer)
    || (role === 'faculty_coordinator' && data.managedClubs.some((club) =>
      String(club.mentor?._id || club.mentor || '') === String(profile._id)));
  const memberClubList = role === 'college_admin'
    ? data.managedClubs
    : data.managedClubs.filter((club) => data.memberships.some((membership) =>
      (membership.clubId?._id || membership.clubId) === club._id && isOfficeBearer(membership))
      || String(club.mentor?._id || club.mentor || '') === String(profile._id));
  const eventClubList = data.managedClubs.filter((club) => data.memberships.some((membership) =>
    (membership.clubId?._id || membership.clubId) === club._id
    && ['president', 'executive'].includes(membership.position)));
  useEffect(() => {
    if (!navigation.some((item) => item.id === page)) setPage('overview');
  }, [navigation, page]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setProblem('');
    try {
      const [clubs, managedClubs, memberships, venues, events, announcements, applications, registrations, participation, equipment, funding, transactions, borrows, summary, profiles, eventReports] = await Promise.all([
        api('/clubs'), api('/my/clubs'), api('/members/mine'), api('/venues'), api('/events/manage'),
        api('/announcements'), api('/applications'), api('/registrations'), api('/participation'), api('/equipment'),
        api('/funding-requests'),
        ['faculty_coordinator', 'college_admin'].includes(profile.role) ? api('/transactions') : Promise.resolve([]),
        api('/equipment-borrows'), api('/reports/summary'),
        profile.role === 'college_admin'
          ? api('/profiles')
          : profile.role === 'faculty_coordinator' ? api('/profiles/students') : Promise.resolve([]),
        api('/event-reports'),
      ]);
      setData({ clubs, managedClubs, memberships, venues, events, announcements, applications, registrations, participation, equipment, funding, transactions, borrows, summary, profiles, eventReports });
    } catch (error) {
      setProblem(error.message);
    } finally {
      setLoading(false);
    }
  }, [profile.role]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!memberClubList.length) {
      setMemberClubId('');
      setMembers([]);
      return;
    }
    if (!memberClubList.some((club) => club._id === memberClubId)) {
      setMemberClubId(memberClubList[0]._id);
    }
  }, [memberClubList, memberClubId]);

  useEffect(() => {
    if (page !== 'members' || !memberClubId) return undefined;
    let active = true;
    setMembersError('');
    api(`/members?clubId=${encodeURIComponent(memberClubId)}`)
      .then((result) => { if (active) setMembers(result); })
      .catch((error) => { if (active) setMembersError(error.message); });
    return () => { active = false; };
  }, [memberClubId, page, data.managedClubs]);

  useEffect(() => {
    if (page !== 'chats' || !chatClubId) return undefined;
    let active = true;
    setChatError('');
    api(`/clubs/${chatClubId}/messages?group=${encodeURIComponent(chatGroup)}`)
      .then((messages) => { if (active) setChatMessages(messages.reverse()); })
      .catch((error) => { if (active) { setChatMessages([]); setChatError(error.message); } });
    return () => { active = false; };
  }, [chatClubId, chatGroup, page]);

  useEffect(() => {
    if (!chatClubId && data.managedClubs.length) setChatClubId(data.managedClubs[0]._id);
    if (chatClubId && !data.managedClubs.some((club) => club._id === chatClubId)) {
      setChatClubId(data.managedClubs[0]?._id || '');
    }
  }, [chatClubId, data.managedClubs]);

  const currentPage = navigation.find((item) => item.id === page) || navigation[0];
  const filteredClubs = useMemo(() => data.clubs.filter((club) =>
    `${club.name} ${club.category} ${club.description}`.toLowerCase().includes(search.toLowerCase())), [data.clubs, search]);
  const featuredEvents = useMemo(() => data.events
    .filter((event) => event.status === 'approved' && new Date(event.eventDate) >= new Date())
    .sort((first, second) => new Date(first.eventDate) - new Date(second.eventDate))
    .slice(0, 8), [data.events]);

  const createRecord = async (type, values) => {
    setBusy(true);
    try {
      if (type === 'editClub') {
        values.mentor = values.mentor || null;
        values.recruitmentOpen = values.recruitmentOpen === 'true';
      } else if (type === 'club') {
        values.recruitmentOpen = values.recruitmentOpen === 'true';
      }
      const routes = {
        apply: '/applications',
        event: '/events',
        announcement: '/announcements',
        equipment: '/equipment',
        funding: '/funding-requests',
        budget: '/budgets',
        transaction: '/transactions',
        club: '/clubs',
      };
      const request = type === 'editClub'
        ? api(`/clubs/${selectedClub._id}`, { method: 'PATCH', body: values })
        : api(routes[type], { method: 'POST', body: values });
      await request;
      setModal('');
      setToast(type === 'apply' ? 'Your application is on its way.' : 'Saved. The right people are in the loop.');
      await refresh();
      return '';
    } catch (error) {
      return error.message;
    } finally {
      setBusy(false);
    }
  };

  const perform = async (request, successMessage) => {
    try {
      await request();
      setToast(successMessage);
      await refresh();
    } catch (error) {
      setToast(error.message);
    }
  };

  const review = (kind, item, status) => {
    const rejectionFeedback = status === 'rejected'
      ? window.prompt('Please provide a reason for rejecting this request:')
      : '';
    if (status === 'rejected' && !rejectionFeedback?.trim()) return;
    const routes = {
      application: `/applications/${item._id}`,
      event: `/events/${item._id}/approval`,
      funding: `/funding-requests/${item._id}/approval`,
      borrow: `/equipment-borrows/${item._id}/approval`,
      eventReport: `/event-reports/${item._id}/approval`,
    };
    perform(() => api(routes[kind], {
      method: 'PATCH',
      body: { status, ...(rejectionFeedback ? { rejectionFeedback: rejectionFeedback.trim() } : {}) },
    }), `Request ${status}.`);
  };

  const updateMemberRole = async (memberId, nextPosition) => {
    try {
      await api(`/members/${memberId}`, { method: 'PATCH', body: nextPosition });
      setToast('Club role updated.');
      setMembers(await api(`/members?clubId=${encodeURIComponent(memberClubId)}`));
    } catch (error) {
      setToast(error.message);
    }
  };

  const removeMember = async (member) => {
    const name = member.profileId?.name || 'this student';
    if (!window.confirm(`End ${name}'s membership in this club? Their account will remain active.`)) return;
    try {
      await api(`/members/${member._id}`, { method: 'DELETE' });
      setToast('Club membership ended. The student account is unchanged.');
      setMembers(await api(`/members?clubId=${encodeURIComponent(memberClubId)}`));
      await refresh();
    } catch (error) {
      setToast(error.message);
    }
  };

  const respondToPositionInvite = async (membership, response) => {
    try {
      await api(`/members/${membership._id}/respond`, {
        method: 'PATCH',
        body: { response },
      });
      setToast(response === 'accepted' ? 'Office-bearer invitation accepted.' : 'Office-bearer invitation declined.');
      await refresh();
    } catch (error) {
      setToast(error.message);
    }
  };

  const assignMember = async (event) => {
    event.preventDefault();
    setMemberActionError('');
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await api(`/clubs/${memberClubId}/members`, { method: 'POST', body: values });
      setToast('Office-bearer invitation sent. The student must accept before the role becomes active.');
      form.reset();
      await refresh();
      setMembers(await api(`/members?clubId=${encodeURIComponent(memberClubId)}`));
    } catch (error) {
      setMemberActionError(error.message);
    }
  };

  const downloadClubReport = () => {
    const rows = [
      ['Club', 'Category', 'Members', 'Events', 'Pending applications', 'Announcements', 'Allocated budget', 'Spent'],
      ...(data.summary.clubReports || []).map((club) => [
        club.name, club.category, club.members, club.events, club.pendingApplications,
        club.announcements, club.allocated, club.spent,
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const file = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'my-amrita-club-report.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const navigate = (id) => { setPage(id); setMenuOpen(false); setSearch(''); };
  const sendChatMessage = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const content = new FormData(form).get('content');
    try {
      await api(`/clubs/${chatClubId}/messages`, { method: 'POST', body: { group: chatGroup, content } });
      form.reset();
      setChatMessages(await api(`/clubs/${chatClubId}/messages?group=${encodeURIComponent(chatGroup)}`).then((messages) => messages.reverse()));
    } catch (error) {
      setChatError(error.message);
    }
  };
  const registrationByEvent = new Map(data.registrations.filter((item) => item.status === 'registered')
    .map((item) => [typeof item.eventId === 'object' ? item.eventId?._id : item.eventId, item]));
  const applicationByClub = new Map([...data.applications].reverse().map((item) => [
    typeof item.clubId === 'object' ? item.clubId?._id : item.clubId, item,
  ]));
  const membershipClubIds = new Set(data.memberships.filter((item) => item.membershipStatus !== 'pending')
    .map((item) => item.clubId?._id || item.clubId));

  const pageAction = () => {
    if (page === 'clubs' && role === 'college_admin') return <button className="button button-primary" onClick={() => setModal('club')}><Plus size={16} /> Create club</button>;
    if (page === 'events' && eventClubList.length) return <button className="button button-primary" onClick={() => setModal('event')}><Plus size={16} /> Propose event</button>;
    if (page === 'announcements' && canManage) return <button className="button button-primary" onClick={() => setModal('announcement')}><Plus size={16} /> New announcement</button>;
    if (page === 'equipment' && canManage) return <button className="button button-primary" onClick={() => setModal('equipment')}><Plus size={16} /> Add equipment</button>;
    if (page === 'funding' && role === 'college_admin') return <div className="heading-button-group"><button className="button button-outline" onClick={() => setModal('budget')}><Plus size={15} /> Set budget</button><button className="button button-outline" onClick={() => setModal('transaction')}><Plus size={15} /> Record transaction</button><button className="button button-primary" onClick={() => setModal('funding')}><Plus size={15} /> New request</button></div>;
    if (page === 'funding' && canManage) return <button className="button button-primary" onClick={() => setModal('funding')}><Plus size={16} /> New request</button>;
    if (page === 'reports' && role !== 'student') return <button className="button button-outline" onClick={downloadClubReport}><Download size={15} /> Export CSV</button>;
    return null;
  };

  const openApplications = data.applications.filter((item) => item.status === 'pending'
    && String(item.profileId?._id || item.profileId) !== String(profile._id));
  const greetingName = profile.name?.split(' ')[0] || 'there';

  return (
    <div className={`app-shell shell-${track}`}>
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); navigate('overview'); }}>
          <span className="brand-wordmark"><span>my</span> AMRITA</span>
        </a>
        <div className="campus-label"><span className="campus-dot" />{{
          'student-affairs': 'CAMPUS ADMINISTRATION',
          mentor: 'FACULTY WORKSPACE',
          president: 'PRESIDENT’S OFFICE',
          'office-bearer': 'CLUB LEADERSHIP',
          executive: 'CLUB EXECUTIVE',
          student: 'STUDENT COMMUNITY',
        }[track]}</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${page === id ? 'nav-active' : ''}`} onClick={() => navigate(id)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {id === 'applications' && canReview && openApplications.length > 0 && <b className="nav-count">{openApplications.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-help"><div className="help-icon"><CircleHelp size={17} /></div><strong>{track === 'president' ? 'You’re the president' : copyTrack === 'student-affairs' ? 'Campus-wide view' : copyTrack === 'mentor' ? 'Your assigned clubs' : copyTrack === 'office-bearer' ? 'Lead your community' : copyTrack === 'executive' ? 'Build together' : 'Find your people'}</strong><span>{track === 'president' ? 'Your mentor approves events; you recruit and report.' : copyTrack === 'student-affairs' ? 'Create clubs and coordinate mentors.' : copyTrack === 'mentor' ? 'Guide club leaders and event approvals.' : copyTrack === 'office-bearer' ? 'Welcome members and keep your club moving.' : copyTrack === 'executive' ? 'Help bring club events to life.' : 'Campus life can get busy. We’re right here.'}</span></div>
          <div className="profile-switch">
            <Avatar person={profile} className="user-avatar" />
            <span className="profile-meta"><strong>{profile.name}</strong><small>{profileTrackLabel(profile, track)}</small><small>{profile.email}</small></span>
            <button className="profile-edit-button" onClick={() => navigate('profile')}>Profile</button>
            <button className="sidebar-logout" onClick={onLogout} aria-label="Sign out"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMenuOpen(!menuOpen)}><Menu size={21} /></button>
          <div className="breadcrumbs"><span>my AMRITA</span><span className="crumb-slash">/</span><strong>{currentPage.label}</strong></div>
          <div className="topbar-right">
            <span className="role-pill">{profileTrackLabel(profile, track)}</span>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <button className="button button-outline topbar-logout" onClick={onLogout}><LogOut size={15} /> Log out</button>
            <button className="icon-button notification-button" aria-label="Your notifications" onClick={() => navigate('announcements')}><Bell size={18} /><i /></button>
            <button className="topbar-avatar" onClick={() => navigate('profile')} title="My profile"><Avatar person={profile} className="avatar-inner" /><ChevronDown size={13} /></button>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div><span className="eyebrow">{currentPage.id === 'overview' ? ({
              'student-affairs': 'STUDENT AFFAIRS DESK',
              mentor: 'FACULTY MENTOR DESK',
              president: 'PRESIDENT’S DESK',
              'office-bearer': 'CLUB LEADERSHIP DESK',
              executive: 'YOUR CLUB WORKSPACE',
              student: 'YOUR CAMPUS, YOUR PACE',
            }[track]) : 'CAMPUS COMMUNITY'}</span><h1>{page === 'overview' ? (track === 'president' ? `Lead your club, ${greetingName}.` : copyTrack === 'student-affairs' ? 'Campus, connected.' : copyTrack === 'mentor' ? `Welcome back, ${greetingName}.` : copyTrack === 'office-bearer' ? `Lead with care, ${greetingName}.` : copyTrack === 'executive' ? `Make things happen, ${greetingName}.` : `A little more campus, ${greetingName}.`) : currentPage.label}</h1>
              <p>{page === 'overview' ? ({
                'student-affairs': 'Create clubs, assign mentors, and keep campus life moving.',
                mentor: 'Support your assigned clubs and guide their next steps.',
                president: 'Run your club: recruit executives, plan events, and file reports.',
                'office-bearer': 'Review applications, support your members, and grow your club.',
                executive: 'Plan events, stay connected, and make your club ideas real.',
                student: 'Find your people. Make a plan. See what’s happening around you.',
              }[track]) : pageDescription(page, role)}</p>
            </div>
            <div className="heading-actions">{pageAction()}</div>
          </div>

          {problem && <div className="connection-alert"><span className="connection-dot" /><div><strong>Couldn’t load your campus data</strong><p>{problem}</p></div><button onClick={refresh}>Try again</button></div>}
          {loading && <div className="loading-line"><span /> Bringing your campus together…</div>}

          {!problem && page === 'overview' && (
            <>
              {featuredEvents.length
                ? <OverviewEventCarousel events={featuredEvents} onOpen={setSelectedEvent} />
                : <section className="welcome-banner">
                  <div className="welcome-copy"><span className="banner-kicker"><Sparkles size={14} />{{
                    'student-affairs': 'CAMPUS AT A GLANCE',
                    mentor: 'YOUR MENTORSHIP, IN MOTION',
                    president: 'YOU LEAD THIS CLUB',
                    'office-bearer': 'A GOOD DAY TO LEAD',
                    executive: 'MAKE YOUR NEXT IDEA HAPPEN',
                    student: 'A GOOD DAY TO GET INVOLVED',
                  }[track]}</span><h2>{track === 'president' ? <>Your club,<br />your vision.</> : copyTrack === 'student-affairs' ? <>Good clubs make<br />a great campus.</> : copyTrack === 'mentor' ? <>Guide the people<br />who lead.</> : copyTrack === 'office-bearer' ? <>Big ideas start<br />with showing up.</> : copyTrack === 'executive' ? <>Plan together.<br />Make it happen.</> : <>Big ideas start<br />with showing up.</>}</h2><p>{track === 'president' ? 'Recruit your executives, get events approved, and keep your mentor in the loop.' : copyTrack === 'student-affairs' ? 'Build strong club foundations and keep every community supported.' : copyTrack === 'mentor' ? 'Your guidance helps student leaders turn plans into progress.' : copyTrack === 'office-bearer' ? 'Welcome new members and help your club make its mark.' : copyTrack === 'executive' ? 'Your next event starts with one good idea.' : 'Meet a club, explore events, or start something new.'}</p>
                    <button className="button button-light" onClick={() => navigate(track === 'president' ? 'applications' : copyTrack === 'student-affairs' ? 'clubs' : copyTrack === 'mentor' ? 'members' : copyTrack === 'office-bearer' ? 'applications' : copyTrack === 'executive' ? 'events' : 'clubs')}>{track === 'president' ? 'Recruit executives' : copyTrack === 'student-affairs' ? 'Manage clubs' : copyTrack === 'mentor' ? 'Support club leaders' : copyTrack === 'office-bearer' ? 'Review applications' : track === 'executive' ? 'Explore events' : 'Find your community'} <ArrowRight size={16} /></button>
                  </div>
                  <div className="banner-graphic" aria-hidden="true"><span className="graphic-ring ring-a" /><span className="graphic-ring ring-b" /><span className="graphic-star">✳</span><span className="graphic-caption">MAKE<br />IT YOURS</span><span className="graphic-orbit"><i /><i /><i /></span></div>
                </section>}

              <section className="stat-grid">
                <StatCard icon={Compass} label="Clubs to explore" value={data.summary.clubs} foot="Find your corner of campus" tone="lavender" />
                <StatCard icon={CalendarDays} label="Events on the calendar" value={data.events.filter((event) => event.status === 'approved').length} foot="More moments, less scrolling" tone="peach" />
                <StatCard icon={Users} label="People showing up" value={data.summary.members} foot="Campus is better together" tone="mint" />
                <StatCard icon={Clock3} label="Needs a little attention" value={canReview ? openApplications.length : data.applications.filter((app) => app.status === 'pending').length} foot={canReview ? 'Applications to review' : 'Membership applications'} tone="butter" />
              </section>

              <section className="portal-shortcuts" aria-label="Campus services">
                <h2>Campus services</h2>
                <div className="portal-shortcut-grid">
                  {navigation.filter(({ id }) => id !== 'overview').map(({ id, label, icon: Icon }) => (
                    <button className="portal-shortcut" key={id} onClick={() => navigate(id)}>
                      <span>{label}</span><i><Icon size={17} /></i>
                    </button>
                  ))}
                </div>
              </section>

              {track === 'president' && <section className="president-desk surface-card">
                <SectionHeading title="President’s desk" subtitle={`You lead ${data.memberships.filter((m) => m.membershipStatus !== 'pending' && m.position === 'president').map((m) => m.clubId?.name).filter(Boolean).join(', ') || 'your club'}.`} />
                <div className="president-actions">
                  <button onClick={() => navigate('applications')}><Users size={17} /><strong>Recruit executives</strong><small>{openApplications.length} application{openApplications.length === 1 ? '' : 's'} waiting</small></button>
                  <button onClick={() => navigate('events')}><CalendarDays size={17} /><strong>Plan an event</strong><small>Propose it to your mentor</small></button>
                  <button onClick={() => navigate('eventReports')}><FolderKanban size={17} /><strong>Event reports</strong><small>Submit after each event</small></button>
                  <button onClick={() => navigate('equipment')}><Laptop size={17} /><strong>Equipment</strong><small>Request club equipment</small></button>
                </div>
              </section>}

              <div className="content-grid">
                <section className="surface-card feature-card">
                  <SectionHeading title="A few good things coming up" subtitle="Make a little room in your calendar." action="See all events" onAction={() => navigate('events')} />
                  {data.events.filter((event) => event.status === 'approved').slice(0, 3).map((event, index) => <EventRow key={event._id} event={event} index={index} onDetails={() => setSelectedEvent(event)} />)}
                  {!data.events.some((event) => event.status === 'approved') && <EmptyState title="A little quiet for now" text="New events will find their way here." />}
                </section>
                <section className="surface-card announcement-card">
                  <SectionHeading title="Around campus" subtitle="Notes from your community." action="All notes" onAction={() => navigate('announcements')} />
                  {data.announcements.slice(0, 3).map((note) => <AnnouncementRow key={note._id} note={note} />)}
                  {!data.announcements.length && <EmptyState title="Nothing new just yet" text="Club updates will appear here." />}
                </section>
              </div>
              {role !== 'student' && <div className="insight-strip"><div className="insight-icon"><FolderKanban size={18} /></div><div><strong>Your community, at a glance</strong><span>{formatMoney(data.summary.spent)} spent of {formatMoney(data.summary.allocated)} allocated across club budgets.</span></div><button onClick={() => navigate('funding')}>Explore funding <ArrowRight size={15} /></button></div>}
            </>
          )}

          {!problem && page === 'clubs' && (
            <>
              <div className="toolbar"><div className="search-box"><Search size={17} /><input aria-label="Search clubs" placeholder="Find a club that feels like you…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><span className="result-count">{filteredClubs.length} communities</span></div>
              <div className="club-grid">
                {filteredClubs.map((club, index) => {
                  const application = applicationByClub.get(club._id);
                  return <ClubCard
                    key={club._id}
                    club={club}
                    index={index}
                    application={application}
                    isMember={membershipClubIds.has(club._id)}
                    isAdmin={role === 'college_admin'}
                    onApply={() => { setSelectedClub(club); setModal('apply'); }}
                    onEdit={() => { setSelectedClub(club); setModal('editClub'); }}
                  />;
                })}
              </div>
              {!filteredClubs.length && <EmptyState title="No clubs found" text="Try another search or come back as new communities join." />}
            </>
          )}

          {!problem && page === 'events' && (
            <div className="surface-card list-surface">
              <SectionHeading title="Make a date with campus" subtitle="Good company is already on the calendar." />
              <div className="events-grid">
              {data.events.map((event, index) => {
                const clubId = event.clubId?._id || event.clubId;
                const eventPosition = data.memberships.find((member) => (member.clubId?._id || member.clubId) === clubId);
                const isEventLeader = role === 'college_admin' || Boolean(eventPosition && isLeadership(eventPosition));
                const isPresident = eventPosition?.position === 'president';
                const isMentor = String(event.clubId?.mentor?._id || event.clubId?.mentor || '') === String(profile._id);
                const canReviewEvent = event.status === 'mentor_pending'
                  ? isMentor
                  : event.status === 'student_affairs_pending' && role === 'college_admin';
                return <div key={event._id} className="event-workflow">
                  <EventRow event={event} index={index} canReview={canReviewEvent} isPresident={isPresident} onDetails={() => setSelectedEvent(event)} onReview={(status) => review('event', event, status)} onResubmit={() => perform(() => api(`/events/${event._id}/submit`, { method: 'PATCH' }), 'Event resubmitted to the club mentor.')} />
                  {isEventLeader && event.status === 'approved' && <AttendancePanel event={event} onError={setToast} />}
                  {isPresident && event.status === 'approved' && new Date(event.eventDate) <= new Date()
                    && !data.eventReports.some((report) => (report.eventId?._id || report.eventId) === event._id)
                    && <EventReportComposer event={event} onSubmit={refresh} />}
                </div>;
              })}
              {!data.events.length && <EmptyState title="The calendar is taking a breath" text="Approved campus events will show up here." />}
              </div>
            </div>
          )}

          {!problem && page === 'applications' && (
            <>
            <div className="two-column-layout">
              <section className="surface-card list-surface"><SectionHeading title={role === 'student' ? 'Your membership journey' : 'A few people are waiting'} subtitle={role === 'student'
                ? 'Every great community starts somewhere.'
                : role === 'faculty_coordinator'
                  ? 'As a club mentor, review applications and recruit members before office bearers are appointed.'
                  : 'Help someone find their people.'} />
                {data.memberships.filter((membership) => membership.membershipStatus === 'pending').map((membership) => (
                  <PositionInvitation key={membership._id} membership={membership}
                    onRespond={(response) => respondToPositionInvite(membership, response)} />
                ))}
                {data.applications.map((application) => {
                  const clubId = application.clubId?._id || application.clubId;
                  const applicationClub = data.clubs.find((club) => club._id === clubId);
                  const isClubMentor = role === 'faculty_coordinator'
                    && String(applicationClub?.mentor?._id || applicationClub?.mentor || '') === String(profile._id);
                  const canReviewApplication = role === 'college_admin' || isClubMentor || data.memberships.some((membership) =>
                    (membership.clubId?._id || membership.clubId) === clubId
                    && membership.membershipStatus !== 'pending'
                    && (['office_bearer', 'president', 'vice_president', 'treasurer', 'secretary'].includes(membership.position)
                      || (membership.position === 'executive' && membership.officeBearerGroup)));
                  return <ApplicationRow key={application._id} application={application} isOwn={String(application.profileId?._id || application.profileId) === String(profile._id)} canReview={canReviewApplication} onReview={(status) => review('application', application, status)} />;
                })}
                {!data.applications.length && <EmptyState title="Nothing to review yet" text={role === 'student' ? 'Apply to a club and you’ll see your updates here.' : 'Club applications will appear here.'} />}
              </section>
              <aside className="surface-card tip-card"><span className="tip-spark"><Sparkles size={19} /></span><span className="eyebrow">A SMALL REMINDER</span><h3>There’s no one way to belong.</h3><p>Try a workshop, volunteer once, or just say hello. The best communities make space for every kind of curious.</p><button className="text-link" onClick={() => navigate('clubs')}>Find your people <ArrowRight size={15} /></button></aside>
            </div>
            {role === 'student' && <section className="surface-card participation-card"><SectionHeading title="Your campus moments" subtitle="A little record of the things you showed up for." />
              {data.participation.map((record) => <ParticipationRow key={record._id} record={record} />)}
              {!data.participation.length && <EmptyState title="Your story starts here" text="Events you attend will show up here as a keepsake." />}
            </section>}
            </>
          )}

          {!problem && page === 'members' && (
            <section className="surface-card member-surface">
              <div className="member-toolbar">
                <SectionHeading title="The people who make it happen" subtitle={role === 'faculty_coordinator'
                  ? 'Approve an application first, then invite that active member to an office-bearer position. They must accept the invitation.'
                  : 'A good community starts with good company.'} />
                <label className="club-picker">Club<select value={memberClubId} onChange={(event) => setMemberClubId(event.target.value)} disabled={!memberClubList.length}>
                  {memberClubList.map((club) => <option key={club._id} value={club._id}>{club.name}</option>)}
                </select></label>
              </div>
              {memberClubId && (role === 'college_admin' || memberClubList.some((club) =>
                String(club.mentor?._id || club.mentor || '') === String(profile._id))) && <form className="member-assign-form" onSubmit={assignMember}>
                <label className="field-label">Nominee<select name="profileId" required defaultValue=""><option value="" disabled>Select an active club member</option>{data.profiles.filter((person) => ['student', 'club_committee'].includes(person.role)
                  && members.some((member) => String(member.profileId?._id || member.profileId) === String(person._id)
                    && member.membershipStatus === 'active')).map((person) => <option key={person._id} value={person._id}>{person.name} · {person.email}</option>)}</select></label>
                <label className="field-label">Invite for position<select name="position"><option value="president">President</option><option value="vice_president">Vice president</option><option value="treasurer">Treasurer</option><option value="secretary">Secretary</option><option value="office_bearer">Office bearer</option></select></label>
                <label className="field-label">Custom position title (optional)<input name="positionTitle" maxLength={80} placeholder="e.g. Creative Director" /></label>
                <button className="button button-primary" type="submit"><Plus size={15} /> Send invitation</button>
              </form>}
              {memberActionError && <div className="notice notice-error" role="alert">{memberActionError}</div>}
              {membersError && <div className="notice notice-error" role="alert">{membersError}</div>}
              {!memberClubList.length ? <EmptyState title="No club roster access" text="A club's office bearers and Student Affairs can view its member list." /> :
                members.length ? members.map((member) => {
                  const selectedClub = memberClubList.find((club) => club._id === memberClubId);
                  const isAssignedMentor = String(selectedClub?.mentor?._id || selectedClub?.mentor || '') === String(profile._id);
                  return <MemberRow key={member._id} member={member} canEdit={isAssignedMentor || role === 'college_admin'} canRemove={isAssignedMentor || role === 'college_admin'} onRemove={() => removeMember(member)} onRoleChange={(position, positionTitle, officeBearerGroup) => updateMemberRole(member._id, { position, positionTitle, officeBearerGroup })} />;
                }) :
                  !membersError && <EmptyState title="The first hello is still ahead" text="No one has joined this club yet." />}
            </section>
          )}

          {!problem && page === 'chats' && (
            <section className="surface-card chat-surface">
              <div className="member-toolbar">
                <SectionHeading title="Club conversations" subtitle="Member chat is for club members; the OB room stays private to office bearers." />
                <div className="chat-controls">
                  <label className="club-picker">Club<select value={chatClubId} onChange={(event) => setChatClubId(event.target.value)}>
                    {data.managedClubs.map((club) => <option key={club._id} value={club._id}>{club.name}</option>)}
                  </select></label>
                  <label className="club-picker">Room<select value={chatGroup} onChange={(event) => setChatGroup(event.target.value)}>
                    <option value="members">Club members</option><option value="office_bearers">Office bearers (private)</option>
                  </select></label>
                </div>
              </div>
              {chatError && <div className="notice notice-error" role="alert">{chatError}</div>}
              <div className="chat-messages" aria-live="polite">
                {chatMessages.map((message) => <article className="chat-message" key={message._id}><strong>{message.senderId?.name || 'Club member'}</strong><p>{message.content}</p><time>{formatDate(message.createdAt, { month: 'short', day: 'numeric' })}</time></article>)}
                {!chatMessages.length && !chatError && <EmptyState title="Start the conversation" text="Share an update or a little encouragement with the club." />}
              </div>
              {chatClubId && <form className="chat-compose" onSubmit={sendChatMessage}><input name="content" required maxLength={2000} placeholder="Write a message…" aria-label="Chat message" /><button className="button button-primary" type="submit">Send <ArrowRight size={15} /></button></form>}
            </section>
          )}

          {!problem && page === 'equipment' && (
            <>
              <div className="resource-grid">
                {data.equipment.map((item, index) => {
                  const clubId = item.clubId?._id || item.clubId;
                  const activeBorrow = data.borrows.find((borrow) => borrow.equipmentId?._id === item._id && String(borrow.profileId?._id || borrow.profileId) === String(profile._id));
                  const isPresident = data.memberships.some((membership) =>
                    (membership.clubId?._id || membership.clubId) === clubId && membership.position === 'president');
                  return <EquipmentCard key={item._id} equipment={item} index={index} isPresident={isPresident} activeBorrow={activeBorrow} onBorrow={() => perform(() => api('/equipment-borrows', { method: 'POST', body: { equipmentId: item._id, clubId, dueDate: new Date(Date.now() + 7 * 86400000).toISOString() } }), 'Request sent to your club mentor and Student Affairs.')} onReturn={() => perform(() => api(`/equipment-borrows/${activeBorrow._id}/return`, { method: 'PATCH' }), 'Thanks for bringing it back.') } />;
                })}
                {!data.equipment.length && <EmptyState title="Nothing in the loan cupboard yet" text="Club equipment will be listed here when it’s available." />}
              </div>
              {data.borrows.some((borrow) => ['mentor_pending', 'student_affairs_pending'].includes(borrow.status)) && <section className="surface-card list-surface workflow-list">
                <SectionHeading title="Equipment approvals" subtitle="Requests move from the club mentor to Student Affairs." />
                {data.borrows.filter((borrow) => ['mentor_pending', 'student_affairs_pending'].includes(borrow.status)).map((borrow) => {
                  const club = data.clubs.find((item) => item._id === (borrow.clubId?._id || borrow.clubId));
                  const mentorReview = borrow.status === 'mentor_pending' && String(club?.mentor?._id || club?.mentor || '') === String(profile._id);
                  const affairsReview = borrow.status === 'student_affairs_pending' && role === 'college_admin';
                  return <BorrowApprovalRow key={borrow._id} borrow={borrow} canReview={mentorReview || affairsReview} onReview={(status) => review('borrow', borrow, status)} />;
                })}
              </section>}
            </>
          )}

          {!problem && page === 'funding' && (
            <div className="content-grid funding-layout">
              <section className="surface-card list-surface"><SectionHeading title="Funding & club budgets" subtitle="Good plans deserve a little support." />
                <div className="budget-highlight"><span className="budget-label">CAMPUS CLUBS · TOTAL SPENT</span><strong>{formatMoney(data.summary.spent)}</strong><div className="budget-progress"><i style={{ width: `${data.summary.allocated ? Math.min(data.summary.spent / data.summary.allocated * 100, 100) : 0}%` }} /></div><span className="budget-foot">{formatMoney(data.summary.allocated)} total allocated</span></div>
                {data.funding.map((item) => {
                  const requestClubId = item.clubId?._id || item.clubId;
                  const mentor = data.clubs.find((club) => club._id === requestClubId)?.mentor;
                  return <FundingRow key={item._id} request={item} canReview={role === 'college_admin' || String(mentor?._id || mentor || '') === String(profile._id)} onReview={(status) => review('funding', item, status)} />;
                })}
                {!data.funding.length && <EmptyState title="Space for a bright idea" text="Funding requests from your clubs will show up here." />}
                {data.transactions.length > 0 && <><SectionHeading title="Recent ledger activity" subtitle="The numbers behind plans in motion." />{data.transactions.slice(0, 6).map((transaction) => <TransactionRow key={transaction._id} transaction={transaction} />)}</>}
              </section>
              <aside className="surface-card money-note"><div className="money-icon"><HandCoins size={20} /></div><h3>Make a plan happen.</h3><p>Club committees can send a funding request to their faculty coordinator. Approved funds are recorded in the club ledger.</p><div className="money-note-bottom"><CreditCard size={17} /><span>Transparent by design</span></div></aside>
            </div>
          )}

          {!problem && page === 'reports' && (
            <section className="report-page">
              <div className="report-stat-grid">
                <ReportStat label="Club communities" value={data.summary.clubs} tone="lavender" />
                <ReportStat label="Members" value={data.summary.members} tone="mint" />
                <ReportStat label="Events" value={data.summary.events} tone="peach" />
                <ReportStat label="Pending applications" value={data.summary.pendingApplications} tone="butter" />
              </div>
              <div className="report-table surface-card">
                <SectionHeading title="Club activity" subtitle="Membership, events, and announcements—one clear view." />
                <div className="report-table-head"><span>Community</span><span>Members</span><span>Events</span><span>Activity</span><span>Budget</span></div>
                {(data.summary.clubReports || []).map((club) => <div className="report-table-row" key={club._id}>
                  <div className="report-club"><span className="report-club-mark">{initials(club.name)}</span><span><strong>{club.name}</strong><small>{club.category || 'Campus community'}</small></span></div>
                  <span>{club.members}</span><span>{club.events}</span><span>{club.announcements} updates</span>
                  <span>{role === 'student' ? '—' : <>{formatMoney(club.spent)} <small>of {formatMoney(club.allocated)}</small></>}</span>
                </div>)}
                {!data.summary.clubReports?.length && <EmptyState title="No club reports yet" text="Reports for the clubs you manage will appear here." />}
              </div>
              {role !== 'student' && <div className="report-note"><ShieldCheck size={17} /><span>Financial details are scoped to the clubs you manage. Export a CSV when you need to share a snapshot.</span></div>}
            </section>
          )}

          {page === 'profile' && <ProfilePage profile={profile} onSaved={onProfileUpdate} notify={setToast} />}

          {!problem && page === 'eventReports' && (
            <section className="surface-card list-surface">
              <SectionHeading title="Event reports & OD attendance" subtitle="Presidents submit a detailed report after each event. The mentor reviews it before Student Affairs." />
              {data.eventReports.map((report) => {
                const clubId = report.clubId?._id || report.clubId;
                const club = data.clubs.find((item) => item._id === clubId);
                const isPresident = data.memberships.some((membership) =>
                  (membership.clubId?._id || membership.clubId) === clubId && membership.position === 'president');
                const canReviewReport = (report.status === 'mentor_pending' && String(club?.mentor?._id || club?.mentor || '') === String(profile._id))
                  || (report.status === 'student_affairs_pending' && role === 'college_admin');
                return <ReportRow key={report._id} report={report} isPresident={isPresident} canReview={canReviewReport}
                  onReview={(status) => review('eventReport', report, status)}
                  onDownload={() => apiDownload(`/event-reports/${report._id}/roster`, report.rosterFileName || 'event-attendance.csv')
                    .catch((error) => setToast(error.message))}
                  onResubmit={(values) => api(`/event-reports/${report._id}/resubmit`, { method: 'PATCH', body: values }).then(refresh)}
                  onError={setToast} />;
              })}
              {!data.eventReports.length && <EmptyState title="No event reports submitted" text="When a club event is complete, its president can submit the detailed report here." />}
            </section>
          )}

          {!problem && page === 'announcements' && (
            <section className="announcement-list">
              {data.announcements.map((note) => <article className="surface-card announcement-full" key={note._id}><div className={`announcement-symbol ${note.priority === 'high' ? 'symbol-warm' : ''}`}><Megaphone size={19} /></div><div className="announcement-content"><div className="announcement-meta"><span>{note.clubId?.name || 'Campus community'}</span><span>·</span><span>{formatDate(note.postedDate)}</span>{note.priority === 'high' && <span className="priority-label">IMPORTANT</span>}</div><h3>{note.title}</h3><p>{note.content}</p></div></article>)}
              {!data.announcements.length && <EmptyState title="A quiet noticeboard" text="When clubs share an update, you’ll find it here." />}
            </section>
          )}
        </div>
      </main>

      {toast && <div className="toast" role="status"><span><Check size={15} /></span>{toast}<button onClick={() => setToast('')} aria-label="Dismiss"><X size={15} /></button></div>}
      {selectedEvent && <EventDetailsDialog
        event={selectedEvent}
        events={data.events}
        registrations={registrationByEvent}
        onNavigate={setSelectedEvent}
        onClose={() => setSelectedEvent(null)}
        canRegister={role !== 'college_admin'}
        onRegister={(event) => perform(() => api('/registrations', { method: 'POST', body: { eventId: event._id } }), 'You’re registered for this event.')}
        onCancel={(event) => {
          const registration = registrationByEvent.get(event._id);
          return registration && perform(() => api(`/registrations/${registration._id}`, { method: 'DELETE' }), 'Your registration has been cancelled.');
        }}
      />}
      {modal && <Modal
        type={modal}
        clubs={modal === 'apply' ? data.clubs : modal === 'event' ? eventClubList : memberClubList}
        profiles={data.profiles}
        venues={data.venues}
        profile={profile}
        selectedClub={modal === 'club' ? null : modal === 'apply' || modal === 'editClub' ? selectedClub : modal === 'event' ? eventClubList[0] : memberClubList[0]}
        busy={busy}
        onClose={() => setModal('')}
        onSubmit={createRecord}
      />}
    </div>
  );
}

function Avatar({ person, className = '' }) {
  return person?.avatarUrl
    ? <span className={`${className} avatar-photo`}><img src={person.avatarUrl} alt="" /></span>
    : <span className={className}>{initials(person?.name)}</span>;
}

function resizeImage(file, size = 256, outputType = 'image/jpeg', square = true) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { reject(new Error('Choose a PNG, JPEG or WebP image.')); return; }
    if (outputType === 'image/png' && file.type !== 'image/png') { reject(new Error('Club logos must be PNG images.')); return; }
    if (file.size > 12_000_000) { reject(new Error('Choose an image smaller than 12 MB.')); return; }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, size / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = square ? size : width;
      canvas.height = square ? size : height;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error('Your browser could not process this image.'));
        return;
      }
      if (outputType === 'image/jpeg') {
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (square) {
        const side = Math.min(image.width, image.height);
        context.drawImage(
          image,
          (image.width - side) / 2,
          (image.height - side) / 2,
          side,
          side,
          0,
          0,
          size,
          size,
        );
      } else {
        context.drawImage(image, 0, 0, width, height);
      }
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL(outputType, outputType === 'image/jpeg' ? 0.84 : undefined);
      const encodedLength = dataUrl.slice(dataUrl.indexOf(',') + 1).length;
      const maximum = outputType === 'image/png' ? 750_000 : 1_500_000;
      if (encodedLength > Math.ceil(maximum * 4 / 3)) {
        reject(new Error('This image is too large after compression. Choose a simpler image.'));
        return;
      }
      resolve(dataUrl);
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
    image.src = url;
  });
}

function PasswordCard() {
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMessage, setPwMessage] = useState({ type: '', text: '' });

  const changePassword = async (event) => {
    event.preventDefault();
    setPwMessage({ type: '', text: '' });
    if (pw.next.length < 8) { setPwMessage({ type: 'error', text: 'New password must be at least 8 characters.' }); return; }
    if (pw.next !== pw.confirm) { setPwMessage({ type: 'error', text: 'The new passwords do not match.' }); return; }
    if (pw.next === pw.current) { setPwMessage({ type: 'error', text: 'Choose a password different from the current one.' }); return; }
    setPwBusy(true);
    try {
      await api('/auth/password', {
        method: 'POST',
        body: { currentPassword: pw.current, newPassword: pw.next },
      });
      setPw({ current: '', next: '', confirm: '' });
      setPwMessage({ type: 'ok', text: 'Password changed. Use it the next time you sign in.' });
    } catch (problem) {
      setPwMessage({ type: 'error', text: problem.message });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <section className="surface-card member-surface">
      <SectionHeading title="Change password" subtitle="Your password is stored securely by Supabase Auth, never in my AMRITA’s records." />
      <form className="profile-form" onSubmit={changePassword}>
        <label className="field-label">Current password<input type="password" value={pw.current} onChange={(event) => setPw({ ...pw, current: event.target.value })} required autoComplete="current-password" /></label>
        <label className="field-label">New password<input type="password" value={pw.next} onChange={(event) => setPw({ ...pw, next: event.target.value })} required minLength={8} autoComplete="new-password" /></label>
        <label className="field-label">Confirm new password<input type="password" value={pw.confirm} onChange={(event) => setPw({ ...pw, confirm: event.target.value })} required minLength={8} autoComplete="new-password" /></label>
        {pwMessage.text && <div className={`notice ${pwMessage.type === 'ok' ? 'notice-success' : 'notice-error'}`} role="alert">{pwMessage.text}</div>}
        <div className="modal-actions"><button className="button button-primary" type="submit" disabled={pwBusy}><KeyRound size={15} /> {pwBusy ? 'Updating…' : 'Update password'}</button></div>
      </form>
    </section>
  );
}

function ProfilePage({ profile, onSaved, notify }) {
  const [phone, setPhone] = useState(profile.phone || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [avatar, setAvatar] = useState(profile.avatarUrl || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const idLabel = profile.role === 'faculty_coordinator' ? 'Faculty ID' : profile.role === 'student' ? 'Student ID' : '';
  const idValue = profile.facultyId || profile.registerNumber || '';

  const pickPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try { setAvatar(await resizeImage(file)); setError(''); } catch (problem) { setError(problem.message); }
  };

  const save = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      onSaved(await api('/profiles/me', { method: 'PATCH', body: { phone, bio, avatarUrl: avatar } }));
      notify('Profile saved.');
    } catch (problem) {
      setError(problem.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-page">
      <section className="surface-card member-surface">
        <SectionHeading title="Your details" subtitle="Your name, email and ID are issued by ICTS and can’t be changed here." />
        <form className="profile-form" onSubmit={save}>
          <div className="avatar-editor">
            <Avatar person={{ name: profile.name, avatarUrl: avatar }} className="avatar-large" />
            <div>
              <label className="button button-outline avatar-upload"><Camera size={15} /> {avatar ? 'Change photo' : 'Upload photo'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={pickPhoto} hidden /></label>
              {avatar && <button type="button" className="text-link" onClick={() => setAvatar('')}>Remove</button>}
              <small>Optional. Cropped to a square.</small>
            </div>
          </div>
          <label className="field-label">Full name<input value={profile.name} disabled /></label>
          <label className="field-label">Email (login ID)<input value={profile.email} disabled /></label>
          {idLabel && <label className="field-label">{idLabel}<input value={idValue || 'Not issued yet'} disabled /></label>}
          {profile.department && <label className="field-label">Department<input value={profile.department} disabled /></label>}
          {profile.joiningYear && <label className="field-label">Year of joining<input value={profile.joiningYear} disabled /></label>}
          <label className="field-label">Phone number<input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={20} inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" /></label>
          <label className="field-label">About you<textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={500} rows="3" placeholder="Optional" /></label>
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          <div className="modal-actions"><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}<ArrowRight size={16} /></button></div>
        </form>
      </section>
      <PasswordCard />
    </div>
  );
}

function IctsDashboard({ onLogout, theme, onToggleTheme }) {
  const [people, setPeople] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [kind, setKind] = useState('faculty_coordinator');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ type: '', text: '' });
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [adminType, setAdminType] = useState('student_affairs');
  const [deletingId, setDeletingId] = useState('');

  const load = useCallback(async () => {
    try { setPeople(await api('/profiles')); setLoadError(''); } catch (problem) { setLoadError(problem.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const needsDetails = kind !== 'college_admin';
  const kinds = [
    { id: 'college_admin', label: 'Admin', hint: 'Student Affairs, Principal or another authority; multiple accounts are allowed' },
    { id: 'faculty_coordinator', label: 'Faculty', hint: 'Gets a faculty ID like FA23CSE001' },
    { id: 'student', label: 'Student', hint: 'Gets a student ID like CSE23001' },
  ];

  const createAccount = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    setBusy(true);
    setNotice({ type: '', text: '' });
    try {
      const created = await api('/profiles', {
        method: 'POST',
        body: { ...values, role: kind, ...(kind === 'college_admin' ? { adminType } : {}) },
      });
      const id = created.facultyId || created.registerNumber;
      setNotice({ type: 'ok', text: `${created.name}’s login was created in Supabase Auth and their profile in MongoDB.${id ? ` ID: ${id}` : ''}` });
      setFormKey((key) => key + 1);
      await load();
    } catch (problem) {
      setNotice({ type: 'error', text: problem.message });
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async (person) => {
    if (!window.confirm(`Permanently delete ${person.name} (${person.email})? This removes their login, profile, memberships, applications, registrations, attendance, messages, borrow history, and reports they submitted.`)) return;
    setDeletingId(person._id);
    setNotice({ type: '', text: '' });
    try {
      await api(`/profiles/${encodeURIComponent(person._id)}`, { method: 'DELETE' });
      setPeople((currentPeople) => currentPeople.filter((account) => account._id !== person._id));
      setNotice({ type: 'ok', text: `${person.name}'s login, profile, and linked records were deleted.` });
    } catch (problem) {
      setNotice({ type: 'error', text: problem.message });
    } finally {
      setDeletingId('');
    }
  };

  const visible = people
    .filter((person) => person.role !== 'icts' && (filter === 'all' || person.role === filter))
    .filter((person) => `${person.name} ${person.email} ${person.facultyId || ''} ${person.registerNumber || ''} ${person.designation || ''} ${person.adminType || ''}`.toLowerCase().includes(query.toLowerCase()));
  const [view, setView] = useState('accounts');

  return (
    <div className="app-shell shell-icts icts-shell">
      <main className="main-panel icts-main">
        <header className="topbar">
          <div className="breadcrumbs"><span>my AMRITA</span><span className="crumb-slash">/</span><strong>ICTS</strong></div>
          <div className="topbar-right">
            <button className={`button ${view === 'accounts' ? 'button-primary' : 'button-outline'}`} onClick={() => setView('accounts')}>Accounts</button>
            <button className={`button ${view === 'password' ? 'button-primary' : 'button-outline'}`} onClick={() => setView('password')}><KeyRound size={14} /> Password</button>
            <span className="role-pill">ICTS</span>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <button className="button button-outline topbar-logout" onClick={onLogout}><LogOut size={15} /> Log out</button>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading"><div><span className="eyebrow">ICTS DEPARTMENT</span><h1>Account desk</h1><p>Create admin, faculty and student logins. Sign-in credentials are stored in Supabase; my AMRITA profiles are stored in MongoDB.</p></div></div>
          {loadError && <div className="notice notice-error" role="alert">{loadError}</div>}

          {view === 'password' && <div className="profile-page"><PasswordCard /></div>}

          {view === 'accounts' && <>
            <section className="surface-card member-surface">
              <SectionHeading title="Create an account" subtitle="Choose who you are creating the login for." />
              <div className="kind-options" role="radiogroup" aria-label="Account type">
                {kinds.map((option) => (
                  <button key={option.id} type="button" role="radio" aria-checked={kind === option.id} disabled={option.disabled}
                    className={`kind-option ${kind === option.id ? 'kind-active' : ''}`} onClick={() => setKind(option.id)}>
                    <strong>{option.label}</strong><small>{option.hint}</small>
                  </button>
                ))}
              </div>
              <form className="account-create-form" key={formKey} onSubmit={createAccount}>
                <label className="field-label">Full name<input name="name" required maxLength={100} autoComplete="off" /></label>
                <label className="field-label">Email (login ID)<input name="email" type="email" required autoComplete="off" /></label>
                <label className="field-label">Password<input name="password" type="password" required minLength={8} autoComplete="new-password" /><small>At least 8 characters. They can change it after logging in.</small></label>
                {kind === 'college_admin' && <>
                  <label className="field-label">Admin type
                    <select value={adminType} onChange={(event) => setAdminType(event.target.value)}>
                      <option value="student_affairs">Student Affairs</option>
                      <option value="principal">Principal</option>
                      <option value="other_authority">Other authority</option>
                    </select>
                  </label>
                  {adminType === 'other_authority' && <label className="field-label">Authority / designation<input name="designation" required maxLength={100} placeholder="For example, Dean of Academics" /></label>}
                </>}
                {needsDetails && <>
                  <label className="field-label">Department code<input name="department" required maxLength={6} pattern="[A-Za-z]{2,6}" placeholder="CSE" style={{ textTransform: 'uppercase' }} /></label>
                  <label className="field-label">Year of joining<input name="joiningYear" type="number" required min="2000" max={new Date().getFullYear() + 1} defaultValue={new Date().getFullYear()} /></label>
                </>}
                <button className="button button-primary" type="submit" disabled={busy}><Plus size={15} /> {busy ? 'Creating…' : `Create ${kind === 'college_admin' ? `${adminTypeNames[adminType]} admin` : kind === 'student' ? 'student' : 'faculty'} account`}</button>
              </form>
              {notice.text && <div className={`notice ${notice.type === 'ok' ? 'notice-success' : 'notice-error'}`} role="alert">{notice.text}</div>}
            </section>

            <section className="surface-card member-surface">
              <SectionHeading title="Accounts created" subtitle={`${visible.length} shown`} />
              <div className="icts-filters">
                <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter by type"><option value="all">Everyone</option><option value="college_admin">Admins</option><option value="faculty_coordinator">Faculty</option><option value="student">Students</option></select>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email or ID" aria-label="Search accounts" />
              </div>
              {visible.map((person) => <article className="member-row" key={person._id}>
                <span className="application-avatar">{initials(person.name)}</span>
                <span className="member-person"><strong>{person.name}</strong><small>{person.email}</small></span>
                <span className="status status-approved">{person.facultyId || person.registerNumber || (person.role === 'college_admin' ? profileTrackLabel(person, 'student-affairs') : roleNames[person.role])}</span>
                <button className="button button-danger button-small" type="button" disabled={Boolean(deletingId)}
                  onClick={() => deleteAccount(person)} aria-label={`Delete ${person.name}'s account`}>
                  <Trash2 size={14} /> {deletingId === person._id ? 'Deleting…' : 'Delete'}
                </button>
              </article>)}
              {!visible.length && <EmptyState title="No accounts yet" text="Accounts you create will be listed here." />}
            </section>
          </>}
        </div>
      </main>
    </div>
  );
}

function pageDescription(page, role) {
  const descriptions = {
    clubs: 'A little curiosity can lead to a really good thing.',
    events: 'Explore what is happening on campus and register from event details.',
    applications: role === 'student' ? 'See where your applications are and what happens next.' : 'Make room for someone new in your community.',
    members: 'Keep the people, roles, and good work connected.',
    chats: 'Stay close to your club community with member-only conversations.',
    equipment: 'Share the good stuff. Bring it back ready for next time.',
    funding: 'A clear view of requests, budgets, and plans in motion.',
    reports: 'A thoughtful snapshot of the clubs and work in motion.',
    eventReports: 'Follow the mentor and Student Affairs review for post-event reports.',
    announcements: 'The latest notes from clubs across your campus.',
    profile: 'Your campus details, contact number, photo and password.',
  };
  return descriptions[page];
}

function StatCard({ icon: Icon, label, value, foot, tone }) {
  return <article className={`stat-card tone-${tone}`}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={17} /></span></div><strong>{value.toLocaleString()}</strong><small>{foot}</small></article>;
}

function ReportStat({ label, value, tone }) {
  return <article className={`report-stat tone-${tone}`}><span>{label}</span><strong>{Number(value || 0).toLocaleString()}</strong><i /></article>;
}

function SectionHeading({ title, subtitle, action, onAction }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>{action && <button className="text-link" onClick={onAction}>{action}<ArrowRight size={15} /></button>}</div>;
}

function EventRow({ event, index = 0, canReview, isPresident, onDetails, onReview, onResubmit }) {
  const date = event.eventDate ? new Date(event.eventDate) : null;
  const eventDate = date && !Number.isNaN(date.getTime()) ? date : null;
  const count = event.registeredCount || 0;
  return <article className="event-row">
    <button className={`event-poster event-poster-${index % 3}`} type="button" onClick={onDetails} aria-label={`View ${event.title} details`}>
      {event.posterUrl
        ? <img src={event.posterUrl} alt={`${event.title} event poster`} />
        : <span className="event-poster-fallback"><CalendarDays size={20} /><small>CAMPUS EVENT</small><strong>{event.title}</strong></span>}
      <span className="event-poster-date">{eventDate ? eventDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Date TBA'}</span>
    </button>
    <div className="event-details"><div className="event-meta"><span>{event.clubId?.name || 'Campus club'}</span><span className={statusClass(event.status)}>{event.status.replaceAll('_', ' ')}</span></div><h3>{event.title}</h3><p><CalendarDays size={13} /> {formatDate(event.eventDate, { weekday: 'short', month: 'short', day: 'numeric' })}{event.venueId?.name && <> <span>·</span> {event.venueId.name}</>}</p>{event.rejectionFeedback && <small className="rejection-feedback">Feedback: {event.rejectionFeedback}</small>}</div>
    <div className="event-row-action">
      <button className="text-link" type="button" onClick={onDetails}>View details <ArrowRight size={14} /></button>
      {canReview && ['mentor_pending', 'student_affairs_pending'].includes(event.status) && <div className="review-actions"><button className="button button-outline" onClick={() => onReview('approved')}>Approve</button><button className="button button-quiet" onClick={() => onReview('rejected')}>Decline</button></div>}
      {isPresident && ['draft', 'rejected'].includes(event.status) && <button className="button button-outline" onClick={onResubmit}>Submit for approval</button>}
      {typeof event.capacity === 'number' && <small>{count}/{event.capacity} places</small>}
    </div>
  </article>;
}

function EventDetailsDialog({ event, events, registrations, onNavigate, onClose, canRegister, onRegister, onCancel }) {
  const [confirmation, setConfirmation] = useState('');
  const [pendingEvent, setPendingEvent] = useState(null);
  const [slideDirection, setSlideDirection] = useState(0);
  const isTransitioning = useRef(false);
  const transitionTimer = useRef(null);
  const carouselEvents = useMemo(
    () => events.some((item) => item._id === event._id) ? events : [event, ...events],
    [events, event],
  );
  const carouselIndex = carouselEvents.findIndex((item) => item._id === event._id);
  const hasMultipleEvents = carouselEvents.length > 1;

  const confirmAction = async () => {
    if (confirmation === 'register') await onRegister(event);
    if (confirmation === 'cancel') await onCancel(event);
    setConfirmation('');
    onClose();
  };

  const finishNavigation = useCallback((targetEvent) => {
    if (!isTransitioning.current) return;
    isTransitioning.current = false;
    window.clearTimeout(transitionTimer.current);
    transitionTimer.current = null;
    setPendingEvent(null);
    setSlideDirection(0);
    setConfirmation('');
    onNavigate(targetEvent);
  }, [onNavigate]);

  const moveCarousel = useCallback((direction) => {
    if (isTransitioning.current || carouselEvents.length < 2) return;
    const nextIndex = (carouselIndex + direction + carouselEvents.length) % carouselEvents.length;
    const nextEvent = carouselEvents[nextIndex];
    if (!nextEvent || nextEvent._id === event._id) return;
    isTransitioning.current = true;
    setConfirmation('');
    setPendingEvent(nextEvent);
    setSlideDirection(direction);
    transitionTimer.current = window.setTimeout(() => finishNavigation(nextEvent), 500);
  }, [carouselEvents, carouselIndex, event._id, finishNavigation]);

  useEffect(() => {
    const closeOnEscape = (keyboardEvent) => {
      if (keyboardEvent.key === 'Escape') onClose();
      const targetIsEditable = keyboardEvent.target instanceof HTMLElement
        && keyboardEvent.target.matches('input, textarea, select, [contenteditable="true"]');
      if (hasMultipleEvents && !targetIsEditable && keyboardEvent.key === 'ArrowLeft') moveCarousel(-1);
      if (hasMultipleEvents && !targetIsEditable && keyboardEvent.key === 'ArrowRight') moveCarousel(1);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, hasMultipleEvents, moveCarousel]);

  useEffect(() => () => window.clearTimeout(transitionTimer.current), []);

  const renderSlide = (slideEvent, slideIndex) => {
    const date = slideEvent.eventDate ? new Date(slideEvent.eventDate) : null;
    const endDate = slideEvent.endDate ? new Date(slideEvent.endDate) : null;
    const validDate = date && !Number.isNaN(date.getTime());
    const time = validDate
      ? `${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${endDate && !Number.isNaN(endDate.getTime()) ? ` – ${endDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}`
      : '';
    const clubName = slideEvent.clubId?.name || 'Campus club';
    const venue = slideEvent.venueId;
    const full = typeof slideEvent.capacity === 'number'
      && (slideEvent.registeredCount || 0) >= slideEvent.capacity;
    const slideRegistered = registrations.has(slideEvent._id);

    return <div className="event-dialog-slide" key={slideEvent._id}>
      <div className="event-dialog-poster">
        {slideEvent.posterUrl
          ? <img src={slideEvent.posterUrl} alt={`${slideEvent.title} event poster`} />
          : <span className="event-dialog-poster-fallback"><CalendarDays size={34} /><small>CAMPUS EVENT</small><strong>{slideEvent.title}</strong></span>}
        {hasMultipleEvents && <div className="event-dialog-carousel-controls" aria-label="Browse events">
          <button className="icon-button" type="button" onClick={() => moveCarousel(-1)} disabled={isTransitioning.current} aria-label="Previous event"><ChevronLeft size={18} /></button>
          <span>{slideIndex + 1} / {carouselEvents.length}</span>
          <button className="icon-button" type="button" onClick={() => moveCarousel(1)} disabled={isTransitioning.current} aria-label="Next event"><ChevronRight size={18} /></button>
        </div>}
      </div>
      <div className="event-dialog-content">
        <div className="event-meta"><span>{clubName}</span><span className={statusClass(slideEvent.status)}>{slideEvent.status.replaceAll('_', ' ')}</span></div>
        <h2 id={slideEvent._id === event._id ? 'event-dialog-title' : undefined}>{slideEvent.title}</h2>
        <p className="event-dialog-description">{slideEvent.description || 'Event details will be shared by the club soon.'}</p>
        <div className="event-dialog-facts">
          <div><CalendarDays size={17} /><span><strong>{validDate ? formatDate(slideEvent.eventDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Date to be announced'}</strong><small>{time || 'Time to be announced'}</small></span></div>
          {venue && <div><Compass size={17} /><span><strong>{venue.name || 'Venue'}</strong><small>{venue.location || 'Campus venue'}</small></span></div>}
          {typeof slideEvent.capacity === 'number' && <div><Users size={17} /><span><strong>{slideEvent.registeredCount || 0} of {slideEvent.capacity} seats reserved</strong><small>Campus community</small></span></div>}
        </div>
        {slideEvent._id === event._id && confirmation && <div className="registration-confirm" role="group" aria-label="Confirm event registration">
          <strong>{confirmation === 'register' ? 'Do you want to register for this event?' : 'Do you want to cancel your registration?'}</strong>
          <div><button className="button button-primary" type="button" onClick={confirmAction}>Yes</button><button className="button button-outline" type="button" onClick={() => setConfirmation('')}>No</button></div>
        </div>}
        {slideEvent._id === event._id && canRegister && slideEvent.status === 'approved' && !confirmation && (slideRegistered
          ? <button className="button button-outline event-dialog-action" type="button" onClick={() => setConfirmation('cancel')}>Cancel registration</button>
          : <button className="button button-primary event-dialog-action" type="button" disabled={full} onClick={() => setConfirmation('register')}>{full ? 'Registration is full' : 'Register'}</button>)}
        {slideEvent._id === event._id && (!canRegister || slideEvent.status !== 'approved') && <button className="button button-primary event-dialog-action" type="button" onClick={onClose}>Back to events</button>}
      </div>
    </div>;
  };

  const previousIndex = (carouselIndex - 1 + carouselEvents.length) % carouselEvents.length;
  const nextIndex = (carouselIndex + 1) % carouselEvents.length;
  const previousEvent = pendingEvent && slideDirection < 0 ? pendingEvent : event;
  const nextEvent = pendingEvent && slideDirection > 0 ? pendingEvent : carouselEvents[nextIndex];
  const firstSlide = slideDirection < 0 ? previousEvent : event;
  const secondSlide = slideDirection < 0 ? event : nextEvent;
  const firstIndex = slideDirection < 0 ? previousIndex : carouselIndex;
  const secondIndex = slideDirection < 0 ? carouselIndex : nextIndex;

  return <div className="event-dialog-backdrop" onMouseDown={(mouseEvent) => {
    if (mouseEvent.target === mouseEvent.currentTarget) onClose();
  }}>
    <section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title">
      <button className="icon-button event-dialog-close" type="button" onClick={onClose} aria-label="Close event details"><X size={18} /></button>
      <div
        className={`event-dialog-track ${pendingEvent ? `event-dialog-track-${slideDirection > 0 ? 'next' : 'previous'}` : 'event-dialog-track-idle'}`}
        onAnimationEnd={(animationEvent) => {
          if (animationEvent.target === animationEvent.currentTarget && pendingEvent) finishNavigation(pendingEvent);
        }}
      >
        {renderSlide(firstSlide, firstIndex)}
        {pendingEvent && renderSlide(secondSlide, secondIndex)}
      </div>
    </section>
  </div>;
}

function AttendancePanel({ event, onError }) {
  const [expanded, setExpanded] = useState(false);
  const [registrations, setRegistrations] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try {
      const [registered, marked] = await Promise.all([
        api(`/registrations?eventId=${encodeURIComponent(event._id)}`),
        api(`/attendance?eventId=${encodeURIComponent(event._id)}`),
      ]);
      setRegistrations(registered.filter((item) => item.status === 'registered'));
      setAttendance(marked);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [event._id]);

  useEffect(() => {
    if (expanded) load();
  }, [expanded, load]);

  const mark = async (registration, status) => {
    const profileId = registration.profileId?._id || registration.profileId;
    const record = attendance.find((item) => (item.profileId?._id || item.profileId) === profileId);
    setBusyId(profileId);
    try {
      if (record) await api(`/attendance/${record._id}`, { method: 'PATCH', body: { status } });
      else await api('/attendance', { method: 'POST', body: { eventId: event._id, profileId, status } });
      await load();
    } catch (markError) {
      setError(markError.message);
      onError(markError.message);
    } finally {
      setBusyId('');
    }
  };

  return <div className="attendance-panel">
    <button className="text-link" type="button" onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide attendance' : 'Take attendance'} <ArrowRight size={14} /></button>
    {expanded && <>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {registrations.map((registration) => {
        const profileId = registration.profileId?._id || registration.profileId;
        const record = attendance.find((item) => (item.profileId?._id || item.profileId) === profileId);
        return <div className="attendance-row" key={registration._id}>
          <span>{registration.profileId?.name || 'Registered student'}<small>{registration.profileId?.email}</small></span>
          <span className={record ? statusClass(record.status) : statusClass('pending')}>{record?.status || 'not marked'}</span>
          <button className="button button-outline button-small" disabled={busyId === profileId} onClick={() => mark(registration, 'present')}>Present</button>
          <button className="button button-quiet button-small" disabled={busyId === profileId} onClick={() => mark(registration, 'absent')}>Absent</button>
        </div>;
      })}
      {!registrations.length && !error && <p className="muted-copy">No registered attendees yet.</p>}
    </>}
  </div>;
}

function EventReportComposer({ event, onSubmit }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (submitEvent) => {
    submitEvent.preventDefault();
    const form = submitEvent.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    values.budgetSpent = Number(values.budgetSpent || 0);
    setBusy(true);
    setError('');
    try {
      await api(`/events/${event._id}/report`, { method: 'POST', body: values });
      form.reset();
      await onSubmit();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  return <details className="report-composer">
    <summary>Submit post-event report for {event.title}</summary>
    <form className="modal-form" onSubmit={submit}>
      <label className="field-label">Event summary<textarea name="summary" required maxLength={5000} rows="3" /></label>
      <label className="field-label">Activities completed<textarea name="activities" required maxLength={5000} rows="3" /></label>
      <label className="field-label">Outcomes<textarea name="outcomes" required maxLength={5000} rows="3" /></label>
      <label className="field-label">Issues / learnings<textarea name="issues" maxLength={3000} rows="2" /></label>
      <label className="field-label">Amount spent (INR)<input name="budgetSpent" type="number" min="0" step="1" defaultValue="0" /></label>
      <p className="muted-copy">The OD attendance CSV is generated from the event’s attendance records when submitted.</p>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Send report for review'} <ArrowRight size={15} /></button>
    </form>
  </details>;
}

function BorrowApprovalRow({ borrow, canReview, onReview }) {
  return <article className="funding-row">
    <div className="funding-symbol"><Laptop size={17} /></div>
    <div className="funding-details"><strong>{borrow.equipmentId?.name || 'Equipment request'} · {borrow.clubId?.name}</strong><span>Requested by {borrow.profileId?.name || 'club president'} · Due {formatDate(borrow.dueDate)}</span>{borrow.rejectionFeedback && <small className="rejection-feedback">Feedback: {borrow.rejectionFeedback}</small>}</div>
    <div className="funding-actions"><span className={statusClass(borrow.status)}>{borrow.status.replaceAll('_', ' ')}</span>{canReview && <div className="review-actions"><button className="review-accept" onClick={() => onReview('approved')} aria-label="Approve equipment request"><Check size={15} /></button><button className="review-decline" onClick={() => onReview('rejected')} aria-label="Reject equipment request"><X size={15} /></button></div>}</div>
  </article>;
}

function ReportRow({ report, isPresident, canReview, onReview, onDownload, onResubmit, onError }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitRevision = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    values.budgetSpent = Number(values.budgetSpent || report.budgetSpent || 0);
    try {
      await onResubmit(values);
      setEditing(false);
    } catch (submitError) {
      setError(submitError.message);
      onError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  return <article className="report-review-card">
    <div className="application-title"><strong>{report.eventId?.title || 'Campus event'} · {report.clubId?.name}</strong><span className={statusClass(report.status)}>{report.status.replaceAll('_', ' ')}</span></div>
    <p>{report.summary}</p><p><strong>Activities:</strong> {report.activities}</p><p><strong>Outcomes:</strong> {report.outcomes}</p>
    {report.issues && <p><strong>Issues / learnings:</strong> {report.issues}</p>}
    <small>{report.attendeeCount} attendees · {formatMoney(report.budgetSpent)} spent</small>
    {report.rejectionFeedback && <p className="rejection-feedback">Feedback: {report.rejectionFeedback}</p>}
    <div className="review-actions">
      <button className="button button-outline button-small" onClick={onDownload}><Download size={14} /> Download OD roster</button>
      {canReview && <><button className="button button-outline button-small" onClick={() => onReview('approved')}>Approve</button><button className="button button-quiet button-small" onClick={() => onReview('rejected')}>Reject</button></>}
      {isPresident && report.status === 'rejected' && <button className="button button-outline button-small" onClick={() => setEditing(!editing)}>{editing ? 'Close edit' : 'Revise & resubmit'}</button>}
    </div>
    {editing && <form className="modal-form report-edit-form" onSubmit={submitRevision}>
      <label className="field-label">Summary<textarea name="summary" defaultValue={report.summary} required maxLength={5000} rows="2" /></label>
      <label className="field-label">Activities<textarea name="activities" defaultValue={report.activities} required maxLength={5000} rows="2" /></label>
      <label className="field-label">Outcomes<textarea name="outcomes" defaultValue={report.outcomes} required maxLength={5000} rows="2" /></label>
      <label className="field-label">Issues / learnings<textarea name="issues" defaultValue={report.issues} maxLength={3000} rows="2" /></label>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Resubmitting…' : 'Send revised report'} <ArrowRight size={15} /></button>
    </form>}
  </article>;
}

function ClubCard({ club, index, application, isMember, onApply, isAdmin, onEdit }) {
  const colors = ['club-lilac', 'club-peach', 'club-mint', 'club-blue'];
  const icon = [Sparkles, Laptop, Users, Compass][index % 4];
  const Icon = icon;
  return <article className="club-card">
    <div className={`club-art ${colors[index % colors.length]}`}>
      {club.logoUrl
        ? <img className="club-logo" src={club.logoUrl} alt={`${club.name} logo`} />
        : <><span className="club-art-orbit" /><span className="club-icon"><Icon size={22} /></span><span className="club-art-number">0{index + 1}</span></>}
    </div>
    <div className="club-card-body"><div className="club-category">{club.category || 'Campus community'}</div><h2>{club.name}</h2><p>{club.description || 'A welcoming place to meet, learn, and make things happen.'}</p>
      <span className="club-coordinator">{club.clubType === 'technical' ? 'Technical club' : 'Non-technical club'}{club.mentor?.name ? ` · Mentor: ${club.mentor.name}` : ''}</span>
      {isAdmin ? <button className="text-link club-join" onClick={onEdit}>Edit club details <ArrowRight size={15} /></button> :
        isMember ? <span className="club-applied status status-approved">You’re a member</span> :
          application?.status === 'pending' ? <span className={`club-applied ${statusClass(application.status)}`}>Application pending</span> :
                club.recruitmentOpen ? <button className="text-link club-join" onClick={onApply}>{application?.status === 'rejected' ? 'Apply again' : application?.status === 'approved' ? 'Join again' : 'I’m interested'} <ArrowRight size={15} /></button>
                : <span className="club-manager-note">Recruitment is currently closed.</span>}
    </div>
  </article>;
}

function ApplicationRow({ application, isOwn, canReview, onReview }) {
  return <article className="application-row"><div className="application-avatar">{initials(application.profileId?.name)}</div><div className="application-details"><div className="application-title"><strong>{application.clubId?.name || 'Club application'}</strong><span className={statusClass(application.status)}>{application.status}</span></div><p>{isOwn ? 'Your application' : `${application.profileId?.name || 'A student'}${application.profileId?.email ? ` · ${application.profileId.email}` : ''}`}</p><small>Applying for: {application.requestedPosition === 'executive' ? 'Executive consideration' : 'Club membership'}</small>
    <details className="applicant-details" open={canReview && application.status === 'pending'}><summary>Applicant details</summary><dl>
      <div><dt>Name</dt><dd>{application.profileId?.name || 'Not provided'}</dd></div>
      <div><dt>Roll number</dt><dd>{application.profileId?.registerNumber || 'Not provided'}</dd></div>
      <div><dt>Department</dt><dd>{application.profileId?.department || 'Not provided'}</dd></div>
      <div><dt>Year of study</dt><dd>{application.yearOfStudy || 'Not provided'}</dd></div>
      <div><dt>Phone</dt><dd>{application.applicantPhone || application.profileId?.phone || 'Not provided'}</dd></div>
      <div><dt>Domain</dt><dd>{application.domain || 'General'}</dd></div>
      <div className="applicant-reason"><dt>Reason for joining</dt><dd>{application.reason || 'Not provided'}</dd></div>
    </dl></details>
    {application.rejectionFeedback && <small className="rejection-feedback">Feedback: {application.rejectionFeedback}</small>}<time>{formatDate(application.appliedDate)}</time></div>
    {canReview && application.status === 'pending' && <div className="review-actions"><button className="review-accept" onClick={() => onReview('approved')} aria-label="Approve application"><Check size={16} /></button><button className="review-decline" onClick={() => onReview('rejected')} aria-label="Decline application"><X size={16} /></button></div>}
  </article>;
}

function PositionInvitation({ membership, onRespond }) {
  const club = membership.clubId?.name || 'a campus club';
  const title = membership.positionTitle || membership.position.replaceAll('_', ' ');
  return <article className="application-row position-invitation">
    <div className="application-avatar"><ShieldCheck size={16} /></div>
    <div className="application-details">
      <div className="application-title"><strong>Office-bearer invitation · {club}</strong><span className={statusClass('pending')}>awaiting your response</span></div>
      <p>You have been nominated as {title}. Accept to activate this club role.</p>
    </div>
    <div className="review-actions"><button className="review-accept" onClick={() => onRespond('accepted')} aria-label="Accept office-bearer invitation"><Check size={16} /></button><button className="review-decline" onClick={() => onRespond('declined')} aria-label="Decline office-bearer invitation"><X size={16} /></button></div>
  </article>;
}

function MemberRow({ member, canEdit, canRemove, onRemove, onRoleChange }) {
  const [positionTitle, setPositionTitle] = useState(member.positionTitle || '');
  const [officeBearerGroup, setOfficeBearerGroup] = useState(member.officeBearerGroup);
  const isOfficeBearer = ['office_bearer', 'president', 'vice_president', 'treasurer', 'secretary'].includes(member.position)
    || (member.position === 'executive' && member.officeBearerGroup);
  useEffect(() => { setPositionTitle(member.positionTitle || ''); }, [member.positionTitle]);
  useEffect(() => { setOfficeBearerGroup(member.officeBearerGroup); }, [member.officeBearerGroup]);
  return <article className="member-row">
    <span className="application-avatar">{initials(member.profileId?.name)}</span>
    <span className="member-person"><strong>{member.profileId?.name || 'Campus member'}</strong><small>{member.profileId?.email}</small></span>
    <span className="member-date">Joined {formatDate(member.joinedDate, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
    {member.membershipStatus === 'pending' && <span className={statusClass('pending')}>Invitation pending</span>}
    <select aria-label={`Position for ${member.profileId?.name || 'member'}`} value={member.position} disabled={!canEdit} onChange={(event) => onRoleChange(event.target.value, positionTitle, false)}>
      <option value="member">Member</option><option value="executive">Executive</option>
      {isOfficeBearer && <><option value="office_bearer">Office bearer</option><option value="president">President</option><option value="vice_president">Vice president</option><option value="treasurer">Treasurer</option><option value="secretary">Secretary</option></>}
    </select>
    <input aria-label={`Custom position title for ${member.profileId?.name || 'member'}`} className="member-title-input" value={positionTitle} disabled={!canEdit} maxLength={80} placeholder="Custom title" onChange={(event) => setPositionTitle(event.target.value)} onBlur={() => {
      if (positionTitle !== (member.positionTitle || '')) onRoleChange(member.position, positionTitle, officeBearerGroup);
    }} />
    {member.position === 'executive' && isOfficeBearer && <label className="member-ob-toggle"><input type="checkbox" checked={Boolean(officeBearerGroup)} disabled={!canEdit} onChange={(event) => {
      setOfficeBearerGroup(event.target.checked);
      onRoleChange(member.position, positionTitle, event.target.checked);
    }} /> OB</label>}
    {canRemove && <button className="button button-quiet button-small member-remove" type="button" onClick={onRemove}>Remove</button>}
  </article>;
}

function ParticipationRow({ record }) {
  return <article className="participation-row"><span className="participation-mark"><Check size={15} /></span><div><strong>{record.eventId?.title || 'Campus event'}</strong><small>{record.eventId?.clubId?.name || 'Campus community'} · {formatDate(record.eventId?.eventDate)}</small></div><span className={statusClass(record.status)}>{record.status}</span></article>;
}

function EquipmentCard({ equipment, index, isPresident, activeBorrow, onBorrow, onReturn }) {
  return <article className="surface-card equipment-card"><div className={`equipment-art equipment-art-${index % 3}`}><Laptop size={25} /><span className="equipment-condition">{equipment.condition || 'good'} condition</span></div><div className="equipment-card-body"><span className="club-category">{equipment.clubId?.name || 'Club equipment'}</span><h2>{equipment.name}</h2><p>{equipment.description || 'Shared by your campus community.'}</p><div className="equipment-card-bottom"><span className={equipment.availableQuantity ? 'availability' : 'unavailable'}><i />{equipment.availableQuantity} of {equipment.totalQuantity} available</span>{activeBorrow && ['borrowed', 'overdue'].includes(activeBorrow.status) && <button className="button button-outline button-small" onClick={onReturn}>Return item</button>}{isPresident && (!activeBorrow || ['returned', 'rejected'].includes(activeBorrow.status)) && <button className="button button-outline button-small" disabled={!equipment.availableQuantity} onClick={onBorrow}>Request borrow</button>}</div></div></article>;
}

function FundingRow({ request, canReview, onReview }) {
  return <article className="funding-row"><div className="funding-symbol"><ArrowDownLeft size={17} /></div><div className="funding-details"><strong>{request.clubId?.name || 'Club funding'}</strong><span>{request.purpose}</span><small>{formatDate(request.requestDate)}</small>{request.rejectionFeedback && <small className="rejection-feedback">Feedback: {request.rejectionFeedback}</small>}</div><div className="funding-actions"><strong>{formatMoney(request.requestedAmount)}</strong><span className={statusClass(request.status)}>{request.status}</span>{canReview && request.status === 'pending' && <div className="review-actions"><button className="review-accept" onClick={() => onReview('approved')} aria-label="Approve funding request"><Check size={15} /></button><button className="review-decline" onClick={() => onReview('rejected')} aria-label="Decline funding request"><X size={15} /></button></div>}</div></article>;
}

function TransactionRow({ transaction }) {
  const isCredit = transaction.type === 'credit';
  return <article className="transaction-row"><span className={`transaction-icon ${isCredit ? 'transaction-credit' : ''}`}>{isCredit ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span><span className="transaction-meta"><strong>{transaction.clubId?.name || 'Club ledger'}</strong><small>{transaction.description} · {formatDate(transaction.transactionDate)}</small></span><strong className={isCredit ? 'transaction-amount-credit' : ''}>{isCredit ? '+' : '−'}{formatMoney(transaction.amount)}</strong></article>;
}

function AnnouncementRow({ note }) {
  return <article className="announcement-row"><span className={`announcement-dot ${note.priority === 'high' ? 'announcement-dot-warm' : ''}`} /><div><strong>{note.title}</strong><p>{note.clubId?.name || 'Campus community'} <span>·</span> {formatDate(note.postedDate, { month: 'short', day: 'numeric' })}</p></div></article>;
}

function EmptyState({ title, text }) {
  return <div className="empty-state"><span className="empty-icon"><Sparkles size={20} /></span><strong>{title}</strong><p>{text}</p></div>;
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#171820' : '#efefef');
    try {
      window.localStorage.setItem('campussphere-theme', theme);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'SecurityError') throw error;
    }
  }, [theme]);

  const toggleTheme = () => setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark');

  useEffect(() => {
    let active = true;
    try {
      clearLegacySupabaseSessions();
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'SecurityError') throw error;
      setSession(null);
      setProfileError(`Could not remove old browser sign-in data: ${error.message}`);
      return undefined;
    }
    api('/auth/session').then((result) => {
      if (active) setSession(result);
    }).catch((error) => {
      if (!active) return;
      setSession(null);
      if (error.status !== 401) setProfileError(error.message);
    });
    return () => { active = false; };
  }, []);

  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) { setProfile(null); return undefined; }
    let active = true;
    api('/profiles/me').then((currentProfile) => {
      if (active) setProfile(currentProfile);
    }).catch((error) => {
      if (active) setProfileError(error.message);
    });
    return () => { active = false; };
  }, [userId]);

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
      setSession(null);
      setProfile(null);
      setProfileError('');
    } catch (error) {
      setProfileError(error.message);
    }
  };

  if (session === undefined) return <div className="app-loading"><span className="loading-orbit" /><p>Getting your campus ready…</p></div>;
  if (profileError) {
    return <div className="profile-error"><div className="config-card"><span className="brand-mark"><Sparkles size={19} /></span><span className="eyebrow">A CONNECTION ISSUE</span><h1>One more moment.</h1><p>{profileError}</p><button className="button button-primary" onClick={() => window.location.reload()}>Try again <ArrowRight size={16} /></button><button className="text-link" onClick={logout}>Sign out</button></div></div>;
  }
  if (!session) return <AuthScreen onAuthenticated={setSession} theme={theme} onToggleTheme={toggleTheme} />;
  if (!profile) return <div className="app-loading"><span className="loading-orbit" /><p>Setting up your space…</p></div>;
  if (profile.role === 'icts') return <IctsDashboard onLogout={logout} theme={theme} onToggleTheme={toggleTheme} />;
  return <Dashboard profile={profile} onLogout={logout} onProfileUpdate={setProfile} theme={theme} onToggleTheme={toggleTheme} />;
}
