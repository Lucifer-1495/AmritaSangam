import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, BarChart3, Bell, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, Compass, FolderKanban, Gauge,
  Laptop, LogOut, Menu, Megaphone, Moon, Plus, Search, ShieldCheck, Sun, Users,
  WalletCards, Download, X, UserRound, KeyRound, Camera, Trash2, Pencil } from 'lucide-react';
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
  { id: 'credentialRequests', label: 'Club login changes', icon: KeyRound },
  { id: 'profile', label: 'My profile', icon: UserRound },
];

const initialData = {
  clubs: [], managedClubs: [], memberships: [], venues: [], events: [], announcements: [], applications: [],
  eventOrganizers: [], registrations: [], participation: [], equipment: [], funding: [], transactions: [], borrows: [], profiles: [], eventReports: [], credentialRequests: [], notifications: [],
  summary: { clubs: 0, events: 0, members: 0, pendingApplications: 0, allocated: 0, spent: 0, equipment: 0, reportsSubmitted: 0, clubReports: [] },
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
  'verified-office-bearer': 'Club account',
  executive: 'Club executive',
  student: 'Student',
};

const accountDepartments = {
  CSE: { schoolCode: 'SC', sections: ['A', 'B', 'C'] },
  AIE: { schoolCode: 'SC', sections: ['D', 'E', 'F'] },
  AID: { schoolCode: 'SC', sections: ['G'] },
  ECE: { schoolCode: 'EN', sections: ['H', 'I', 'J'] },
  EAC: { schoolCode: 'EN', sections: ['K'] },
  EEE: { schoolCode: 'EN', sections: ['L'] },
  ELC: { schoolCode: 'EN', sections: ['M'] },
  MEE: { schoolCode: 'EN', sections: ['N'] },
};

const facultyDepartments = ['ECE', 'EEE', 'MEE', 'MAT', 'PHY', 'CHE', 'ENG', 'CSE', 'MBA', 'CIR'];

const authorityDesignations = ['Dean', 'Associate Dean', 'Head of Department', 'Director', 'Other'];

const closureReportOptions = {
  promotion: ['LinkedIn Page/URL', 'Link to photos and videos'],
  eventCategory: ['Flagship', 'Independent', 'Club Collaboration', 'Coordinated with another event'],
  programType: [
    'Level 1: Expert Talks', 'Level 1: Mentoring Sessions', 'Level 1: Performances',
    'Level 2: Workshop', 'Level 2: Seminar', 'Level 2: Conference',
    'Level 3: Exhibitions & Demos', 'Level 3: Competitions', 'Level 3: Visits to external locations',
    'Level 4: Cultural Fest', 'Level 4: Challenges', 'Level 4: Hackathons',
  ],
  programTheme: [
    'Literary & Communication', 'Cultural & Arts', 'Social & Community Engagement',
    'Leadership & Management', 'Celebrations & Recreation', 'Film, Media & Content',
    'Wellness, Ethics & Life Skills', 'Sports and Fitness', 'Commemorative Days and Events',
  ],
  sdgAlignment: [
    'SDG 1 — No Poverty', 'SDG 2 — Zero Hunger', 'SDG 3 — Good Health and Well-being',
    'SDG 4 — Quality Education', 'SDG 5 — Gender Equality', 'SDG 6 — Clean Water and Sanitation',
    'SDG 7 — Affordable and Clean Energy', 'SDG 8 — Decent Work and Economic Growth',
    'SDG 9 — Industry, Innovation and Infrastructure', 'SDG 10 — Reduced Inequalities',
    'SDG 11 — Sustainable Cities and Communities', 'SDG 12 — Responsible Consumption and Production',
    'SDG 13 — Climate Action', 'SDG 14 — Life Below Water', 'SDG 15 — Life on Land',
    'SDG 16 — Peace, Justice and Strong Institutions', 'SDG 17 — Partnerships for the Goals',
  ],
  sessionMode: ['Online', 'Offline', 'Hybrid'],
  resourcePerson: ['External', 'Internal', 'Alumni'],
};

const completionReportFields = [
  ['duration', 'Duration of the activity (hours/days)', 'text'],
  ['startDate', 'Start date', 'date'],
  ['endDate', 'End date', 'date'],
  ['expenditure', 'Expenditure (figure & words)', 'text'],
  ['resourcePersonDetails', 'Resource person details', 'textarea'],
  ['discussionHighlights', 'Discussion highlights of resource person & institutional leadership', 'textarea'],
  ['objectiveAchieved', 'Program objective achieved', 'textarea'],
  ['skillsAcquired', 'Skill acquired', 'textarea'],
  ['detailedReport', 'Detailed report (maximum 1000 words)', 'textarea'],
  ['impactAnalysis', 'Impact analysis', 'textarea'],
];
const reportImageFields = [
  ['brochure', 'Brochure/Flyer'],
  ['photograph1', 'Photograph 1'],
  ['photograph2', 'Photograph 2'],
  ['photograph3', 'Photograph 3'],
  ['photograph4', 'Photograph 4'],
];

function buildReportDetails(formData, images = {}, previous = {}) {
  const details = {};
  Object.keys(closureReportOptions).forEach((field) => {
    details[field] = {
      selected: formData.getAll(`report_${field}`),
      remark: String(formData.get(`report_${field}_remark`) || '').trim(),
    };
  });
  details.participants = {
    selected: formData.getAll('report_participants'),
    internalCount: String(formData.get('report_internalCount') || ''),
    externalCount: String(formData.get('report_externalCount') || ''),
    remark: String(formData.get('report_participants_remark') || '').trim(),
  };
  details.activityCompletion = Object.fromEntries(completionReportFields.map(([field]) => [field, {
    value: String(formData.get(`report_${field}`) || '').trim(),
    remark: String(formData.get(`report_${field}_remark`) || '').trim(),
  }]));
  reportImageFields.forEach(([field]) => {
    details.activityCompletion[field] = {
      image: images[field] || previous.activityCompletion?.[field]?.image || '',
      remark: String(formData.get(`report_${field}_remark`) || '').trim(),
    };
  });
  return details;
}

function isOfficeBearerPosition(membership) {
  return membership.membershipStatus !== 'pending'
    && (['office_bearer', 'president', 'vice_president', 'treasurer', 'secretary'].includes(membership.position)
      || (membership.position === 'executive' && membership.officeBearerGroup));
}

function isClubMentor(club, profileId) {
  const identities = [
    club?.mentor?._id || club?.mentor,
    ...(club?.mentorIds || []).map((identity) => identity?._id || identity),
    ...(club?.mentors || []).map((mentor) => mentor?._id || mentor),
  ];
  return identities.some((identity) => identity && String(identity) === String(profileId));
}

function hasPendingMentorApproval(record, profileId) {
  if (record.mentorApprovals?.length) {
    return record.mentorApprovals.some((approval) =>
      approval.status === 'pending'
      && String(approval.mentorId?._id || approval.mentorId) === String(profileId));
  }
  return isClubMentor(record.clubId, profileId);
}

function mentorReviewStarted(record) {
  return Boolean(record.mentorReviewedBy)
    || Boolean(record.mentorApprovals?.some((approval) => approval.status !== 'pending'));
}

function profileTrackLabel(profile, track, verifiedClubName, memberships = []) {
  if (profile.role === 'college_admin') {
    const adminLabel = profile.adminType === 'other_authority'
      ? profile.designation || adminTypeNames.other_authority
      : adminTypeNames[profile.adminType] || adminTypeNames.student_affairs;
    return `${adminLabel} admin`;
  }
  if (track === 'verified-office-bearer' && verifiedClubName) return `${verifiedClubName} account`;
  if (profile.role === 'student' || profile.role === 'club_committee') {
    const activeMemberships = memberships.filter((membership) => membership.membershipStatus === 'active');
    const officeBearerTitles = [
      ['president', 'President'],
      ['vice_president', 'Vice president'],
      ['treasurer', 'Treasurer'],
      ['secretary', 'Secretary'],
    ];
    const highestPosition = officeBearerTitles.find(([position]) =>
      activeMemberships.some((membership) => membership.position === position));
    if (highestPosition) return highestPosition[1];
    if (activeMemberships.some((membership) =>
      membership.position === 'office_bearer'
      || (membership.position === 'executive' && membership.officeBearerGroup))) return 'Office bearer';
    return activeMemberships.length ? 'Member' : 'Student';
  }
  return trackNames[track] || roleNames[profile.role] || profile.role;
}

function dashboardTrack(role, memberships, hasVerifiedClubAccess) {
  if (role === 'college_admin') return 'student-affairs';
  if (role === 'faculty_coordinator') return 'mentor';
  if (hasVerifiedClubAccess) return 'verified-office-bearer';
  if (memberships.some(isOfficeBearerPosition)) return 'executive';
  if (memberships.some((membership) => membership.membershipStatus === 'active' && membership.position === 'president')) return 'executive';
  if (memberships.some((membership) => membership.membershipStatus !== 'pending' && membership.position === 'executive')) return 'executive';
  return 'student';
}

function navigationFor(track) {
  const visible = {
    'student-affairs': ['overview', 'clubs', 'events', 'equipment', 'funding', 'reports', 'eventReports', 'announcements', 'credentialRequests', 'profile'],
    mentor: ['overview', 'clubs', 'events', 'applications', 'members', 'equipment', 'funding', 'eventReports', 'announcements', 'profile'],
    president: ['overview', 'clubs', 'events', 'applications', 'members', 'chats', 'equipment', 'funding', 'reports', 'eventReports', 'announcements', 'profile'],
    'office-bearer': ['overview', 'clubs', 'events', 'applications', 'members', 'chats', 'funding', 'reports', 'eventReports', 'announcements', 'profile'],
    'verified-office-bearer': ['overview', 'clubs', 'events', 'equipment', 'funding', 'reports', 'eventReports'],
    executive: ['overview', 'clubs', 'events', 'applications', 'chats', 'announcements', 'profile'],
    student: ['overview', 'clubs', 'events', 'applications', 'announcements', 'profile'],
  }[track];
  return allNavigation.filter(({ id }) => visible.includes(id));
}

function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!value) return 'Date to be announced';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date to be announced' : date.toLocaleDateString(undefined, options);
}

function isUpcomingEvent(event, now = new Date()) {
  const eventEnd = new Date(event.endDate || event.eventDate);
  return !Number.isNaN(eventEnd.getTime()) && eventEnd >= now;
}

function toDateTimeInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(value || 0);
}

function statusClass(status) {
  return `status status-${String(status || 'pending').toLowerCase()}`;
}

function statusMatchesFilter(status, filter) {
  if (filter === 'all') return true;
  if (filter === 'pending') return ['pending', 'mentor_pending', 'student_affairs_pending'].includes(status);
  return status === filter;
}

function reviewHistoryFor(item) {
  if (item.reviewHistory?.length) return item.reviewHistory;
  return [
    ['mentor', item.mentorReviewedBy],
    ['student_affairs', item.studentAffairsReviewedBy],
    ['club', item.reviewedBy],
  ].filter(([, reviewer]) => reviewer).map(([stage, reviewer]) => ({
    stage,
    reviewer,
    status: item.status,
    feedback: item.rejectionFeedback || '',
    reviewedAt: item.updatedAt,
  }));
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

function loadSeenAnnouncementIds(profileId) {
  try {
    const saved = window.localStorage.getItem(`amrita-seen-announcements-${profileId}`);
    if (!saved) return [];
    const ids = JSON.parse(saved);
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') return [];
    throw error;
  }
}

function saveSeenAnnouncementIds(profileId, ids) {
  try {
    window.localStorage.setItem(`amrita-seen-announcements-${profileId}`, JSON.stringify(ids));
    return '';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') return error.message;
    throw error;
  }
}

function loadChatReadAt(profileId) {
  try {
    const saved = window.localStorage.getItem(`amrita-chat-read-at-${profileId}`);
    if (!saved) return {};
    const records = JSON.parse(saved);
    return records && typeof records === 'object' && !Array.isArray(records) ? records : {};
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') return {};
    throw error;
  }
}

function saveChatReadAt(profileId, records) {
  try {
    window.localStorage.setItem(`amrita-chat-read-at-${profileId}`, JSON.stringify(records));
    return '';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') return error.message;
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
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('error');

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setNotice('');
    try {
      if (mode === 'login') {
        try {
          onAuthenticated(await api('/auth/login', { method: 'POST', body: { email, password } }));
        } catch (personalError) {
          if (personalError.status && personalError.status !== 401 && personalError.status !== 400) {
            throw personalError;
          }
          try {
            onAuthenticated(await api('/auth/club-login', { method: 'POST', body: { email, password } }));
          } catch (clubError) {
            throw new Error(clubError.message || 'Incorrect email or password.');
          }
        }
      } else if (mode === 'request-reset') {
        const result = await api('/auth/password-reset/request', { method: 'POST', body: { email } });
        setMode('confirm-reset');
        setNoticeType('ok');
        setNotice(result.message);
      } else {
        if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
        if (newPassword !== confirmPassword) throw new Error('The new passwords do not match.');
        const result = await api('/auth/password-reset/confirm', {
          method: 'POST',
          body: { email, otp, password: newPassword },
        });
        setMode('login');
        setPassword('');
        setOtp('');
        setNewPassword('');
        setConfirmPassword('');
        setNoticeType('ok');
        setNotice(result.message);
      }
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
      <section className="auth-story auth-story-brand-only">
        <PortalBrand className="auth-brand" />
        <span className="story-orbit orbit-one" /><span className="story-orbit orbit-two" />
      </section>

      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <PortalBrand className="mobile-brand" />
          <div className="login-heading"><h2>LOGIN</h2><span aria-hidden="true"><ArrowRight size={21} /></span></div>

          <form className="auth-form" onSubmit={submit}>
            {mode === 'confirm-reset' && <p className="modal-intro">Enter the code sent to your email and choose a new password.</p>}
            <label className="field-label">Username / Email
              <input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={mode === 'confirm-reset'} />
            </label>
            {mode === 'login' && <label className="field-label">Password
              <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>}
            {mode === 'confirm-reset' && <>
              <label className="field-label">Email OTP<input inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 12))} required /></label>
              <label className="field-label">New password<input autoComplete="new-password" type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
              <label className="field-label">Confirm new password<input autoComplete="new-password" type="password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
            </>}
            {notice && <div className={`notice notice-${noticeType}`} role="status">{notice}</div>}
            <button className="button button-primary button-wide" type="submit" disabled={loading}>
              {loading ? 'One moment…' : mode === 'login' ? 'Sign in' : mode === 'request-reset' ? 'Send OTP' : 'Reset password'}
              {!loading && <ArrowRight size={17} />}
            </button>
            {mode === 'login' && <button className="text-link auth-forgot-link" type="button" onClick={() => { setMode('request-reset'); setNotice(''); }}>Forgot password?</button>}
            {mode === 'request-reset' && <button className="text-link auth-forgot-link" type="button" onClick={() => { setMode('login'); setNotice(''); }}>Back to sign in</button>}
            {mode === 'confirm-reset' && <button className="text-link auth-forgot-link" type="button" onClick={() => { setMode('request-reset'); setOtp(''); setNotice(''); }}>Request a new code</button>}
          </form>

        </div>
      </section>
      <SiteFooter />
    </main>
  );
}

function Modal({ type, clubs, allClubs, eventOrganizers, profiles, venues, events = [], reportEvents = [], equipmentItems = [], selectedEquipment, selectedClub, selectedEvent, profile, onClose, onSubmit, busy }) {
  const isEventForm = type === 'event' || type === 'editEvent';
  const isStudentAffairs = profile.role === 'college_admin' && profile.adminType === 'student_affairs';
  const availableEventHosts = isStudentAffairs ? eventOrganizers : clubs;
  const availableCoHosts = isStudentAffairs ? [...allClubs, ...eventOrganizers] : allClubs;
  const [clubId, setClubId] = useState(selectedEvent?.clubId?._id || selectedEvent?.clubId || selectedClub?._id || availableEventHosts[0]?._id || '');
  const [coHostIds, setCoHostIds] = useState((selectedEvent?.coHostIds || []).map((host) => host?._id || host));
  const [eventType, setEventType] = useState(selectedEvent?.eventType || availableEventHosts.find((host) => host._id === (selectedEvent?.clubId?._id || selectedEvent?.clubId || availableEventHosts[0]?._id))?.clubType || 'non_technical');
  const [reportEventId, setReportEventId] = useState(reportEvents[0]?._id || '');
  const [borrowEquipmentId, setBorrowEquipmentId] = useState(selectedEquipment?._id || '');
  const [requestEventId, setRequestEventId] = useState('');
  const [formError, setFormError] = useState('');
  const [logoPreview, setLogoPreview] = useState(selectedClub?.logoUrl || '');
  const [posterPreview, setPosterPreview] = useState(selectedEvent?.posterUrl || '');
  const [reportImages, setReportImages] = useState({});
  const [eventStart, setEventStart] = useState(toDateTimeInput(selectedEvent?.eventDate));
  const [eventEnd, setEventEnd] = useState(toDateTimeInput(selectedEvent?.endDate));
  const [venueAvailability, setVenueAvailability] = useState([]);
  const [availabilityError, setAvailabilityError] = useState('');
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [mentorDropdownOpen, setMentorDropdownOpen] = useState(false);
  const [mentorSearch, setMentorSearch] = useState('');
  const [selectedMentorIds, setSelectedMentorIds] = useState(
    (selectedClub?.mentorIds || []).map((identity) => String(identity?._id || identity)),
  );
  const mentorPickerRef = useRef(null);
  const applicationClub = clubs.find((club) => club._id === clubId);
  const selectedHost = availableEventHosts.find((host) => host._id === clubId);
  const requestClubId = type === 'borrow'
    ? String(equipmentItems.find((item) => item._id === borrowEquipmentId)?.clubId?._id || equipmentItems.find((item) => item._id === borrowEquipmentId)?.clubId || '')
    : clubId;
  const requestEvents = events.filter((item) =>
    String(item.clubId?._id || item.clubId) === String(requestClubId)
    || item.coHostIds?.some((host) => String(host?._id || host) === String(requestClubId)));
  const defaultStartTime = toDateTimeInput(new Date(Date.now() + 5 * 60 * 1000));
  const defaultEndTime = toDateTimeInput(new Date(Date.now() + 7 * 86400000));
  const facultyMentors = profiles.filter((person) => person.role === 'faculty_coordinator');
  const filteredMentors = facultyMentors.filter((person) =>
    `${person.name} ${person.facultyId || ''} ${person.email || ''}`.toLowerCase().includes(mentorSearch.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!mentorDropdownOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!mentorPickerRef.current?.contains(event.target)) setMentorDropdownOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMentorDropdownOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [mentorDropdownOpen]);

  useEffect(() => {
    if (!isEventForm || !eventStart || !eventEnd || new Date(eventEnd) <= new Date(eventStart)) {
      setVenueAvailability([]);
      setAvailabilityError('');
      setCheckingAvailability(false);
      return undefined;
    }
    let active = true;
    setVenueAvailability([]);
    setCheckingAvailability(true);
    setAvailabilityError('');
    const exclude = selectedEvent?._id ? `&excludeEventId=${encodeURIComponent(selectedEvent._id)}` : '';
    api(`/venues/availability?eventDate=${encodeURIComponent(new Date(eventStart).toISOString())}&endDate=${encodeURIComponent(new Date(eventEnd).toISOString())}${exclude}`)
      .then((result) => { if (active) setVenueAvailability(result); })
      .catch((error) => { if (active) setAvailabilityError(error.message); })
      .finally(() => { if (active) setCheckingAvailability(false); });
    return () => { active = false; };
  }, [eventEnd, eventStart, isEventForm, selectedEvent?._id]);

  const submit = async (event) => {
    event.preventDefault();
    setFormError('');
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());
    try {
      if (isClubForm) {
        values.logoUrl = logoPreview;
        values.mentorIds = selectedMentorIds;
      }
      if (isEventForm) {
        values.posterUrl = posterPreview;
        values.eventDate = new Date(eventStart).toISOString();
        values.endDate = new Date(eventEnd).toISOString();
        values.eventType = eventType;
        if (eventType === 'technical') {
          const detailFields = [
            'eventCategory', 'programDrivenBy', 'quarter', 'programLevel', 'programTheme',
            'presidingOfficial', 'resourcePersonType', 'resourcePersonDetails', 'programDescription', 'internalParticipants',
            'externalParticipants', 'sessionMode', 'durationHours', 'estimatedBudget', 'budgetInWords',
            'annexures', 'photoLink', 'impactAnalysis',
          ];
          values.technicalDetails = Object.fromEntries(detailFields
            .map((field) => [field, formData.get(`technical-${field}`)])
            .filter(([, value]) => value !== null && value !== ''));
          values.technicalDetails.programOutcomes = formData.getAll('technical-programOutcomes');
          values.technicalDetails.programSpecificOutcomes = formData.getAll('technical-programSpecificOutcomes');
          values.technicalDetails.sdgGoals = formData.getAll('technical-sdgGoals').map(Number);
        } else if (type === 'editEvent') {
          values.technicalDetails = {};
        }
      }
      if (type === 'eventReport') {
        values.eventId = reportEventId;
        values.reportDetails = buildReportDetails(formData, reportImages);
      }
      if (type === 'borrow') {
        const equipment = equipmentItems.find((item) => item._id === borrowEquipmentId);
        if (!equipment) throw new Error('Choose an available piece of equipment.');
        values.equipmentId = equipment._id;
        values.clubId = equipment.clubId?._id || equipment.clubId;
        values.quantity = Number(values.quantity);
        values.startDate = new Date(values.startDate).toISOString();
        values.endDate = new Date(values.endDate).toISOString();
        values.dueDate = values.endDate;
        if (requestEventId) values.eventId = requestEventId;
      }
      if (type === 'funding') values.eventId = requestEventId;
      const submitValues = ['borrow', 'eventReport'].includes(type) ? values : { ...values, clubId, coHostIds };
      const result = await onSubmit(type, submitValues, type === 'eventReport' ? reportEventId : selectedEvent);
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

  const pickReportImage = async (event, field) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const image = await resizeImage(file, 1400, 'image/jpeg', false);
      setReportImages((current) => ({ ...current, [field]: image }));
      setFormError('');
    } catch (error) {
      setFormError(error.message);
    }
  };

  const modalTitles = {
    apply: 'Join the conversation',
    event: 'Create an event',
    editEvent: 'Edit event details',
    eventReport: 'Create event report',
    borrow: 'Request equipment',
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
          <div><span className="eyebrow">AMRITA SANGAM</span><h2 id="modal-title">{modalTitles[type]}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
        </div>
        <form className="modal-form" onSubmit={submit}>
          {type === 'apply' && <p className="modal-intro">Tell the club a little about what brings you here.</p>}
          {type !== 'club' && type !== 'editClub' && !isEventForm && type !== 'eventReport' && type !== 'borrow' && (
            <label className="field-label">Club
              <select name="clubId" value={clubId} onChange={(event) => { setClubId(event.target.value); setRequestEventId(''); }} required>
                {clubs.map((club) => <option value={club._id} key={club._id}>{club.name}{club.clubType ? ` · ${club.clubType.replace('_', ' ')}` : ''}</option>)}
              </select>
            </label>
          )}
          {isClubForm && <>
            <label className="field-label">Club name<input name="name" required maxLength={100} defaultValue={selectedClub?.name} placeholder="e.g. Design Society" /></label>
            <label className="field-label">Category<input name="category" defaultValue={selectedClub?.category} placeholder="Arts, technology, community…" /></label>
            <label className="field-label">Club motto<input name="motto" maxLength={180} defaultValue={selectedClub?.motto || ''} /></label>
            <label className="field-label">Application domains<textarea name="domains" required maxLength={1200} rows="3" defaultValue={selectedClub?.domains?.join('\n') || 'General'} placeholder={'For example:\nWeb development\nDesign\nEvents'} /><small>Enter one domain per line. Students choose from these when applying.</small></label>
            <label className="field-label">About the club<textarea name="description" required maxLength={2000} rows="3" defaultValue={selectedClub?.description} placeholder="What brings your community together?" /></label>
            <label className="field-label">Club logo (PNG, optional)<input type="file" accept="image/png" onChange={(event) => pickImage(event, 'logo')} /></label>
            {logoPreview && <div className="media-preview"><img src={logoPreview} alt="Club logo preview" /><button type="button" className="text-link" onClick={() => setLogoPreview('')}>Remove logo</button></div>}
            <label className="field-label">Club type<select name="clubType" defaultValue={selectedClub?.clubType || 'non_technical'} required><option value="technical">Technical</option><option value="non_technical">Non-technical</option></select></label>
            {(type === 'club' || type === 'editClub') && profile.role === 'college_admin' && <>
              <label className="field-label">Club shared login email<input name="clubLoginEmail" type="email" autoComplete="off" defaultValue={selectedClub?.clubLoginEmail || ''} /></label>
              {type === 'club' && <label className="field-label">Club shared login password<input name="clubLoginPassword" type="password" minLength={8} maxLength={256} autoComplete="new-password" /><small>Leave both club login fields blank to configure them later. If you set one, you must set both. Credentials are managed by Supabase Auth.</small></label>}
              {type === 'editClub' && <>
                <label className="field-label">Club shared login password<input name="clubLoginPassword" type="password" minLength={8} maxLength={256} autoComplete="new-password" /><small>Leave blank to keep the current password. A new password is managed by Supabase Auth.</small></label>
                <small className="muted-copy">Leave the email blank to keep the current email.</small>
              </>}
            </>}
            <div className="club-mentor-picker" ref={mentorPickerRef}>
              <span className="club-mentor-label">Faculty mentors</span>
              <button
                className="club-mentor-trigger"
                type="button"
                aria-haspopup="dialog"
                aria-expanded={mentorDropdownOpen}
                onClick={() => setMentorDropdownOpen((open) => !open)}
              >
                <span>{selectedMentorIds.length ? `${selectedMentorIds.length} mentor${selectedMentorIds.length === 1 ? '' : 's'} selected` : 'Select mentors'}</span>
                <ChevronDown size={15} />
              </button>
              {mentorDropdownOpen && <div className="club-mentor-menu" role="dialog" aria-label="Choose faculty mentors">
                <label className="club-mentor-search">
                  <Search size={14} />
                  <input autoFocus type="search" value={mentorSearch} onChange={(event) => setMentorSearch(event.target.value)} placeholder="Search faculty mentors" aria-label="Search faculty mentors" />
                </label>
                <div className="club-mentor-options" role="group" aria-label="Faculty mentors">
                  {filteredMentors.map((person) => (
                    <label key={person._id}>
                      <input
                        type="checkbox"
                        checked={selectedMentorIds.includes(String(person._id))}
                        onChange={(event) => setSelectedMentorIds((current) => (
                          event.target.checked
                            ? [...current, String(person._id)]
                            : current.filter((identity) => identity !== String(person._id))
                        ))}
                      />
                      <span>{person.name}<small>{person.facultyId || person.email}</small></span>
                    </label>
                  ))}
                  {!facultyMentors.length && <p>No faculty accounts are available yet. Create a faculty account in ICTS first.</p>}
                  {facultyMentors.length > 0 && !filteredMentors.length && <p>No mentors match that search.</p>}
                </div>
              </div>}
              <small>Select every faculty mentor assigned to this club.</small>
            </div>
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
          {isEventForm && <>
            <label className="field-label">Event type<select name="eventType" value={eventType} disabled={selectedHost?.organizationType !== 'event_organizer'} onChange={(event) => setEventType(event.target.value)}>
              {selectedHost?.organizationType === 'event_organizer'
                ? <><option value="non_technical">Non-technical</option><option value="technical">Technical</option></>
                : <option value={selectedHost?.clubType || 'non_technical'}>{(selectedHost?.clubType || 'non_technical').replace('_', ' ')}</option>}
            </select>{selectedHost?.organizationType !== 'event_organizer' && <small>Event type is based on the selected club.</small>}</label>
            {type === 'event' && <label className="field-label">Event host<select name="clubId" value={clubId} onChange={(event) => {
              const nextHostId = event.target.value;
              setClubId(nextHostId);
              setCoHostIds((current) => current.filter((identity) => identity !== nextHostId));
              const nextHost = availableEventHosts.find((host) => host._id === nextHostId);
              setEventType(nextHost?.clubType || 'non_technical');
            }} required>
              {clubs.length > 0 && !isStudentAffairs && <optgroup label="Clubs">{clubs.map((club) => <option key={club._id} value={club._id}>{club.name} · {club.clubType?.replace('_', ' ')}</option>)}</optgroup>}
              {eventOrganizers.length > 0 && isStudentAffairs && <optgroup label="Student Affairs-managed organizers">{eventOrganizers.map((organizer) => <option key={organizer._id} value={organizer._id}>{organizer.name}</option>)}</optgroup>}
            </select></label>}
            {isEventForm && availableCoHosts.length > 1 && <fieldset className="event-cohost-picker" aria-describedby="event-cohost-help">
              <legend>Co-hosts (optional)</legend>
              {allClubs.filter((club) => club._id !== clubId).length > 0 && <div className="event-cohost-group"><strong>Clubs</strong>{allClubs.filter((club) => club._id !== clubId).map((club) => <label key={club._id}><input type="checkbox" checked={coHostIds.includes(club._id)} onChange={(event) => setCoHostIds((current) => event.target.checked ? [...new Set([...current, club._id])] : current.filter((identity) => identity !== club._id))} />{club.name}</label>)}</div>}
              {eventOrganizers.length > 0 && isStudentAffairs && <div className="event-cohost-group"><strong>Event organizers</strong>{eventOrganizers.filter((organizer) => organizer._id !== clubId).map((organizer) => <label key={organizer._id}><input type="checkbox" checked={coHostIds.includes(organizer._id)} onChange={(event) => setCoHostIds((current) => event.target.checked ? [...new Set([...current, organizer._id])] : current.filter((identity) => identity !== organizer._id))} />{organizer.name}</label>)}</div>}
              <small id="event-cohost-help">Select every club or organizer group partnering on this event.</small>
            </fieldset>}
            <label className="field-label">Event name<input name="title" required maxLength={150} placeholder="Give your event a name" defaultValue={selectedEvent?.title || ''} /></label>
            <label className="field-label">What is it about?<textarea name="description" maxLength={3000} rows="3" placeholder="A few details for people who might come along…" defaultValue={selectedEvent?.description || ''} /></label>
            <label className="field-label">Event poster (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => pickImage(event, 'poster')} /></label>
            {posterPreview && <div className="media-preview media-preview-poster"><img src={posterPreview} alt="Event poster preview" /><button type="button" className="text-link" onClick={() => setPosterPreview('')}>Remove poster</button></div>}
            <label className="field-label">Venue<select name="venueId" required defaultValue={selectedEvent?.venueId?._id || selectedEvent?.venueId || ''} disabled={checkingAvailability}><option value="" disabled>{checkingAvailability ? 'Checking venue availability…' : 'Choose an available venue'}</option>{venues.map((venue) => {
              const availability = venueAvailability.find((item) => item._id === venue._id);
              const currentVenue = String(selectedEvent?.venueId?._id || selectedEvent?.venueId || '') === venue._id;
              return <option key={venue._id} value={venue._id} disabled={availability && !availability.available && !currentVenue}>{venue.name} · {venue.location}{availability && !availability.available && !currentVenue ? ' · Occupied' : ''}</option>;
            })}</select></label>
            {availabilityError && <div className="notice notice-error" role="alert">Could not check venue availability: {availabilityError} The server will check again when you submit.</div>}
            {eventStart && eventEnd && new Date(eventEnd) <= new Date(eventStart) && <div className="notice notice-error" role="alert">The end time must be after the start time.</div>}
            <div className="form-row">
              <label className="field-label">Starts<input name="eventDate" type="datetime-local" required value={eventStart} onChange={(event) => setEventStart(event.target.value)} /></label>
              <label className="field-label">Ends<input name="endDate" type="datetime-local" required min={eventStart || undefined} value={eventEnd} onChange={(event) => setEventEnd(event.target.value)} /></label>
              <label className="field-label">Capacity<input name="capacity" type="number" min="1" max="5000" defaultValue={selectedEvent?.capacity || 100} required /></label>
            </div>
            {eventType === 'technical' && <fieldset className="event-cohost-picker technical-event-details">
              <legend>Technical event proposal details (optional)</legend>
              <div className="form-row">
                <label className="field-label">Event category<select name="technical-eventCategory" defaultValue={selectedEvent?.technicalDetails?.eventCategory || ''}><option value="">Choose category</option><option value="flagship_intercollege">Flagship — Intercollege</option><option value="flagship_interuniversity">Flagship — Inter University</option><option value="independent">Independent</option><option value="collaboration">Collaboration — Amritadhara Club/Forum</option><option value="coordinated">Coordinated — institution-level event</option></select></label>
                <label className="field-label">Program driven by<select name="technical-programDrivenBy" defaultValue={selectedEvent?.technicalDetails?.programDrivenBy || ''}><option value="">Choose activity</option><option value="iic_calendar_activity">IIC Calendar Activity</option><option value="celebration_activity">Celebration Activity</option><option value="self_driven_activity">Self-Driven Activity</option></select></label>
                <label className="field-label">Quarter<select name="technical-quarter" defaultValue={selectedEvent?.technicalDetails?.quarter || ''}><option value="">Choose quarter</option><option value="Q1">Q1 · Sep–Nov</option><option value="Q2">Q2 · Dec–Feb</option><option value="Q3">Q3 · Mar–May</option><option value="Q4">Q4 · Jun–Aug</option></select></label>
                <label className="field-label">Program type / level<select name="technical-programLevel" defaultValue={selectedEvent?.technicalDetails?.programLevel || ''}><option value="">Choose level</option><option value="level_1">Level 1</option><option value="level_2">Level 2</option><option value="level_3">Level 3</option><option value="level_4">Level 4</option></select></label>
              </div>
              <label className="field-label">Program theme<select name="technical-programTheme" defaultValue={selectedEvent?.technicalDetails?.programTheme || ''}><option value="">Choose theme</option><option value="innovation_design_thinking">Innovation &amp; Design Thinking</option><option value="ipr_technology_transfer">IPR &amp; Technology Transfer</option><option value="pre_incubation_incubation_management">Pre-incubation &amp; Incubation Management</option><option value="entrepreneurship_startup">Entrepreneurship &amp; Startup</option></select></label>
              <div className="form-row">
                <label className="field-label">Presiding official<input name="technical-presidingOfficial" maxLength="200" defaultValue={selectedEvent?.technicalDetails?.presidingOfficial || ''} /></label>
                <label className="field-label">Resource person type<select name="technical-resourcePersonType" defaultValue={selectedEvent?.technicalDetails?.resourcePersonType || ''}><option value="">Choose type</option><option value="external">External</option><option value="alumni">Alumni</option><option value="internal">Internal</option></select></label>
              </div>
              <label className="field-label">Resource person details<textarea name="technical-resourcePersonDetails" maxLength="1000" rows="2" defaultValue={selectedEvent?.technicalDetails?.resourcePersonDetails || ''} placeholder="Name, title, organization and contact details" /></label>
              <label className="field-label">Program activities / level details<textarea name="technical-programDescription" maxLength="2000" rows="3" defaultValue={selectedEvent?.technicalDetails?.programDescription || ''} placeholder="Describe proposed activities, hours and the selected program level" /></label>
              <div className="form-row">
                <label className="field-label">Expected internal participants<input name="technical-internalParticipants" type="number" min="0" step="1" defaultValue={selectedEvent?.technicalDetails?.internalParticipants ?? ''} /></label>
                <label className="field-label">Expected external participants<input name="technical-externalParticipants" type="number" min="0" step="1" defaultValue={selectedEvent?.technicalDetails?.externalParticipants ?? ''} /></label>
                <label className="field-label">Mode<select name="technical-sessionMode" defaultValue={selectedEvent?.technicalDetails?.sessionMode || ''}><option value="">Choose mode</option><option value="online">Online</option><option value="offline">Offline</option><option value="hybrid">Hybrid</option></select></label>
                <label className="field-label">Duration (hours)<input name="technical-durationHours" type="number" min="0" step="0.5" defaultValue={selectedEvent?.technicalDetails?.durationHours ?? ''} /></label>
              </div>
              <div className="form-row">
                <label className="field-label">Estimated budget (INR)<input name="technical-estimatedBudget" type="number" min="0" step="1" defaultValue={selectedEvent?.technicalDetails?.estimatedBudget ?? ''} /></label>
                <label className="field-label">Budget in words<input name="technical-budgetInWords" maxLength="300" defaultValue={selectedEvent?.technicalDetails?.budgetInWords || ''} /></label>
              </div>
              <label className="field-label">SDG alignment<select name="technical-sdgGoals" multiple size="4" defaultValue={selectedEvent?.technicalDetails?.sdgGoals?.map(String) || []}><option value="1">SDG 1 — No poverty</option><option value="2">SDG 2 — Zero hunger</option><option value="3">SDG 3 — Good health and well-being</option><option value="4">SDG 4 — Quality education</option><option value="5">SDG 5 — Gender equality</option><option value="6">SDG 6 — Clean water and sanitation</option><option value="7">SDG 7 — Affordable and clean energy</option><option value="8">SDG 8 — Decent work and economic growth</option><option value="9">SDG 9 — Industry, innovation and infrastructure</option><option value="10">SDG 10 — Reduced inequalities</option><option value="11">SDG 11 — Sustainable cities and communities</option><option value="12">SDG 12 — Responsible consumption and production</option><option value="13">SDG 13 — Climate action</option><option value="14">SDG 14 — Life below water</option><option value="15">SDG 15 — Life on land</option><option value="16">SDG 16 — Peace, justice and strong institutions</option><option value="17">SDG 17 — Partnerships for the goals</option></select></label>
              <fieldset className="event-cohost-picker">
                <legend>Program outcomes (optional)</legend>
                <div className="event-cohost-group"><strong>PO</strong>{Array.from({ length: 11 }, (_, index) => `PO${index + 1}`).map((outcome) => <label key={outcome}><input type="checkbox" name="technical-programOutcomes" value={outcome} defaultChecked={selectedEvent?.technicalDetails?.programOutcomes?.includes(outcome)} />{outcome}</label>)}</div>
                <div className="event-cohost-group"><strong>PSO</strong>{Array.from({ length: 4 }, (_, index) => `PSO${index + 1}`).map((outcome) => <label key={outcome}><input type="checkbox" name="technical-programSpecificOutcomes" value={outcome} defaultChecked={selectedEvent?.technicalDetails?.programSpecificOutcomes?.includes(outcome)} />{outcome}</label>)}</div>
              </fieldset>
              <label className="field-label">Impact analysis mapped to POs/PSOs<textarea name="technical-impactAnalysis" maxLength="3000" rows="3" defaultValue={selectedEvent?.technicalDetails?.impactAnalysis || ''} /></label>
              <label className="field-label">Annexures / supporting material<textarea name="technical-annexures" maxLength="2000" rows="2" defaultValue={selectedEvent?.technicalDetails?.annexures || ''} placeholder="Add links or describe attached material" /></label>
              <label className="field-label">Photo link<input name="technical-photoLink" type="url" maxLength="1000" defaultValue={selectedEvent?.technicalDetails?.photoLink || ''} /></label>
            </fieldset>}
          </>}
          {type === 'borrow' && <>
            <label className="field-label">Equipment<select value={borrowEquipmentId} onChange={(event) => { setBorrowEquipmentId(event.target.value); setRequestEventId(''); }} required><option value="" disabled>Select equipment</option>{equipmentItems.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.clubId?.name || 'Club'} ({item.availableQuantity} available)</option>)}</select></label>
            <label className="field-label">Quantity<input name="quantity" type="number" min="1" max={equipmentItems.find((item) => item._id === borrowEquipmentId)?.availableQuantity || 1} step="1" defaultValue="1" required /></label>
            <div className="form-row">
              <label className="field-label">Needed from<input name="startDate" type="datetime-local" min={defaultStartTime} defaultValue={defaultStartTime} required /></label>
              <label className="field-label">Needed until<input name="endDate" type="datetime-local" min={defaultStartTime} defaultValue={defaultEndTime} required /></label>
            </div>
            {requestEvents.length > 0 && <label className="field-label">Related event (optional)<select value={requestEventId} onChange={(event) => setRequestEventId(event.target.value)}><option value="">No event selected</option>{requestEvents.map((item) => <option key={item._id} value={item._id}>{item.title} · {formatDate(item.eventDate)}</option>)}</select></label>}
            <label className="field-label">Reason for request<textarea name="purpose" maxLength="1000" rows="3" placeholder="Explain how the equipment will be used." required /></label>
            <p className="muted-copy">Your faculty mentor reviews this request first, followed by Student Affairs.</p>
          </>}
          {type === 'eventReport' && <>
            <label className="field-label">Event<select value={reportEventId} onChange={(event) => setReportEventId(event.target.value)} required><option value="" disabled>Select a completed event</option>{reportEvents.map((item) => <option key={item._id} value={item._id}>{item.title} · {formatDate(item.eventDate)}</option>)}</select></label>
            <EventReportFields onImageChange={pickReportImage} />
            <p className="muted-copy">The OD attendance CSV is generated from the event’s attendance records when submitted.</p>
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
            <label className="field-label">Related event<select value={requestEventId} onChange={(event) => setRequestEventId(event.target.value)} required><option value="" disabled>Select this club’s event</option>{requestEvents.map((item) => <option key={item._id} value={item._id}>{item.title} · {formatDate(item.eventDate)}</option>)}</select></label>
            <label className="field-label">How much do you need?<input name="requestedAmount" type="number" min="1" step="1" required placeholder="Amount in INR" /></label>
            <label className="field-label">What is it for?<textarea name="purpose" required maxLength={2000} rows="4" placeholder="Tell your coordinator how the funds will be used…" /></label>
          </>}
          {formError && <div className="notice notice-error" role="alert">{formError}</div>}
          <div className="modal-actions">
            <button className="button button-quiet" type="button" onClick={onClose}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={busy || checkingAvailability || (!clubs.length && !isClubForm) || (isEventForm && eventEnd && new Date(eventEnd) <= new Date(eventStart))}>
              {busy ? 'Saving…' : type === 'apply' ? 'Send application' : type === 'funding' ? 'Send request' : type === 'editEvent' ? 'Save event' : 'Save'}
              {!busy && <ArrowRight size={16} />}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RejectionFeedbackDialog({ kind, onClose, onSubmit }) {
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const labels = {
    application: 'club application',
    event: 'event proposal',
    funding: 'funding request',
    borrow: 'equipment request',
    eventReport: 'event report',
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(feedback.trim());
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="rejection-title">
      <div className="modal-heading">
        <div><span className="eyebrow">REVIEW FEEDBACK</span><h2 id="rejection-title">Reject {labels[kind] || 'request'}</h2></div>
        <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={19} /></button>
      </div>
      <form className="modal-form" onSubmit={submit}>
        <p className="modal-intro">Give the submitter a clear reason for this decision. They’ll be able to read this feedback.</p>
        <label className="field-label">Reason for rejection<textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} required maxLength={2000} minLength={3} rows="4" autoFocus /></label>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button className="button button-quiet" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={busy || feedback.trim().length < 3}>{busy ? 'Submitting…' : 'Submit rejection'} <ArrowRight size={16} /></button>
        </div>
      </form>
    </section>
  </div>;
}

function OverviewEventCarousel({ events, onOpen }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingIndex, setPendingIndex] = useState(null);
  const [direction, setDirection] = useState(1);
  const transitionTimer = useRef(null);
  const safeIndex = events.length ? activeIndex % events.length : 0;
  const activeEvent = events[safeIndex];

  const finishTransition = useCallback((targetIndex) => {
    if (targetIndex === null) return;
    window.clearTimeout(transitionTimer.current);
    transitionTimer.current = null;
    setActiveIndex(targetIndex);
    setPendingIndex(null);
  }, []);

  const moveTo = useCallback((nextIndex) => {
    if (events.length < 2) return;
    const normalizedIndex = (nextIndex + events.length) % events.length;
    if (normalizedIndex === safeIndex) {
      window.clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
      setPendingIndex(null);
      return;
    }
    const currentIndex = pendingIndex ?? safeIndex;
    setDirection(normalizedIndex > currentIndex || (currentIndex === events.length - 1 && normalizedIndex === 0) ? 1 : -1);
    setPendingIndex(normalizedIndex);
    window.clearTimeout(transitionTimer.current);
    transitionTimer.current = window.setTimeout(() => finishTransition(normalizedIndex), 650);
  }, [events.length, finishTransition, pendingIndex, safeIndex]);

  useEffect(() => () => window.clearTimeout(transitionTimer.current), []);

  if (!activeEvent) return null;
  const firstIndex = direction < 0 && pendingIndex !== null ? pendingIndex : safeIndex;
  const secondIndex = direction < 0 ? safeIndex : (pendingIndex ?? ((safeIndex + 1) % events.length));
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
        <div className="overview-event-topline"><span className="banner-kicker">UPCOMING CAMPUS EVENT</span><span className="overview-event-count">{index + 1} / {events.length}</span></div>
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
            <button className="icon-button" type="button" onClick={() => moveTo(((pendingIndex ?? safeIndex) - 1 + events.length) % events.length)} aria-label="Previous event"><ChevronLeft size={18} /></button>
            <div className="overview-event-dots" aria-label={`Event ${safeIndex + 1} of ${events.length}`}>
              {events.map((item, itemIndex) => <button
                key={item._id}
                className={`overview-event-dot ${itemIndex === safeIndex ? 'overview-event-dot-active' : ''}`}
                type="button"
                onClick={() => moveTo(itemIndex)}
                aria-label={`Show event ${itemIndex + 1}: ${item.title}`}
                aria-current={itemIndex === safeIndex ? 'true' : undefined}
              />)}
            </div>
            <button className="icon-button" type="button" onClick={() => moveTo(((pendingIndex ?? safeIndex) + 1) % events.length)} aria-label="Next event"><ChevronRight size={18} /></button>
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
  const [rejectionRequest, setRejectionRequest] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [seenAnnouncementIds, setSeenAnnouncementIds] = useState(() => loadSeenAnnouncementIds(profile._id));
  const [chatReadAt, setChatReadAt] = useState(() => loadChatReadAt(profile._id));
  const [unreadChatCounts, setUnreadChatCounts] = useState({});
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedClub, setSelectedClub] = useState(null);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [memberClubId, setMemberClubId] = useState('');
  const [includeEndedMembers, setIncludeEndedMembers] = useState(false);
  const [members, setMembers] = useState([]);
  const [membersError, setMembersError] = useState('');
  const [memberActionError, setMemberActionError] = useState('');
  const [workflowFilter, setWorkflowFilter] = useState('all');
  const [chatClubId, setChatClubId] = useState('');
  const [chatGroup, setChatGroup] = useState('members');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatError, setChatError] = useState('');
  const role = profile.role;
  const memberListUrl = `/members?clubId=${encodeURIComponent(memberClubId)}${includeEndedMembers ? '&includeEnded=true' : ''}`;
  const hasDemoData = Object.values(data).some((value) =>
    Array.isArray(value) && value.some((item) => item?.isDemoData));
  const isStudentAffairs = role === 'college_admin' && profile.adminType === 'student_affairs';
  const hasVerifiedClubAccess = Boolean(profile.isClubAccount && profile.verifiedClubId)
    || Boolean(profile.verifiedClubId && data.memberships.some((membership) =>
    String(membership.clubId?._id || membership.clubId) === String(profile.verifiedClubId)
    && isOfficeBearerPosition(membership)));
  const track = dashboardTrack(role, data.memberships, hasVerifiedClubAccess);
  const verifiedClub = hasVerifiedClubAccess
    ? data.managedClubs.find((club) => String(club._id) === String(profile.verifiedClubId))
      || data.clubs.find((club) => String(club._id) === String(profile.verifiedClubId))
    : null;
  const verifiedClubName = verifiedClub?.name || 'Verified club';
  const copyTrack = track === 'president' ? 'office-bearer' : track;
  const navigation = useMemo(
    () => navigationFor(track).filter((item) => item.id !== 'credentialRequests' || isStudentAffairs),
    [isStudentAffairs, track],
  );
  useEffect(() => {
    const label = navigation.find((item) => item.id === page)?.label || 'Overview';
    const description = page === 'overview'
      ? 'Manage campus clubs, upcoming events and student services in one place.'
      : pageDescription(page, role) || `Manage ${label.toLowerCase()} in Amrita Sangam.`;
    document.title = page === 'overview' ? 'Amrita Sangam' : `${label} | Amrita Sangam`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  }, [navigation, page, role]);
  const isLeadership = (membership) => membership.membershipStatus === 'active'
    && membership.position === 'executive'
    && !membership.officeBearerGroup;
  const isOfficeBearer = isOfficeBearerPosition;
  const canManage = role === 'college_admin'
    || (role === 'faculty_coordinator' && data.managedClubs.some((club) => isClubMentor(club, profile._id)))
    || data.memberships.some(isLeadership);
  const canReview = role === 'college_admin'
    || (role === 'faculty_coordinator' && data.managedClubs.some((club) => isClubMentor(club, profile._id)));
  const canPublishAnnouncement = role === 'college_admin'
    || (role === 'faculty_coordinator' && data.managedClubs.some((club) => isClubMentor(club, profile._id)));
  const memberClubList = hasVerifiedClubAccess
    ? data.managedClubs.filter((club) => club._id === String(profile.verifiedClubId))
    : role === 'college_admin'
      ? data.managedClubs
      : data.managedClubs.filter((club) => isClubMentor(club, profile._id));
  const eventClubList = data.managedClubs.filter((club) =>
    (!hasVerifiedClubAccess || club._id === String(profile.verifiedClubId))
    && (Boolean(profile.isClubAccount && club._id === String(profile.verifiedClubId))
      || data.memberships.some((membership) =>
        (membership.clubId?._id || membership.clubId) === club._id
        && (isLeadership(membership) || (hasVerifiedClubAccess && isOfficeBearerPosition(membership))))));
  const chatRooms = useMemo(() => data.memberships
    .filter((membership) => membership.membershipStatus === 'active')
    .flatMap((membership) => {
      const clubId = membership.clubId?._id || membership.clubId;
      const club = data.managedClubs.find((item) => item._id === clubId);
      if (!club) return [];
      const rooms = [{ clubId, clubName: club.name, group: 'members' }];
      if (isOfficeBearerPosition(membership)) rooms.push({ clubId, clubName: club.name, group: 'office_bearers' });
      return rooms;
    })
    .filter((room, index, rooms) => rooms.findIndex((item) => item.clubId === room.clubId && item.group === room.group) === index),
  [data.managedClubs, data.memberships]);
  useEffect(() => {
    if (!navigation.some((item) => item.id === page)) setPage('overview');
  }, [navigation, page]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setProblem('');
    try {
      const memberships = await api('/members/mine');
      const verifiedClubAccess = Boolean(profile.isClubAccount && profile.verifiedClubId)
        || Boolean(profile.verifiedClubId && memberships.some((membership) =>
        String(membership.clubId?._id || membership.clubId) === String(profile.verifiedClubId)
        && isOfficeBearerPosition(membership)));
      const hasOfficeBearerAccess = memberships.some(isOfficeBearerPosition) && !verifiedClubAccess;
      const [clubs, managedClubs, venues, events, announcements, applications, registrations, participation, equipment, funding, borrows, summary, profiles, eventReports, eventOrganizers, notifications, credentialRequests] = await Promise.all([
        api('/clubs'), api('/my/clubs'), api('/venues'), api('/events/manage'),
        api('/announcements'), api('/applications'), api('/registrations'), api('/participation'), api('/equipment'),
        hasOfficeBearerAccess ? Promise.resolve([]) : api('/funding-requests'),
        api('/equipment-borrows'),
        hasOfficeBearerAccess ? Promise.resolve(initialData.summary) : api('/reports/summary'),
        profile.role === 'college_admin'
          ? api('/profiles')
          : profile.role === 'faculty_coordinator' ? api('/profiles/students') : Promise.resolve([]),
        api('/event-reports'),
        profile.role === 'college_admin' && profile.adminType === 'student_affairs'
          ? api('/event-organizers')
          : Promise.resolve([]),
        api('/notifications'),
        profile.role === 'college_admin' && profile.adminType === 'student_affairs'
          ? api('/club-credential-change-requests')
          : Promise.resolve([]),
      ]);
      const canViewTransactions = ['faculty_coordinator', 'college_admin'].includes(profile.role);
      const transactions = canViewTransactions ? await api('/transactions') : [];
      setData({ ...initialData, clubs, managedClubs, memberships, venues, events, announcements, applications, registrations, participation, equipment, funding, transactions, borrows, summary, profiles, eventReports, eventOrganizers, notifications, credentialRequests });
    } catch (error) {
      setProblem(error.message);
    } finally {
      setLoading(false);
    }
  }, [profile.adminType, profile.isClubAccount, profile.role, profile.verifiedClubId]);

  const canViewTransactions = ['faculty_coordinator', 'college_admin'].includes(role)
  const hasOfficeBearerAccess = data.memberships.some(isOfficeBearer) && !hasVerifiedClubAccess;
  const canViewClubFunding = !hasOfficeBearerAccess;
  const refreshNotificationData = useCallback(async () => {
    try {
      const [applications, memberships, events, funding, eventReports, announcements, transactions, notifications] = await Promise.all([
        api('/applications'),
        api('/members/mine'),
        api('/events/manage'),
        canViewClubFunding ? api('/funding-requests') : Promise.resolve([]),
        api('/event-reports'),
        api('/announcements'),
        canViewTransactions ? api('/transactions') : Promise.resolve([]),
        api('/notifications'),
      ]);
      setData((current) => ({ ...current, applications, memberships, events, funding, eventReports, announcements, transactions, notifications }));
      setNotificationError('');
    } catch (error) {
      setNotificationError(error.message);
    }
  }, [canViewClubFunding, canViewTransactions]);

  const refreshChatNotifications = useCallback(async () => {
    if (!navigation.some((item) => item.id === 'chats') || !chatRooms.length) {
      setUnreadChatCounts({});
      return;
    }
    try {
      const responses = await Promise.all(chatRooms.map(async (room) => ({
        room,
        messages: await api(`/clubs/${room.clubId}/messages?group=${encodeURIComponent(room.group)}`),
      })));
      const nextReadAt = { ...chatReadAt };
      const nextUnreadCounts = {};
      let activeMessages = null;
      responses.forEach(({ room, messages }) => {
        const orderedMessages = [...messages].reverse();
        const roomKey = `${room.clubId}:${room.group}`;
        const latestMessageAt = orderedMessages.reduce((latest, message) => {
          const createdAt = new Date(message.createdAt).getTime();
          return Number.isNaN(createdAt) ? latest : Math.max(latest, createdAt);
        }, 0);
        const cursor = Date.parse(nextReadAt[roomKey] || '');
        if (!Number.isFinite(cursor)) {
          nextReadAt[roomKey] = latestMessageAt ? new Date(latestMessageAt).toISOString() : new Date().toISOString();
        } else {
          const unread = orderedMessages.filter((message) => {
            const createdAt = new Date(message.createdAt).getTime();
            const senderId = message.senderId?._id || message.senderId;
            return !Number.isNaN(createdAt) && createdAt > cursor && String(senderId) !== String(profile._id);
          }).length;
          if (unread) nextUnreadCounts[roomKey] = unread;
        }
        if (page === 'chats' && chatClubId === room.clubId && chatGroup === room.group) {
          activeMessages = orderedMessages;
          if (latestMessageAt) nextReadAt[roomKey] = new Date(latestMessageAt).toISOString();
          delete nextUnreadCounts[roomKey];
        }
      });
      setUnreadChatCounts(nextUnreadCounts);
      if (activeMessages) {
        setChatMessages(activeMessages);
        setChatError('');
      }
      if (JSON.stringify(nextReadAt) !== JSON.stringify(chatReadAt)) {
        setChatReadAt(nextReadAt);
        const storageError = saveChatReadAt(profile._id, nextReadAt);
        if (storageError) setNotificationError(`Chat read status could not be saved: ${storageError}`);
      }
    } catch (error) {
      setNotificationError(error.message);
    }
  }, [chatClubId, chatGroup, chatReadAt, chatRooms, navigation, page, profile._id]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    refreshChatNotifications();
  }, [refreshChatNotifications]);
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === 'visible') {
        refreshNotificationData();
        refreshChatNotifications();
      }
    };
    const interval = window.setInterval(poll, 30_000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [refreshChatNotifications, refreshNotificationData]);
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
    api(memberListUrl)
      .then((result) => { if (active) setMembers(result); })
      .catch((error) => { if (active) setMembersError(error.message); });
    return () => { active = false; };
  }, [memberClubId, memberListUrl, page, data.managedClubs]);

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
  const unreadAnnouncements = data.announcements.filter((announcement) =>
    !seenAnnouncementIds.includes(announcement._id));
  const reviewableApplications = data.applications.filter((application) => {
    if (application.status !== 'pending' || String(application.profileId?._id || application.profileId) === String(profile._id)) return false;
    const clubId = application.clubId?._id || application.clubId;
    const club = data.managedClubs.find((item) => item._id === clubId);
    const isMentor = role === 'faculty_coordinator' && isClubMentor(club, profile._id);
    const isBearer = data.memberships.some((membership) =>
      (membership.clubId?._id || membership.clubId) === clubId && isOfficeBearer(membership));
    return role === 'college_admin' || isMentor || isBearer;
  });
  const pendingInvitations = data.memberships.filter((membership) => membership.membershipStatus === 'pending');
  const eventApprovals = data.events.filter((event) => {
    return (event.status === 'mentor_pending' && role === 'faculty_coordinator' && hasPendingMentorApproval(event, profile._id))
      || (event.status === 'student_affairs_pending' && isStudentAffairs);
  });
  const fundingApprovals = data.funding.filter((item) => {
    return (['pending', 'mentor_pending'].includes(item.status) && role === 'faculty_coordinator' && hasPendingMentorApproval(item, profile._id))
      || (item.status === 'student_affairs_pending' && isStudentAffairs);
  });
  const reportApprovals = data.eventReports.filter((report) => {
    return (report.status === 'mentor_pending' && role === 'faculty_coordinator' && hasPendingMentorApproval(report, profile._id))
      || (report.status === 'student_affairs_pending' && isStudentAffairs);
  });
  const unreadChatMessageCount = Object.values(unreadChatCounts).reduce((total, count) => total + count, 0);
  const notificationCounts = {
    applications: reviewableApplications.length + pendingInvitations.length,
    events: eventApprovals.length,
    funding: fundingApprovals.length,
    eventReports: reportApprovals.length,
    announcements: unreadAnnouncements.length,
    chats: unreadChatMessageCount,
  };
  const notificationItems = [
    { id: 'applications', label: 'Membership applications & invitations', count: notificationCounts.applications },
    { id: 'events', label: 'Event proposals awaiting review', count: notificationCounts.events },
    { id: 'funding', label: 'Funding requests awaiting review', count: notificationCounts.funding },
    { id: 'eventReports', label: 'Event reports awaiting review', count: notificationCounts.eventReports },
    { id: 'chats', label: 'New club chat messages', count: notificationCounts.chats },
    { id: 'announcements', label: 'New announcements', count: notificationCounts.announcements },
  ].filter((item) => item.count > 0 && navigation.some((navItem) => navItem.id === item.id));
  const unreadClubLoginNotifications = data.notifications.filter((item) => item.type === 'club_ob_login' && !item.readAt);
  const totalNotifications = notificationItems.reduce((total, item) => total + item.count, 0)
    + unreadClubLoginNotifications.length;
  const markClubLoginRead = async (notification) => {
    try {
      await api(`/notifications/${notification._id}/read`, { method: 'PATCH' });
      setData((current) => ({
        ...current,
        notifications: current.notifications.map((item) =>
          item._id === notification._id ? { ...item, readAt: new Date().toISOString() } : item),
      }));
      setNotificationError('');
    } catch (error) {
      setNotificationError(error.message);
    }
  };
  const markAnnouncementsSeen = () => {
    const ids = [...new Set([...seenAnnouncementIds, ...data.announcements.map((item) => item._id)])];
    setSeenAnnouncementIds(ids);
    const storageError = saveSeenAnnouncementIds(profile._id, ids);
    if (storageError) setNotificationError(`Announcement read status could not be saved: ${storageError}`);
  };
  const filteredClubs = useMemo(() => data.clubs.filter((club) =>
    `${club.name} ${club.category} ${club.description}`.toLowerCase().includes(search.toLowerCase())), [data.clubs, search]);
  const featuredEvents = useMemo(() => data.events
    .filter((event) => event.status === 'approved' && isUpcomingEvent(event))
    .sort((first, second) => new Date(first.eventDate) - new Date(second.eventDate))
    .slice(0, 8), [data.events]);
  const eventsVisibleToAccount = role === 'student' || profile.isClubAccount
    ? data.events.filter(isUpcomingEvent)
    : data.events;
  const eventDialogEvents = role === 'student' || profile.isClubAccount
    ? data.events.filter(isUpcomingEvent)
    : data.events;

  const createRecord = async (type, values, eventToEdit = null) => {
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
        borrow: '/equipment-borrows',
        funding: '/funding-requests',
        budget: '/budgets',
        transaction: '/transactions',
        club: '/clubs',
      };
      const request = type === 'eventReport'
        ? api(`/events/${eventToEdit}/report`, { method: 'POST', body: values })
        : type === 'editClub'
        ? api(`/clubs/${selectedClub._id}`, { method: 'PATCH', body: values })
        : type === 'editEvent'
          ? api(`/events/${eventToEdit._id}`, { method: 'PATCH', body: values })
        : api(routes[type], { method: 'POST', body: values });
      await request;
      setModal('');
      setEditingEvent(null);
      setSelectedEquipment(null);
      setToast(type === 'apply' ? 'Your application is on its way.' : type === 'editEvent' ? 'Event details updated.' : 'Saved. The right people are in the loop.');
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
  const registerForEvent = async (event) => {
    try {
      await api('/registrations', { method: 'POST', body: { eventId: event._id } });
      setToast('You’re registered for this event.');
      await refresh();
      return true;
    } catch (error) {
      setToast(error.message);
      return false;
    }
  };

  const review = (kind, item, status) => {
    if (status === 'rejected') {
      setRejectionRequest({ kind, item });
      return;
    }
    const routes = {
      application: `/applications/${item._id}`,
      event: `/events/${item._id}/approval`,
      funding: `/funding-requests/${item._id}/approval`,
      borrow: `/equipment-borrows/${item._id}/approval`,
      eventReport: `/event-reports/${item._id}/approval`,
    };

    perform(() => api(routes[kind], {
      method: 'PATCH',
      body: { status },
    }), 'Request approved.');
  };

  const reviewClubCredentialChange = (change, status) => {
    const rejectionFeedback = status === 'rejected'
      ? window.prompt('Why is this club login change being rejected?')
      : '';
    if (status === 'rejected' && !rejectionFeedback?.trim()) return;
    perform(() => api(`/club-credential-change-requests/${change._id}/approval`, {
      method: 'PATCH',
      body: { status, rejectionFeedback },
    }), status === 'approved' ? 'Club login change approved for ICTS to apply.' : 'Club login change rejected.');
  };

  const submitRejection = async (rejectionFeedback) => {
    const { kind, item } = rejectionRequest;
    const routes = {
      application: `/applications/${item._id}`,
      event: `/events/${item._id}/approval`,
      funding: `/funding-requests/${item._id}/approval`,
      borrow: `/equipment-borrows/${item._id}/approval`,
      eventReport: `/event-reports/${item._id}/approval`,
    };
    await api(routes[kind], { method: 'PATCH', body: { status: 'rejected', rejectionFeedback } });
    setRejectionRequest(null);
    setToast('Request rejected with feedback.');
    await refresh();
  };

  const updateMemberRole = async (memberId, nextPosition) => {
    try {
      await api(`/members/${memberId}`, { method: 'PATCH', body: nextPosition });
      setToast('Club role updated.');
      setMembers(await api(memberListUrl));
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
      setMembers(await api(memberListUrl));
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
      setMembers(await api(memberListUrl));
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
    link.download = 'amrita-sangam-club-report.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const navigate = (id) => {
    if (id === 'announcements') markAnnouncementsSeen();
    setPage(id);
    setMenuOpen(false);
    setSearch('');
    setNotificationsOpen(false);
  };
  const openNotification = (id) => {
    if (id === 'chats') {
      const roomKey = Object.keys(unreadChatCounts).find((key) => unreadChatCounts[key] > 0);
      if (roomKey) {
        const [clubId, group] = roomKey.split(':');
        setChatClubId(clubId);
        setChatGroup(group);
      }
    }
    navigate(id);
  };
  const sendChatMessage = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const content = new FormData(form).get('content');
    try {
      await api(`/clubs/${chatClubId}/messages`, { method: 'POST', body: { group: chatGroup, content } });
      form.reset();
      setChatMessages(await api(`/clubs/${chatClubId}/messages?group=${encodeURIComponent(chatGroup)}`).then((messages) => messages.reverse()));
      await refreshChatNotifications();
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
  const reportableEvents = data.events.filter((event) => {
    const clubId = String(event.clubId?._id || event.clubId);
    const alreadyReported = data.eventReports.some((report) => String(report.eventId?._id || report.eventId) === String(event._id));
    if (event.status !== 'approved' || new Date(event.eventDate) > new Date() || alreadyReported) return false;
    if (profile.isClubAccount && String(profile.verifiedClubId) === clubId) return true;
    return data.memberships.some((membership) => String(membership.clubId?._id || membership.clubId) === clubId
      && (isLeadership(membership)
        || (hasVerifiedClubAccess && String(profile.verifiedClubId) === clubId && isOfficeBearerPosition(membership))));
  });
  const borrowableEquipment = data.equipment.filter((item) => {
    const clubId = String(item.clubId?._id || item.clubId);
    return item.availableQuantity > 0
      && ((profile.isClubAccount && String(profile.verifiedClubId) === clubId)
        || data.memberships.some((membership) => String(membership.clubId?._id || membership.clubId) === clubId
          && (isLeadership(membership)
            || (hasVerifiedClubAccess && String(profile.verifiedClubId) === clubId && isOfficeBearerPosition(membership)))));
  });

  const pageAction = () => {
    if (page === 'clubs' && role === 'college_admin') return <button className="button button-primary" onClick={() => setModal('club')}><Plus size={16} /> Create club</button>;
    if (page === 'events' && (eventClubList.length || isStudentAffairs)) return <button className="button button-primary" onClick={() => setModal('event')}><Plus size={16} /> {isStudentAffairs ? 'Create campus event' : 'Propose event'}</button>;
    if (page === 'eventReports' && reportableEvents.length) return <button className="button button-primary" onClick={() => setModal('eventReport')}><Plus size={16} /> Create report</button>;
    if (page === 'announcements' && canPublishAnnouncement) return <button className="button button-primary" onClick={() => setModal('announcement')}><Plus size={16} /> New announcement</button>;
    if (page === 'equipment' && canManage) return <button className="button button-primary" onClick={() => setModal('equipment')}><Plus size={16} /> Add equipment</button>;
    if (page === 'funding' && role === 'college_admin') return <div className="heading-button-group"><button className="button button-outline" onClick={() => setModal('budget')}><Plus size={15} /> Set budget</button><button className="button button-outline" onClick={() => setModal('transaction')}><Plus size={15} /> Record transaction</button><button className="button button-primary" onClick={() => setModal('funding')}><Plus size={15} /> New request</button></div>;
    if (page === 'funding' && (canManage || hasVerifiedClubAccess)) return <button className="button button-primary" onClick={() => setModal('funding')}><Plus size={16} /> New request</button>;
    if (page === 'reports' && (role !== 'student' || hasVerifiedClubAccess)) return <button className="button button-outline" onClick={downloadClubReport}><Download size={15} /> Export CSV</button>;
    return null;
  };

  const openApplications = data.applications.filter((item) => item.status === 'pending'
    && String(item.profileId?._id || item.profileId) !== String(profile._id));
  const greetingName = profile.name?.split(' ')[0] || 'there';

  return (
    <div className={`app-shell shell-${track}`}>
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); navigate('overview'); }}>
          <span className="brand-wordmark"><span>Amrita</span> Sangam</span>
        </a>
        <div className="campus-label"><span className="campus-dot" />{{
          'student-affairs': 'CAMPUS ADMINISTRATION',
          'verified-office-bearer': 'CLUB ACCOUNT',
          mentor: 'FACULTY WORKSPACE',
          president: 'PRESIDENT’S OFFICE',
          'office-bearer': 'CLUB LEADERSHIP',
          executive: 'CLUB EXECUTIVE',
          student: 'STUDENT COMMUNITY',
        }[track]}</div>
        <nav className="side-nav" id="campus-navigation" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${page === id ? 'nav-active' : ''}`} onClick={() => navigate(id)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {notificationCounts[id] > 0 && <b className="nav-count">{notificationCounts[id]}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-help"><div className="help-icon"><CircleHelp size={17} /></div><strong>{hasVerifiedClubAccess ? `${verifiedClubName} account` : track === 'president' ? 'You’re the president' : copyTrack === 'student-affairs' ? 'Campus-wide view' : copyTrack === 'mentor' ? 'Your assigned clubs' : copyTrack === 'office-bearer' ? 'Lead your community' : copyTrack === 'executive' ? 'Build together' : 'Find your people'}</strong><span>{hasVerifiedClubAccess ? 'This workspace is scoped to the club account used at sign-in.' : track === 'president' ? 'Your mentor approves events; you recruit and report.' : copyTrack === 'student-affairs' ? 'Create clubs and coordinate mentors.' : copyTrack === 'mentor' ? 'Guide club leaders and event approvals.' : copyTrack === 'office-bearer' ? 'Welcome members and keep your club moving.' : copyTrack === 'executive' ? 'Help bring club events to life.' : 'Campus life can get busy. We’re right here.'}</span></div>
          <div className="profile-switch">
            <Avatar person={profile} className="user-avatar" />
            <span className="profile-meta"><strong>{profile.name}</strong><small>{profileTrackLabel(profile, track, verifiedClubName, data.memberships)}</small><small><a href={`mailto:${profile.email}`}>{profile.email}</a></small></span>
            {!profile.isClubAccount && <button className="profile-edit-button" onClick={() => navigate('profile')}>Profile</button>}
            <button className="sidebar-logout" onClick={onLogout} aria-label="Sign out"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      {menuOpen && <button className="mobile-menu-backdrop" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}

      <main className="main-panel">
        <header className="topbar">
          <button className="mobile-menu icon-button" type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen} aria-controls="campus-navigation" onClick={() => setMenuOpen(!menuOpen)}><Menu size={21} /></button>
          <div className="breadcrumbs"><span>Amrita Sangam</span>{hasVerifiedClubAccess && <><span className="crumb-slash">/</span><span>{verifiedClubName}</span></>}<span className="crumb-slash">/</span><strong>{currentPage.label}</strong></div>
          <div className="topbar-right">
            <span className="role-pill">{profileTrackLabel(profile, track, verifiedClubName, data.memberships)}</span>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <button className="button button-outline topbar-logout" onClick={onLogout}><LogOut size={15} /> Log out</button>
            <div className="notification-menu">
              <button className="icon-button notification-button" aria-label={`Notifications${totalNotifications ? `, ${totalNotifications} items need attention` : ''}`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}>
                <Bell size={18} />{totalNotifications > 0 && <b className="notification-count">{totalNotifications > 99 ? '99+' : totalNotifications}</b>}
              </button>
              {notificationsOpen && <section className="notification-popover" aria-label="Notifications">
                <div className="notification-popover-heading"><strong>Notifications</strong><button type="button" onClick={refreshNotificationData}>Refresh</button></div>
                {notificationError && <p className="notification-error" role="alert">{notificationError}</p>}
                {data.notifications.filter((item) => item.type === 'club_ob_login').map((item) => {
                  const eventTime = new Date(item.eventAt);
                  return <button className="notification-item" type="button" key={item._id} onClick={() => markClubLoginRead(item)}>
                      <span><strong>{item.clubName} · shared account sign-in</strong><small>Login recorded at {Number.isNaN(eventTime.getTime()) ? 'an unknown time' : eventTime.toLocaleString()}. The person using the shared credentials is not identified.</small></span>
                    {!item.readAt && <b>New</b>}
                  </button>;
                })}
                {notificationItems.length
                  ? notificationItems.map((item) => <button className="notification-item" type="button" key={item.id} onClick={() => openNotification(item.id)}>
                    <span><strong>{item.label}</strong><small>Open to see the details and take action</small></span><b>{item.count}</b>
                  </button>)
                  : <p className="notification-empty">You’re all caught up. New requests and announcements will appear here.</p>}
              </section>}
            </div>
            <button className="topbar-avatar" onClick={() => navigate(profile.isClubAccount ? 'overview' : 'profile')} title={profile.isClubAccount ? 'Club account' : 'My profile'}><Avatar person={profile} className="avatar-inner" /><ChevronDown size={13} /></button>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div><span className="eyebrow">{currentPage.id === 'overview' ? ({
              'student-affairs': 'STUDENT AFFAIRS DESK',
              mentor: 'FACULTY MENTOR DESK',
              president: 'PRESIDENT’S DESK',
              'office-bearer': 'CLUB LEADERSHIP DESK',
              'verified-office-bearer': `CLUB ACCOUNT · ${verifiedClubName.toUpperCase()}`,
              executive: 'YOUR CLUB WORKSPACE',
              student: 'YOUR CAMPUS, YOUR PACE',
            }[track]) : hasVerifiedClubAccess ? `CLUB ACCOUNT · ${verifiedClubName.toUpperCase()}` : 'CAMPUS COMMUNITY'}</span><h1>{page === 'overview' ? (hasVerifiedClubAccess ? verifiedClubName : track === 'president' ? `Lead your club, ${greetingName}.` : copyTrack === 'student-affairs' ? 'Campus, connected.' : copyTrack === 'mentor' ? `Welcome back, ${greetingName}.` : copyTrack === 'office-bearer' ? `Lead with care, ${greetingName}.` : copyTrack === 'executive' ? `Make things happen, ${greetingName}.` : `A little more campus, ${greetingName}.`) : currentPage.label}</h1>
              {page !== 'overview' && page !== 'eventReports' && page !== 'funding' && pageDescription(page, role) && <p>{pageDescription(page, role)}</p>}
            </div>
            <div className="heading-actions">{pageAction()}</div>
          </div>

          {problem && <div className="connection-alert"><span className="connection-dot" /><div><strong>Couldn’t load your campus data</strong><p>{problem}</p></div><button onClick={refresh}>Try again</button></div>}
          {loading && <div className="loading-line"><span /> Bringing your campus together…</div>}
          {hasDemoData && <div className="demo-data-notice" role="status"><strong>Demo data</strong><span>Sample records are labeled and should not be treated as live campus activity.</span></div>}

          {!problem && page === 'overview' && (
            <>
              {hasVerifiedClubAccess && <section className="surface-card list-surface">
                <SectionHeading
                  title={`${verifiedClubName} club account`}
                  subtitle="This shared-account workspace is limited to this club's membership, events, funding, equipment, and reports."
                />
              </section>}
              {featuredEvents.length
                ? <OverviewEventCarousel events={featuredEvents} onOpen={setSelectedEvent} />
                : !hasVerifiedClubAccess && <section className="welcome-banner">
                  <div className="welcome-copy"><span className="banner-kicker">{{
                    'student-affairs': 'CAMPUS AT A GLANCE',
                    mentor: 'YOUR MENTORSHIP, IN MOTION',
                    president: 'YOU LEAD THIS CLUB',
                    'office-bearer': 'A GOOD DAY TO LEAD',
                    'verified-office-bearer': `VERIFIED CLUB ACCOUNT · ${verifiedClubName.toUpperCase()}`,
                    executive: 'MAKE YOUR NEXT IDEA HAPPEN',
                    student: 'A GOOD DAY TO GET INVOLVED',
                  }[track]}</span><h2>{track === 'president' ? <>Lead club<br />activities.</> : copyTrack === 'student-affairs' ? <>Manage campus<br />clubs and events.</> : copyTrack === 'mentor' ? <>Review club<br />requests.</> : copyTrack === 'office-bearer' ? <>Manage club<br />members.</> : copyTrack === 'executive' ? <>Manage your<br />club activity.</> : <>Explore clubs<br />and upcoming events.</>}</h2><p>{track === 'president' ? 'Recruit executives, submit event proposals, and coordinate with your faculty mentor.' : copyTrack === 'student-affairs' ? 'Create clubs, coordinate mentors, and review campus requests.' : copyTrack === 'mentor' ? 'Review event, equipment, and funding requests for your clubs.' : copyTrack === 'office-bearer' ? 'Review applications and help maintain the club roster.' : copyTrack === 'executive' ? 'Plan events and request equipment for your club.' : 'View club details and register for upcoming campus events.'}</p>
                    <button className="button button-light" onClick={() => navigate(track === 'president' ? 'applications' : copyTrack === 'student-affairs' ? 'clubs' : copyTrack === 'mentor' ? 'members' : copyTrack === 'office-bearer' ? 'applications' : copyTrack === 'executive' ? 'events' : 'clubs')}>{track === 'president' ? 'Recruit executives' : copyTrack === 'student-affairs' ? 'Manage clubs' : copyTrack === 'mentor' ? 'Support club leaders' : copyTrack === 'office-bearer' ? 'Review applications' : track === 'executive' ? 'Explore events' : 'Find your community'} <ArrowRight size={16} /></button>
                  </div>
                  <div className="banner-graphic" aria-hidden="true"><span className="graphic-ring ring-a" /><span className="graphic-ring ring-b" /><span className="graphic-caption">CLUBS<br />&amp; EVENTS</span><span className="graphic-orbit"><i /><i /><i /></span></div>
                </section>}

              {hasVerifiedClubAccess
                ? <section className="stat-grid">
                  <StatCard icon={CalendarDays} label="Club events" value={data.summary.events} foot="Proposals and scheduled events" tone="peach" />
                  <StatCard icon={Laptop} label="Club equipment" value={data.summary.equipment} foot="Items available to request" tone="lavender" />
                  <StatCard icon={FolderKanban} label="Event reports submitted" value={data.summary.reportsSubmitted || 0} foot="For this club only" tone="mint" />
                  <StatCard icon={Users} label="Club members" value={data.summary.members} foot="Your verified club community" tone="butter" />
                </section>
                : <section className="stat-grid">
                  <StatCard icon={Compass} label="Clubs to explore" value={data.summary.clubs} foot="Find your corner of campus" tone="lavender" />
                  <StatCard icon={CalendarDays} label="Upcoming events" value={data.events.filter((event) => event.status === 'approved' && isUpcomingEvent(event)).length} foot="Approved events that have not ended" tone="peach" />
                  <StatCard icon={Users} label="People showing up" value={data.summary.members} foot="Campus is better together" tone="mint" />
                  <StatCard icon={Clock3} label="Needs a little attention" value={isStudentAffairs
                    ? notificationCounts.events + notificationCounts.funding + notificationCounts.eventReports
                    : canReview ? openApplications.length : data.applications.filter((app) => app.status === 'pending').length}
                  foot={isStudentAffairs ? 'Requests to review' : canReview ? 'Applications to review' : 'Membership applications'} tone="butter" />
                </section>}

              <section className="portal-shortcuts" aria-label="Campus services">
                <h2>Campus services</h2>
                <div className="portal-shortcut-grid">
                  {navigation.map(({ id, label, icon: Icon }) => (
                    <button className="portal-shortcut" key={id} onClick={() => navigate(id)}>
                      <i aria-hidden="true"><Icon size={17} /></i><span>{label}</span>
                    </button>
                  ))}
                </div>
              </section>

              {(track === 'president' || track === 'verified-office-bearer') && <section className="president-desk surface-card">
                <SectionHeading title={track === 'president' ? 'President’s desk' : `${verifiedClubName} account`} subtitle={track === 'president'
                  ? `You lead ${data.memberships.filter((m) => m.membershipStatus !== 'pending' && m.position === 'president').map((m) => m.clubId?.name).filter(Boolean).join(', ') || 'your club'}.`
                  : 'Your club sign-in is verified. Recruit members, view your roster, propose events, request funding and equipment, and submit reports for this club.'} />
                <div className="president-actions">
                  {track === 'president' && <button onClick={() => navigate('applications')}><Users size={17} /><strong>Recruit executives</strong><small>{openApplications.length} application{openApplications.length === 1 ? '' : 's'} waiting</small></button>}
                  {track === 'verified-office-bearer' && <button onClick={() => navigate('applications')}><Users size={17} /><strong>Membership & recruitment</strong><small>{openApplications.length} application{openApplications.length === 1 ? '' : 's'} waiting</small></button>}
                  {track === 'verified-office-bearer' && <button onClick={() => navigate('members')}><Users size={17} /><strong>Club members</strong><small>View the verified club roster</small></button>}
                  <button onClick={() => navigate('events')}><CalendarDays size={17} /><strong>Plan an event</strong><small>Propose it to your mentor</small></button>
                  <button onClick={() => navigate('eventReports')}><FolderKanban size={17} /><strong>Event reports</strong><small>Submit after each event</small></button>
                  <button onClick={() => navigate('equipment')}><Laptop size={17} /><strong>Equipment</strong><small>Request club equipment</small></button>
                  {track === 'verified-office-bearer' && <button onClick={() => navigate('funding')}><WalletCards size={17} /><strong>Funding</strong><small>Request club funding</small></button>}
                  {track === 'verified-office-bearer' && <button onClick={() => navigate('reports')}><BarChart3 size={17} /><strong>Club reports</strong><small>{data.summary.reportsSubmitted || 0} event reports submitted</small></button>}
                </div>
              </section>}

              <div className="content-grid">
                <section className="surface-card feature-card">
                  <SectionHeading title="Upcoming events" subtitle="Approved events that have not ended." action="See all events" onAction={() => navigate('events')} />
                  {featuredEvents.slice(0, 3).map((event, index) => <EventRow key={event._id} event={event} index={index} onDetails={() => setSelectedEvent(event)} />)}
                  {!featuredEvents.length && <EmptyState title="No upcoming events" text="Approved events will appear here when they are scheduled." />}
                </section>
                <section className="surface-card announcement-card">
                  <SectionHeading title="Around campus" subtitle="Notes from your community." action="All notes" onAction={() => navigate('announcements')} />
                  {data.announcements.slice(0, 3).map((note) => <AnnouncementRow key={note._id} note={note} />)}
                  {!data.announcements.length && <EmptyState title="Nothing new just yet" text="Club updates will appear here." />}
                </section>
              </div>
              {(role !== 'student' || hasVerifiedClubAccess) && !hasOfficeBearerAccess && <div className="insight-strip"><div className="insight-icon"><FolderKanban size={18} /></div><div><strong>Your community, at a glance</strong><span>{formatMoney(data.summary.spent)} spent of {formatMoney(data.summary.allocated)} allocated across club budgets.</span></div><button onClick={() => navigate('funding')}>Explore funding <ArrowRight size={15} /></button></div>}
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
                    canApply={!profile.isClubAccount && role === 'student'}
                    onApply={() => { setSelectedClub(club); setModal('apply'); }}
                    onEdit={() => { setSelectedClub(club); setModal('editClub'); }}
                    onDetails={() => { setSelectedClub(club); setModal('clubDetails'); }}
                  />;
                })}
              </div>
              {!filteredClubs.length && <EmptyState title="No clubs found" text="Try another search or come back as new communities join." />}
            </>
          )}

          {!problem && page === 'events' && (
            <div className="surface-card list-surface">
              <div className="workflow-heading"><SectionHeading title="Make a date with campus" subtitle="Good company is already on the calendar." /><WorkflowFilter value={workflowFilter} onChange={setWorkflowFilter} /></div>
              <div className="events-grid">
              {eventsVisibleToAccount.filter((event) => statusMatchesFilter(event.status, workflowFilter)).map((event, index) => {
                const clubId = event.clubId?._id || event.clubId;
                const eventPosition = data.memberships.find((member) => (member.clubId?._id || member.clubId) === clubId);
                const canTakeAttendance = Boolean(
                  profile.isClubAccount
                  && String(clubId) === String(profile.verifiedClubId)
                );
                const canSubmitClubRequest = Boolean(
                  (profile.isClubAccount && String(clubId) === String(profile.verifiedClubId))
                  || (eventPosition && (isLeadership(eventPosition)
                    || (hasVerifiedClubAccess
                      && String(clubId) === String(profile.verifiedClubId)
                      && isOfficeBearerPosition(eventPosition))))
                );
                const isCampusOrganizerEvent = event.clubId?.organizationType === 'event_organizer';
                const canEditEvent = isCampusOrganizerEvent
                  ? isStudentAffairs && event.status === 'student_affairs_pending'
                  : canSubmitClubRequest && !mentorReviewStarted(event) && ['draft', 'mentor_pending'].includes(event.status);
                const showClubAccountEdit = profile.isClubAccount && String(clubId) === String(profile.verifiedClubId);
                const canReviewEvent = event.status === 'mentor_pending'
                  ? role === 'faculty_coordinator' && hasPendingMentorApproval(event, profile._id)
                  : event.status === 'student_affairs_pending' && isStudentAffairs;
                return <div key={event._id} className="event-workflow">
                  <EventRow event={event} index={index} canReview={canReviewEvent} needsReview={canReviewEvent} canResubmit={canSubmitClubRequest} canEdit={canEditEvent}
                    showEdit={showClubAccountEdit} editDisabled={showClubAccountEdit && !canEditEvent}
                    onEdit={() => { setEditingEvent(event); setModal('editEvent'); }} onDetails={() => setSelectedEvent(event)} onReview={(status) => review('event', event, status)} onResubmit={() => perform(() => api(`/events/${event._id}/submit`, { method: 'PATCH' }), 'Event resubmitted to the club mentor.')} />
                  {canTakeAttendance && event.status === 'approved' && <AttendancePanel event={event} onError={setToast} />}
                </div>;
              })}
              {!eventsVisibleToAccount.some((event) => statusMatchesFilter(event.status, workflowFilter)) && <EmptyState title="No events in this view" text={workflowFilter === 'all' ? 'Upcoming events will show up here.' : 'Try another status filter to see more events.'} />}
              </div>
            </div>
          )}

          {!problem && page === 'applications' && (
            <>
            <section className="surface-card list-surface"><div className="workflow-heading"><SectionHeading title={role === 'student' ? 'Your membership journey' : 'A few people are waiting'} subtitle={role === 'student'
                ? ''
                : role === 'faculty_coordinator'
                  ? 'As a club mentor, review applications and recruit members before office bearers are appointed.'
                  : 'Help someone find their people.'} /><WorkflowFilter value={workflowFilter} onChange={setWorkflowFilter} /></div>
                {data.memberships.filter((membership) => membership.membershipStatus === 'pending').map((membership) => (
                  <PositionInvitation key={membership._id} membership={membership}
                    onRespond={(response) => respondToPositionInvite(membership, response)} />
                ))}
                {data.applications.filter((application) => statusMatchesFilter(application.status, workflowFilter)).map((application) => {
                  const clubId = application.clubId?._id || application.clubId;
                  const applicationClub = data.clubs.find((club) => club._id === clubId);
                  const isAssignedMentor = role === 'faculty_coordinator'
                    && isClubMentor(applicationClub, profile._id);
                  const canReviewApplication = role === 'college_admin' || isAssignedMentor
                    || (hasVerifiedClubAccess && String(clubId) === String(profile.verifiedClubId));
                  return <ApplicationRow key={application._id} application={application} isOwn={String(application.profileId?._id || application.profileId) === String(profile._id)} canReview={canReviewApplication} onReview={(status) => review('application', application, status)} />;
                })}
                {!data.applications.some((application) => statusMatchesFilter(application.status, workflowFilter)) && <EmptyState title="No applications in this view" text={workflowFilter === 'all' ? 'Club applications will appear here.' : 'Try another status filter to see more applications.'} />}
            </section>
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
                  ? ''
                  : 'A good community starts with good company.'} />
                <label className="club-picker">Club<select value={memberClubId} onChange={(event) => setMemberClubId(event.target.value)} disabled={!memberClubList.length}>
                  {memberClubList.map((club) => <option key={club._id} value={club._id}>{club.name}</option>)}
                </select></label>
                <label className="workflow-filter"><input type="checkbox" checked={includeEndedMembers} onChange={(event) => setIncludeEndedMembers(event.target.checked)} /> Include past members</label>
              </div>
              {memberClubId && (role === 'college_admin' || isClubMentor(memberClubList.find((club) => club._id === memberClubId), profile._id)) && <form className="member-assign-form" onSubmit={assignMember}>
                <label className="field-label">Nominee<select name="profileId" required defaultValue=""><option value="" disabled>Select an active club member</option>{data.profiles.filter((person) => ['student', 'club_committee'].includes(person.role)
                  && members.some((member) => String(member.profileId?._id || member.profileId) === String(person._id)
                    && member.membershipStatus === 'active')).map((person) => <option key={person._id} value={person._id}>{person.name} · {person.email}</option>)}</select></label>
                <label className="field-label">Invite for position<select name="position"><option value="president">President</option><option value="vice_president">Vice president</option><option value="treasurer">Treasurer</option><option value="secretary">Secretary</option><option value="office_bearer">Office bearer</option></select></label>
                <button className="button button-primary" type="submit"><Plus size={15} /> Send invitation</button>
              </form>}
              {memberActionError && <div className="notice notice-error" role="alert">{memberActionError}</div>}
              {membersError && <div className="notice notice-error" role="alert">{membersError}</div>}
              {!memberClubList.length ? <EmptyState title="No club roster access" text="A club's office bearers and Student Affairs can view its member list." /> :
                members.length ? members.map((member) => {
                  const selectedClub = memberClubList.find((club) => club._id === memberClubId);
                  const isAssignedMentor = isClubMentor(selectedClub, profile._id);
                  const isPastMember = member.membershipStatus === 'ended';
                  const canRemoveMember = isAssignedMentor || role === 'college_admin';
                  return <MemberRow key={member._id} member={member} canEdit={!isPastMember && (isAssignedMentor || role === 'college_admin')} canRemove={!isPastMember && canRemoveMember} onRemove={() => removeMember(member)} onRoleChange={(position, officeBearerGroup) => updateMemberRole(member._id, { position, officeBearerGroup })} />;
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
                    {data.managedClubs.map((club) => {
                      const clubUnread = Object.entries(unreadChatCounts)
                        .filter(([roomKey]) => roomKey.startsWith(`${club._id}:`))
                        .reduce((total, [, count]) => total + count, 0);
                      return <option key={club._id} value={club._id}>{club.name}{clubUnread ? ` · ${clubUnread} new` : ''}</option>;
                    })}
                  </select></label>
                  <label className="club-picker">Room<select value={chatGroup} onChange={(event) => setChatGroup(event.target.value)}>
                    <option value="members">Club members{unreadChatCounts[`${chatClubId}:members`] ? ` · ${unreadChatCounts[`${chatClubId}:members`]} new` : ''}</option>
                    <option value="office_bearers">Office bearers (private){unreadChatCounts[`${chatClubId}:office_bearers`] ? ` · ${unreadChatCounts[`${chatClubId}:office_bearers`]} new` : ''}</option>
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
                  const activeBorrow = data.borrows.find((borrow) => borrow.equipmentId?._id === item._id
                    && (String(borrow.profileId?._id || borrow.profileId) === String(profile._id)
                      || (profile.isClubAccount && String(borrow.clubId?._id || borrow.clubId) === String(profile.verifiedClubId))));
                  const canRequestEquipment = Boolean(profile.isClubAccount && String(clubId) === String(profile.verifiedClubId))
                    || data.memberships.some((membership) =>
                    (membership.clubId?._id || membership.clubId) === clubId
                    && (isLeadership(membership)
                      || (hasVerifiedClubAccess
                        && String(clubId) === String(profile.verifiedClubId)
                        && isOfficeBearerPosition(membership))));
                  return <EquipmentCard key={item._id} equipment={item} index={index} isPresident={canRequestEquipment} activeBorrow={activeBorrow} onBorrow={() => { setSelectedEquipment(item); setModal('borrow'); }} onReturn={() => perform(() => api(`/equipment-borrows/${activeBorrow._id}/return`, { method: 'PATCH' }), 'Thanks for bringing it back.') } />;
                })}
                {!data.equipment.length && <EmptyState title="Nothing in the loan cupboard yet" text="Club equipment will be listed here when it’s available." />}
              </div>
              {data.borrows.some((borrow) => ['mentor_pending', 'student_affairs_pending'].includes(borrow.status))
                || (profile.isClubAccount && data.borrows.length > 0) ? <section className="surface-card list-surface workflow-list">
              <SectionHeading title={profile.isClubAccount ? 'Equipment requests' : 'Equipment approvals'} subtitle="Requests move from the club mentor to Student Affairs." />
              {data.borrows.filter((borrow) =>
                ['mentor_pending', 'student_affairs_pending'].includes(borrow.status)
                || (profile.isClubAccount
                  && String(borrow.clubId?._id || borrow.clubId) === String(profile.verifiedClubId))).map((borrow) => {
                const mentorReview = borrow.status === 'mentor_pending' && role === 'faculty_coordinator'
                  && hasPendingMentorApproval(borrow, profile._id);
                const affairsReview = borrow.status === 'student_affairs_pending' && isStudentAffairs;
                const clubRequest = profile.isClubAccount
                  && String(borrow.clubId?._id || borrow.clubId) === String(profile.verifiedClubId);
                return <BorrowApprovalRow key={borrow._id} borrow={borrow} canReview={mentorReview || affairsReview}
                  canEdit={clubRequest}
                  onUpdate={(values) => api(`/equipment-borrows/${borrow._id}`, { method: 'PATCH', body: values }).then(refresh)}
                  onError={setToast}
                  onReview={(status) => review('borrow', borrow, status)} />;
              })}
              </section> : null}
            </>
          )}

          {!problem && page === 'funding' && (
            <section className="surface-card list-surface funding-page">
                <SpendingChart transactions={data.transactions} />
                <div className="workflow-heading"><SectionHeading title="Funding requests" /><WorkflowFilter value={workflowFilter} onChange={setWorkflowFilter} /></div>
                {data.funding.filter((item) => statusMatchesFilter(item.status, workflowFilter)).map((item) => {
                  const canReviewFunding = (['pending', 'mentor_pending'].includes(item.status)
                    && role === 'faculty_coordinator' && hasPendingMentorApproval(item, profile._id))
                    || (item.status === 'student_affairs_pending' && isStudentAffairs);
                  const clubRequest = profile.isClubAccount
                    && String(item.clubId?._id || item.clubId) === String(profile.verifiedClubId);
                  return <FundingRow key={item._id} request={item} canReview={canReviewFunding} canEdit={clubRequest}
                    onUpdate={(values) => api(`/funding-requests/${item._id}`, { method: 'PATCH', body: values }).then(refresh)}
                    onError={setToast}
                    onReview={(status) => review('funding', item, status)} />;
                })}
                {!data.funding.some((item) => statusMatchesFilter(item.status, workflowFilter)) && <EmptyState title="No funding requests in this view" text="Try another status filter or return when a club submits a request." />}
            </section>
          )}

          {!problem && page === 'reports' && (
            <section className="report-page">
              <div className="report-stat-grid">
                <ReportStat label="Club communities" value={data.summary.clubs} tone="lavender" />
                <ReportStat label="Members" value={data.summary.members} tone="mint" />
                <ReportStat label="Events" value={data.summary.events} tone="peach" />
                <ReportStat label="Pending applications" value={data.summary.pendingApplications} tone="butter" />
                <ReportStat label="Event reports submitted" value={data.summary.reportsSubmitted || 0} tone="lavender" />
              </div>
              <div className="report-table surface-card">
                <SectionHeading title="Club activity" subtitle="Membership, events, reports, and announcements—one clear view." />
                <div className="report-table-head"><span>Community</span><span>Members</span><span>Events</span><span>Reports</span><span>Activity</span><span>Budget</span></div>
                {(data.summary.clubReports || []).map((club) => <div className="report-table-row" key={club._id}>
                  <div className="report-club"><span className="report-club-mark">{initials(club.name)}</span><span><strong>{club.name}</strong><small>{club.category || 'Campus community'}</small></span></div>
                  <span>{club.members}</span><span>{club.events}</span><span>{club.reportsSubmitted || 0}</span><span>{club.announcements} updates</span>
                  <span>{role === 'student' ? '—' : <>{formatMoney(club.spent)} <small>of {formatMoney(club.allocated)}</small></>}</span>
                </div>)}
                {!data.summary.clubReports?.length && <EmptyState title="No club reports yet" text="Reports for the clubs you manage will appear here." />}
              </div>
              {role !== 'student' && <div className="report-note"><ShieldCheck size={17} /><span>Financial details are scoped to the clubs you manage. Export a CSV when you need to share a snapshot.</span></div>}
            </section>
          )}

          {!problem && page === 'credentialRequests' && (
            <section className="surface-card list-surface">
              <SectionHeading title="Club login changes" subtitle="Review ICTS requests before any shared club email or password is changed." />
              {data.credentialRequests.map((change) => <article className="application-row" key={change._id}>
                <div className="application-details">
                  <div className="application-title"><strong>{change.clubId?.name || 'Club'}</strong><span className={statusClass(change.status)}>{change.status}</span></div>
                  <p>Requested by {change.requestedBy?.name || change.requestedBy?.email || 'ICTS'}</p>
                  <small>{change.clubLoginEmail ? `New email: ${change.clubLoginEmail}` : 'Email unchanged'} · {change.passwordChangeRequested ? 'New password supplied (hidden)' : 'Password unchanged'}</small>
                </div>
                {change.status === 'pending' && <div className="review-actions">
                  <button className="review-accept" type="button" aria-label="Approve club login change" onClick={() => reviewClubCredentialChange(change, 'approved')}><Check size={15} /></button>
                  <button className="review-decline" type="button" aria-label="Reject club login change" onClick={() => reviewClubCredentialChange(change, 'rejected')}><X size={15} /></button>
                </div>}
              </article>)}
              {!data.credentialRequests.length && <EmptyState title="No club login changes to review" text="New ICTS requests will be listed here before they can be applied." />}
            </section>
          )}

          {page === 'profile' && <ProfilePage profile={profile} onSaved={onProfileUpdate} notify={setToast} />}

          {!problem && page === 'eventReports' && (
            <section className="surface-card list-surface">
              <div className="workflow-heading"><SectionHeading title="Event reports & OD attendance" /><WorkflowFilter value={workflowFilter} onChange={setWorkflowFilter} /></div>
              {data.eventReports.filter((report) => statusMatchesFilter(report.status, workflowFilter)).map((report) => {
                const clubId = report.clubId?._id || report.clubId;
                const canSubmitReport = Boolean(profile.isClubAccount
                  && String(clubId) === String(profile.verifiedClubId))
                  || data.memberships.some((membership) =>
                  (membership.clubId?._id || membership.clubId) === clubId
                  && (isLeadership(membership)
                    || (hasVerifiedClubAccess
                      && String(clubId) === String(profile.verifiedClubId)
                      && isOfficeBearerPosition(membership))));
                const clubReport = profile.isClubAccount && String(clubId) === String(profile.verifiedClubId);
                const canReviewReport = (report.status === 'mentor_pending'
                  && role === 'faculty_coordinator' && hasPendingMentorApproval(report, profile._id))
                  || (report.status === 'student_affairs_pending' && isStudentAffairs);
                return <ReportRow key={report._id} report={report} canResubmit={canSubmitReport && !profile.isClubAccount}
                  canEdit={clubReport} canReview={canReviewReport}
                  onReview={(status) => review('eventReport', report, status)}
                  onDownload={() => apiDownload(`/event-reports/${report._id}/roster`, report.rosterFileName || 'event-attendance.csv')
                    .catch((error) => setToast(error.message))}
                  onResubmit={(values) => api(`/event-reports/${report._id}/resubmit`, { method: 'PATCH', body: values }).then(refresh)}
                  onError={setToast} />;
              })}
              {!data.eventReports.some((report) => statusMatchesFilter(report.status, workflowFilter)) && <EmptyState title="No event reports in this view" text={workflowFilter === 'all' ? 'Reports appear here after a club executive submits one for review.' : 'Try another status filter to see more reports.'} />}
            </section>
          )}

          {!problem && page === 'announcements' && (
            <section className="announcement-list">
              {data.announcements.map((note) => {
                const isNew = !seenAnnouncementIds.includes(note._id);
                return <article className={`surface-card announcement-full ${isNew ? 'announcement-unread' : ''}`} key={note._id}><div className={`announcement-symbol ${note.priority === 'high' ? 'symbol-warm' : ''}`}><Megaphone size={19} /></div><div className="announcement-content"><div className="announcement-meta"><span>{note.clubId?.name || 'Campus community'}</span><span>·</span><span>{formatDate(note.postedDate)}</span>{isNew && <span className="announcement-new-label">NEW</span>}{note.priority === 'high' && <span className="priority-label">IMPORTANT</span>}</div><h3>{note.title}</h3><p>{note.content}</p></div></article>;
              })}
              {!data.announcements.length && <EmptyState title="A quiet noticeboard" text="When clubs share an update, you’ll find it here." />}
            </section>
          )}
        </div>
        <SiteFooter />
      </main>

      {toast && <div className="toast" role="status"><span><Check size={15} /></span>{toast}<button onClick={() => setToast('')} aria-label="Dismiss"><X size={15} /></button></div>}
      {selectedEvent && <EventDetailsDialog
        event={selectedEvent}
        events={eventDialogEvents}
        registrations={registrationByEvent}
        onNavigate={setSelectedEvent}
        onClose={() => setSelectedEvent(null)}
        canRegister={role === 'student'}
        onRegister={registerForEvent}
      />}
      {modal === 'clubDetails' && selectedClub && <ClubDetailsDialog
        club={selectedClub}
        onClose={() => setModal('')}
        canApply={!profile.isClubAccount && role === 'student'}
        isMember={membershipClubIds.has(selectedClub._id)}
        application={applicationByClub.get(selectedClub._id)}
        onApply={() => setModal('apply')}
      />}
      {modal && modal !== 'clubDetails' && <Modal
        type={modal}
        clubs={modal === 'apply' ? data.clubs : ['event', 'editEvent'].includes(modal) ? (isStudentAffairs ? data.clubs : eventClubList) : memberClubList}
        allClubs={data.clubs}
        eventOrganizers={data.eventOrganizers}
        profiles={data.profiles}
        venues={data.venues}
        reportEvents={reportableEvents}
        equipmentItems={borrowableEquipment}
        events={eventDialogEvents}
        selectedEquipment={modal === 'borrow' ? selectedEquipment : null}
        profile={profile}
        selectedClub={modal === 'club' ? null : modal === 'apply' || modal === 'editClub' ? selectedClub : ['event', 'editEvent'].includes(modal) ? eventClubList[0] : memberClubList[0]}
        selectedEvent={modal === 'editEvent' ? editingEvent : null}
        busy={busy}
        onClose={() => { setModal(''); setEditingEvent(null); setSelectedEquipment(null); }}
        onSubmit={createRecord}
      />}
      {rejectionRequest && <RejectionFeedbackDialog
        kind={rejectionRequest.kind}
        onClose={() => setRejectionRequest(null)}
        onSubmit={submitRejection}
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
      <SectionHeading title="Change password" subtitle="Your password is stored securely by Supabase Auth, never in Amrita Sangam’s records." />
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

function IctsEditAccountModal({ person, onClose, onSaved }) {
  const [role, setRole] = useState(person.role);
  const [department, setDepartment] = useState(person.department || '');
  const [section, setSection] = useState(person.section || accountDepartments[person.department]?.sections[0] || '');
  const [adminType, setAdminType] = useState(person.adminType || 'student_affairs');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const years = Array.from(
    { length: new Date().getFullYear() - 2000 + 2 },
    (_, index) => new Date().getFullYear() + 1 - index,
  );
  const isStudent = role === 'student';
  const isAdmin = role === 'college_admin';
  const sectionOptions = accountDepartments[department]?.sections || [];

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (!values.password) delete values.password;
    try {
      await api(`/profiles/${encodeURIComponent(person._id)}`, { method: 'PATCH', body: {
        ...values,
        role,
        ...(isAdmin ? { adminType } : { department }),
        ...(isStudent ? { section } : {}),
      } });
      await onSaved();
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="modal-card icts-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-account-title">
      <div className="modal-heading"><div><span className="eyebrow">ICTS ACCOUNT DESK</span><h2 id="edit-account-title">Edit account</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close account editor"><X size={17} /></button></div>
      <form className="modal-form" onSubmit={submit}>
        <div className="form-row">
          <label className="field-label">Full name<input name="name" defaultValue={person.name} maxLength={100} required /></label>
          <label className="field-label">Email / login ID<input name="email" type="email" defaultValue={person.email} required /></label>
        </div>
        <label className="field-label">Account type<select value={role} onChange={(event) => {
          const nextRole = event.target.value;
          setRole(nextRole);
          if (nextRole === 'student' && !accountDepartments[department]) {
            setDepartment('CSE');
            setSection('A');
          } else if (nextRole === 'faculty_coordinator' && !facultyDepartments.includes(department)) {
            setDepartment('ECE');
          }
        }}>
          <option value="student">Student</option><option value="faculty_coordinator">Faculty mentor</option><option value="college_admin">Admin</option>
        </select></label>
        {isAdmin ? <>
          <label className="field-label">Admin type<select value={adminType} onChange={(event) => setAdminType(event.target.value)}>
            <option value="student_affairs">Student Affairs</option><option value="principal">Principal</option><option value="other_authority">Other authority</option>
          </select></label>
          {adminType === 'other_authority' && <label className="field-label">Authority / designation<select name="designation" defaultValue={person.designation || ''} required>
            <option value="" disabled>Select designation</option>{authorityDesignations.map((designation) => <option key={designation} value={designation}>{designation}</option>)}
          </select></label>}
        </> : <>
          <div className="form-row">
            <label className="field-label">Department<select value={department} onChange={(event) => {
              const next = event.target.value;
              setDepartment(next);
              setSection(accountDepartments[next]?.sections[0] || '');
            }} required>
              {isStudent ? Object.keys(accountDepartments).map((code) => <option key={code} value={code}>{code}</option>) : facultyDepartments.map((code) => <option key={code} value={code}>{code}</option>)}
            </select></label>
            <label className="field-label">Year of joining<select name="joiningYear" defaultValue={person.joiningYear || new Date().getFullYear()} required>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select></label>
          </div>
          {isStudent && <label className="field-label">Section<select value={section} onChange={(event) => setSection(event.target.value)} required>
            {sectionOptions.map((code) => <option key={code} value={code}>Section {code}</option>)}
          </select></label>}
        </>}
        <div className="form-row">
          <label className="field-label">Phone number<input name="phone" defaultValue={person.phone || ''} maxLength={20} inputMode="tel" /></label>
          <label className="field-label">New password <span className="muted-copy">(optional)</span><input name="password" type="password" minLength={8} autoComplete="new-password" /><small>Leave blank to keep the current password.</small></label>
        </div>
        <label className="field-label">About<textarea name="bio" defaultValue={person.bio || ''} maxLength={500} rows="3" /></label>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div className="modal-actions"><button className="button button-outline" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save account'}</button></div>
      </form>
    </section>
  </div>;
}

function IctsDashboard({ onLogout, theme, onToggleTheme }) {
  useEffect(() => {
    document.title = 'ICTS account desk | Amrita Sangam';
    document.querySelector('meta[name="description"]')?.setAttribute(
      'content',
      'Create and manage campus accounts and club credentials in Amrita Sangam.',
    );
  }, []);
  const [view, setView] = useState('accounts');
  const [people, setPeople] = useState([]);
  const [credentialClubs, setCredentialClubs] = useState([]);
  const [credentialRequests, setCredentialRequests] = useState([]);
  const [credentialError, setCredentialError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [kind, setKind] = useState('faculty_coordinator');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ type: '', text: '' });
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [adminType, setAdminType] = useState('student_affairs');
  const [department, setDepartment] = useState('CSE');
  const [section, setSection] = useState('A');
  const [deletingId, setDeletingId] = useState('');
  const [editingPerson, setEditingPerson] = useState(null);
  const joiningYears = Array.from(
    { length: new Date().getFullYear() - 2000 + 2 },
    (_, index) => new Date().getFullYear() + 1 - index,
  );
  const departmentSections = accountDepartments[department]?.sections || [];
  const departmentOptions = kind === 'faculty_coordinator' ? facultyDepartments : accountDepartments;

  const load = useCallback(async () => {
    try { setPeople(await api('/profiles')); setLoadError(''); } catch (problem) { setLoadError(problem.message); }
  }, []);
  const loadCredentialDesk = useCallback(async () => {
    try {
      const [clubs, requests] = await Promise.all([
        api('/clubs'),
        api('/club-credential-change-requests'),
      ]);
      setCredentialClubs(clubs.filter((club) => club.organizationType !== 'event_organizer'));
      setCredentialRequests(requests);
      setCredentialError('');
    } catch (problem) {
      setCredentialError(problem.message);
    }
  }, []);
  useEffect(() => { load(); loadCredentialDesk(); }, [load, loadCredentialDesk]);

  const needsDetails = kind !== 'college_admin';
  const kinds = [
    { id: 'college_admin', label: 'Admin', hint: 'Student Affairs, Principal or another authority; multiple accounts are allowed' },
    { id: 'faculty_coordinator', label: 'Faculty', hint: 'Gets a faculty ID like FA23CSE001' },
    { id: 'student', label: 'Student', hint: 'Gets a roll number like BL.SC.U4CSE25204' },
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
        body: {
          ...values,
          role: kind,
          ...(kind === 'college_admin' ? { adminType } : {}),
          ...(needsDetails ? { department } : {}),
          ...(kind === 'student' ? {
            section,
            schoolCode: accountDepartments[department].schoolCode,
          } : {}),
        },
      });
      const id = created.facultyId || created.registerNumber;
      setNotice({ type: 'ok', text: `${created.name}’s login was created in Supabase Auth and their profile in MongoDB.${id ? ` ID: ${id}` : ''}` });
      setFormKey((key) => key + 1);
      setDepartment('CSE');
      setSection('A');
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

  const requestClubCredentials = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    setBusy(true);
    setNotice({ type: '', text: '' });
    try {
      await api('/club-credential-change-requests', { method: 'POST', body: values });
      form.reset();
      setNotice({ type: 'ok', text: 'The club credential change was sent to Student Affairs for approval.' });
      await loadCredentialDesk();
    } catch (problem) {
      setNotice({ type: 'error', text: problem.message });
    } finally {
      setBusy(false);
    }
  };

  const applyClubCredentials = async (change) => {
    setBusy(true);
    setNotice({ type: '', text: '' });
    try {
      await api(`/club-credential-change-requests/${change._id}/apply`, { method: 'PATCH' });
      setNotice({ type: 'ok', text: 'The approved club credentials are active.' });
      await loadCredentialDesk();
    } catch (problem) {
      setNotice({ type: 'error', text: problem.message });
    } finally {
      setBusy(false);
    }
  };

  const visible = people
    .filter((person) => person.role !== 'icts' && (filter === 'all' || person.role === filter))
    .filter((person) => `${person.name} ${person.email} ${person.facultyId || ''} ${person.registerNumber || ''} ${person.designation || ''} ${person.adminType || ''}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="app-shell shell-icts icts-shell">
      <main className="main-panel icts-main">
        <header className="topbar">
          <div className="breadcrumbs"><span>Amrita Sangam</span><span className="crumb-slash">/</span><strong>ICTS</strong></div>
          <div className="topbar-right">
            <button className={`button ${view === 'accounts' ? 'button-primary' : 'button-outline'}`} onClick={() => setView('accounts')}>Accounts</button>
            <button className={`button ${view === 'club-logins' ? 'button-primary' : 'button-outline'}`} onClick={() => setView('club-logins')}><KeyRound size={14} /> Club logins</button>
            <button className={`button ${view === 'password' ? 'button-primary' : 'button-outline'}`} onClick={() => setView('password')}><KeyRound size={14} /> Password</button>
            <span className="role-pill">ICTS</span>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <button className="button button-outline topbar-logout" onClick={onLogout}><LogOut size={15} /> Log out</button>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading"><div><span className="eyebrow">ICTS DEPARTMENT</span><h1>Account desk</h1><p>Create admin, faculty and student logins. Sign-in credentials are stored in Supabase; Amrita Sangam profiles are stored in MongoDB.</p></div></div>
          {loadError && <div className="notice notice-error" role="alert">{loadError}</div>}

          {view === 'password' && <div className="profile-page"><PasswordCard /></div>}

          {view === 'club-logins' && <>
            <section className="surface-card member-surface">
              <SectionHeading title="Request a club login change" subtitle="Student Affairs must approve each email or password update before ICTS can apply it." />
              {credentialError && <div className="notice notice-error" role="alert">{credentialError}</div>}
              <form className="account-create-form" onSubmit={requestClubCredentials}>
                <label className="field-label">Club<select name="clubId" required defaultValue=""><option value="" disabled>Select a club</option>{credentialClubs.map((club) => <option key={club._id} value={club._id}>{club.name}</option>)}</select></label>
                <label className="field-label">New shared login email<input name="clubLoginEmail" type="email" autoComplete="off" /></label>
                <label className="field-label">New shared login password<input name="clubLoginPassword" type="password" minLength={8} maxLength={256} autoComplete="new-password" /><small>For existing logins, leave a field blank to keep its current value. First-time setup requires both email and password. Supabase Auth manages active passwords; pending changes are encrypted until approved and applied.</small></label>
                {notice.text && <div className={`notice notice-${notice.type}`} role="status">{notice.text}</div>}
                <button className="button button-primary" type="submit" disabled={busy}>Send for approval <ArrowRight size={15} /></button>
              </form>
            </section>
            <section className="surface-card member-surface">
              <SectionHeading title="Club login change history" />
              {credentialRequests.map((change) => <article className="application-row" key={change._id}>
                <div className="application-details">
                  <div className="application-title"><strong>{change.clubId?.name || 'Club'}</strong><span className={statusClass(change.status)}>{change.status}</span></div>
                  <small>Requested by {change.requestedBy?.name || change.requestedBy?.email || 'ICTS'} · {change.clubLoginEmail ? `Email: ${change.clubLoginEmail}` : 'Email unchanged'} · {change.passwordChangeRequested ? 'Password change included' : 'Password unchanged'}{change.rejectionFeedback ? ` · Rejected: ${change.rejectionFeedback}` : ''}</small>
                </div>
                {change.status === 'approved' && <button className="button button-primary" type="button" disabled={busy} onClick={() => applyClubCredentials(change)}>Apply approved change</button>}
              </article>)}
              {!credentialRequests.length && !credentialError && <EmptyState title="No pending club login changes" text="ICTS requests awaiting Student Affairs approval will appear here." />}
            </section>
          </>}

          {view === 'accounts' && <>
            <section className="surface-card member-surface">
              <SectionHeading title="Create an account" subtitle="Choose who you are creating the login for." />
              <label className="field-label">Account type
                <select value={kind} onChange={(event) => setKind(event.target.value)}>
                  {kinds.map((option) => <option key={option.id} value={option.id} disabled={option.disabled}>{option.label}</option>)}
                </select>
              </label>
              <small className="muted-copy">{kinds.find((option) => option.id === kind)?.hint}</small>
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
                  {adminType === 'other_authority' && <label className="field-label">Authority / designation
                    <select name="designation" required defaultValue="">
                      <option value="" disabled>Select designation</option>
                      {authorityDesignations.map((designation) => <option key={designation} value={designation}>{designation}</option>)}
                    </select>
                  </label>}
                </>}
                {needsDetails && <>
                  <label className="field-label">Department
                    <select value={department} onChange={(event) => {
                      const nextDepartment = event.target.value;
                      setDepartment(nextDepartment);
                      setSection(accountDepartments[nextDepartment]?.sections[0] || '');
                    }} required>
                      {!department && <option value="" disabled>Select the faculty department</option>}
                      {(Array.isArray(departmentOptions) ? departmentOptions : Object.keys(departmentOptions)).map((code) => (
                        <option key={code} value={code}>{code}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">Year of joining
                    <select name="joiningYear" defaultValue={new Date().getFullYear()} required>
                      {joiningYears.map((year) => <option key={year} value={year}>{year}</option>)}
                    </select>
                  </label>
                </>}
                {kind === 'student' && <>
                  <label className="field-label">Section
                    <select name="section" value={section} onChange={(event) => setSection(event.target.value)} required>
                      {departmentSections.map((code) => <option key={code} value={code}>Section {code}</option>)}
                    </select>
                    <small>The next class roll number is assigned automatically within the selected section.</small>
                  </label>
                  <p className="modal-intro">Student numbers use Bangalore campus (BL) and the four-year undergraduate code (U4).</p>
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
                <span className="member-person"><strong>{person.name}</strong><small><a href={`mailto:${person.email}`}>{person.email}</a></small><small>{person.department ? `${person.department}${person.joiningYear ? ` · joined ${person.joiningYear}` : ''}` : person.designation || roleNames[person.role]}</small>{person.identityType && <small>{person.identityType === 'faculty' ? 'Faculty' : 'Student'}{person.school ? ` · ${person.school}` : ''}</small>}</span>
                <span className="status status-approved">{person.facultyId || person.registerNumber || (person.role === 'college_admin' ? profileTrackLabel(person, 'student-affairs') : roleNames[person.role])}</span>
                <button className="button button-outline button-small" type="button" onClick={() => setEditingPerson(person)} aria-label={`Edit ${person.name}'s account`}><Pencil size={14} /> Edit</button>
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
      <SiteFooter />
      {editingPerson && <IctsEditAccountModal person={editingPerson} onClose={() => setEditingPerson(null)} onSaved={async () => {
        await load();
        setEditingPerson(null);
        setNotice({ type: 'ok', text: 'Account details updated.' });
      }} />}
    </div>
  );
}

function pageDescription(page, role) {
  const descriptions = {
    clubs: 'A little curiosity can lead to a really good thing.',
    events: 'Explore what is happening on campus and register from event details.',
    applications: role === 'student' ? '' : 'Make room for someone new in your community.',
    members: 'Keep the people, roles, and good work connected.',
    chats: 'Stay close to your club community with member-only conversations.',
    equipment: 'Request club equipment with a quantity, time range and reason.',
    reports: 'A thoughtful snapshot of the clubs and work in motion.',
    announcements: 'The latest notes from clubs across your campus.',
    profile: 'Your campus details, contact number, photo and password.',
  };
  return descriptions[page];
}

function SiteFooter() {
  return <footer className="site-footer">
    <span>© {new Date().getFullYear()} Amrita Sangam</span>
    <nav aria-label="Legal information">
      <a href="/privacy-policy">Privacy policy</a>
      <a href="/terms-and-conditions">Terms and conditions</a>
    </nav>
  </footer>;
}

function StatCard({ icon: Icon, label, value, foot, tone }) {
  return <article className={`stat-card tone-${tone}`}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={17} /></span></div><strong>{value.toLocaleString()}</strong><small>{foot}</small></article>;
}

function ReportStat({ label, value, tone }) {
  return <article className={`report-stat tone-${tone}`}><span>{label}</span><strong>{Number(value || 0).toLocaleString()}</strong><i /></article>;
}

function SectionHeading({ title, subtitle, action, onAction }) {
  return <div className="section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <button className="text-link" onClick={onAction}>{action}<ArrowRight size={15} /></button>}</div>;
}

function WorkflowFilter({ value, onChange }) {
  return <label className="workflow-filter">Show
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="all">All statuses</option>
      <option value="pending">Awaiting review</option>
      <option value="approved">Approved</option>
      <option value="rejected">Rejected</option>
    </select>
  </label>;
}

function ReviewHistory({ entries }) {
  if (!entries?.length) return null;
  return <details className="review-history">
    <summary>Decision history ({entries.length})</summary>
    <ol>{entries.map((entry, index) => <li key={`${entry.stage}-${index}`}>
      <strong>{String(entry.status || '').replaceAll('_', ' ')}</strong>
      <span>{entry.stage?.replaceAll('_', ' ')} · {entry.reviewer?.name || 'Former reviewer'} · {formatDate(entry.reviewedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      {entry.feedback && <small>{entry.feedback}</small>}
    </li>)}</ol>
  </details>;
}

function EventRow({ event, index = 0, canReview, needsReview, canResubmit, canEdit, showEdit, editDisabled, onEdit, onDetails, onReview, onResubmit }) {
  const date = event.eventDate ? new Date(event.eventDate) : null;
  const eventDate = date && !Number.isNaN(date.getTime()) ? date : null;
  const count = event.registeredCount || 0;
  return <article className={`event-row ${needsReview ? 'notification-needs-attention' : ''}`}>
    <button className={`event-poster event-poster-${index % 3}`} type="button" onClick={onDetails} aria-label={`View ${event.title} details`}>
      {event.posterUrl
        ? <img src={event.posterUrl} alt={`${event.title} event poster`} />
        : <span className="event-poster-fallback"><CalendarDays size={20} /><small>CAMPUS EVENT</small><strong>{event.title}</strong></span>}
      <span className="event-poster-date">{eventDate ? eventDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Date TBA'}</span>
    </button>
    <div className="event-details"><div className="event-meta"><span>{event.clubId?.name || 'Campus club'}</span><span className={statusClass(event.status)}>{event.status.replaceAll('_', ' ')}</span>{needsReview && <span className="notification-inline-label">NEEDS YOUR REVIEW</span>}</div><h3>{event.title}</h3><p><CalendarDays size={13} /> {formatDate(event.eventDate, { weekday: 'short', month: 'short', day: 'numeric' })}{event.venueId?.name && <> <span>·</span> {event.venueId.name}</>}</p>{event.coHostIds?.length > 0 && <small className="event-cohosts">Co-hosted with {event.coHostIds.map((host) => host.name).join(', ')}</small>}{event.createdBy?.name && <small>Proposed by {event.createdBy.name}</small>}<ReviewHistory entries={reviewHistoryFor(event)} />{event.rejectionFeedback && <small className="rejection-feedback">Feedback: {event.rejectionFeedback}</small>}</div>
    <div className="event-row-action">
      <button className="text-link" type="button" onClick={onDetails}>View details <ArrowRight size={14} /></button>
      {(canEdit || showEdit) && <button className="button button-outline" type="button" disabled={editDisabled} onClick={onEdit} title={editDisabled ? 'Editing is disabled after mentor review has started.' : undefined}>Edit event</button>}
      {canReview && ['mentor_pending', 'student_affairs_pending'].includes(event.status) && <div className="review-actions"><button className="button button-outline" onClick={() => onReview('approved')}>Approve</button><button className="button button-quiet" onClick={() => onReview('rejected')}>Decline</button></div>}
      {canResubmit && ['draft', 'rejected'].includes(event.status) && <button className="button button-outline" onClick={onResubmit}>Submit for approval</button>}
      {typeof event.capacity === 'number' && <small>{count}/{event.capacity} places</small>}
    </div>
  </article>;
}

function EventDetailsDialog({ event, events, registrations, onNavigate, onClose, canRegister, onRegister }) {
  const [confirmation, setConfirmation] = useState('');
  const [pendingEvent, setPendingEvent] = useState(null);
  const [slideDirection, setSlideDirection] = useState(0);
  const transitionTimer = useRef(null);
  const carouselEvents = useMemo(
    () => events.some((item) => item._id === event._id) ? events : [event, ...events],
    [events, event],
  );
  const carouselIndex = carouselEvents.findIndex((item) => item._id === event._id);
  const hasMultipleEvents = carouselEvents.length > 1;

  const confirmAction = async () => {
    if (confirmation === 'register' && !await onRegister(event)) return;
    setConfirmation('');
    onClose();
  };

  const finishNavigation = useCallback((targetEvent) => {
    window.clearTimeout(transitionTimer.current);
    transitionTimer.current = null;
    setPendingEvent(null);
    setSlideDirection(0);
    setConfirmation('');
    onNavigate(targetEvent);
  }, [onNavigate]);

  const moveCarousel = useCallback((direction) => {
    if (carouselEvents.length < 2) return;
    const pendingIndex = pendingEvent
      ? carouselEvents.findIndex((item) => item._id === pendingEvent._id)
      : carouselIndex;
    const currentIndex = pendingIndex >= 0 ? pendingIndex : carouselIndex;
    const nextIndex = (currentIndex + direction + carouselEvents.length) % carouselEvents.length;
    const nextEvent = carouselEvents[nextIndex];
    if (!nextEvent) return;
    if (nextEvent._id === event._id) {
      window.clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
      setPendingEvent(null);
      setSlideDirection(0);
      return;
    }
    setConfirmation('');
    setPendingEvent(nextEvent);
    setSlideDirection(direction);
    window.clearTimeout(transitionTimer.current);
    transitionTimer.current = window.setTimeout(() => finishNavigation(nextEvent), 500);
  }, [carouselEvents, carouselIndex, event._id, finishNavigation, pendingEvent]);

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
          <button className="icon-button" type="button" onClick={() => moveCarousel(-1)} aria-label="Previous event"><ChevronLeft size={18} /></button>
          <span>{slideIndex + 1} / {carouselEvents.length}</span>
          <button className="icon-button" type="button" onClick={() => moveCarousel(1)} aria-label="Next event"><ChevronRight size={18} /></button>
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
        {slideEvent.coHostIds?.length > 0 && <p className="event-cohosts">Co-hosted with {slideEvent.coHostIds.map((host) => host.name).join(', ')}</p>}
        {slideEvent._id === event._id && confirmation && <div className="registration-confirm" role="group" aria-label="Confirm event registration">
          <strong>Do you want to register for this event?</strong>
          <div><button className="button button-primary" type="button" onClick={confirmAction}>Yes</button><button className="button button-outline" type="button" onClick={() => setConfirmation('')}>No</button></div>
        </div>}
        {slideEvent._id === event._id && canRegister && slideEvent.status === 'approved' && !confirmation && (slideRegistered
          ? <span className="registered-event-status" role="status"><Check size={15} /> Registered</span>
          : <button className="button button-primary event-dialog-action" type="button" disabled={full} onClick={() => setConfirmation('register')}>{full ? 'Registration is full' : 'Register'}</button>)}
        {slideEvent._id === event._id && (!canRegister || slideEvent.status !== 'approved') && <button className="button button-primary event-dialog-action" type="button" onClick={onClose}>Back to events</button>}
      </div>
    </div>;
  };

  const pendingIndex = pendingEvent
    ? carouselEvents.findIndex((item) => item._id === pendingEvent._id)
    : -1;
  const firstSlide = slideDirection < 0 ? pendingEvent : event;
  const secondSlide = slideDirection < 0 ? event : pendingEvent;
  const firstIndex = slideDirection < 0 ? pendingIndex : carouselIndex;
  const secondIndex = slideDirection < 0 ? carouselIndex : pendingIndex;

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

function EventReportFields({ initialDetails = {}, images = {}, onImageChange }) {
  const groups = [
    ['promotion', 'Promotion in social media'],
    ['eventCategory', 'Event category'],
    ['programType', 'Program type'],
    ['programTheme', 'Program theme'],
    ['sdgAlignment', 'Event alignment to SDG'],
    ['sessionMode', 'Mode of session delivery'],
    ['resourcePerson', 'Resource person / judge'],
  ];
  return <>
    {groups.map(([field, label]) => (
      <fieldset className="event-cohost-picker report-field-group" key={field}>
        <legend>{label}</legend>
        <div className="event-cohost-group">
          {closureReportOptions[field].map((option) => <label key={option}>
            <input type="checkbox" name={`report_${field}`} value={option} defaultChecked={initialDetails[field]?.selected?.includes(option)} />
            {option}
          </label>)}
        </div>
        <label className="field-label">Remarks / links<textarea name={`report_${field}_remark`} maxLength="3000" rows="2" defaultValue={initialDetails[field]?.remark || ''} placeholder="Add links, details, or remarks" /></label>
      </fieldset>
    ))}
    <fieldset className="event-cohost-picker report-field-group">
      <legend>Number of participants</legend>
      <div className="event-cohost-group">
        {['internal', 'external'].map((kind) => <label key={kind}>
          <input type="checkbox" name="report_participants" value={kind} defaultChecked={initialDetails.participants?.selected?.includes(kind)} />
          {kind === 'internal' ? 'Internal' : 'External'}
        </label>)}
      </div>
      <div className="form-row">
        <label className="field-label">Internal participants<input name="report_internalCount" type="number" min="0" step="1" defaultValue={initialDetails.participants?.internalCount ?? ''} /></label>
        <label className="field-label">External participants<input name="report_externalCount" type="number" min="0" step="1" defaultValue={initialDetails.participants?.externalCount ?? ''} /></label>
      </div>
      <label className="field-label">Remarks<textarea name="report_participants_remark" maxLength="3000" rows="2" defaultValue={initialDetails.participants?.remark || ''} /></label>
    </fieldset>
    <h3 className="report-form-section-title">Activity Completion Report</h3>
    {completionReportFields.map(([field, label, inputType]) => <div className="report-completion-field" key={field}>
      <label className="field-label">{label}
        {inputType === 'textarea'
          ? <textarea name={`report_${field}`} maxLength={field === 'detailedReport' ? 20000 : 5000} rows={field === 'detailedReport' ? 8 : 3} defaultValue={initialDetails.activityCompletion?.[field]?.value || ''} />
          : <input name={`report_${field}`} type={inputType} maxLength={inputType === 'text' ? 500 : undefined} defaultValue={initialDetails.activityCompletion?.[field]?.value || ''} />}
      </label>
      {field === 'detailedReport' && <small className="muted-copy">Maximum 1000 words.</small>}
      <label className="field-label">Remarks<textarea name={`report_${field}_remark`} maxLength="3000" rows="2" defaultValue={initialDetails.activityCompletion?.[field]?.remark || ''} /></label>
    </div>)}
    {reportImageFields.map(([field, label]) => {
      const preview = images[field] || initialDetails.activityCompletion?.[field]?.image || '';
      return <div className="report-completion-field" key={field}>
        <label className="field-label">{label} (image upload)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onImageChange(event, field)} /></label>
        {preview && <div className="media-preview media-preview-poster"><img src={preview} alt={`${label} preview`} /></div>}
        <label className="field-label">Remarks<textarea name={`report_${field}_remark`} maxLength="3000" rows="2" defaultValue={initialDetails.activityCompletion?.[field]?.remark || ''} /></label>
      </div>;
    })}
  </>;
}

function EventReportSummary({ details }) {
  if (!details) return null;
  const attributeGroups = ['promotion', 'eventCategory', 'programType', 'programTheme', 'sdgAlignment', 'sessionMode', 'resourcePerson'];
  const completion = details.activityCompletion || {};
  return <details className="report-detail-view">
    <summary>View completed report details</summary>
    {attributeGroups.map((field) => {
      const section = details[field] || {};
      return <section key={field}>
        <strong>{field.replaceAll(/([A-Z])/g, ' $1')}</strong>
        <p>{section.selected?.join(', ') || 'No options selected'}</p>
        {section.remark && <p><b>Remarks:</b> {section.remark}</p>}
      </section>;
    })}
    <section><strong>Participants</strong>
      <p>Internal: {details.participants?.internalCount || '—'} · External: {details.participants?.externalCount || '—'}</p>
      {details.participants?.remark && <p><b>Remarks:</b> {details.participants.remark}</p>}
    </section>
    {completionReportFields.map(([field, label]) => completion[field]?.value || completion[field]?.remark
      ? <section key={field}><strong>{label}</strong><p>{completion[field].value || '—'}</p>{completion[field].remark && <p><b>Remarks:</b> {completion[field].remark}</p>}</section>
      : null)}
    {reportImageFields.map(([field, label]) => completion[field]?.image || completion[field]?.remark
      ? <section key={field}><strong>{label}</strong>{completion[field].image && <a href={completion[field].image} target="_blank" rel="noreferrer"><img className="report-upload-preview" src={completion[field].image} alt={label} /></a>}{completion[field].remark && <p><b>Remarks:</b> {completion[field].remark}</p>}</section>
      : null)}
  </details>;
}

function BorrowApprovalRow({ borrow, canReview, canEdit, onReview, onUpdate, onError }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const editable = borrow.status === 'mentor_pending' && !mentorReviewStarted(borrow);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    values.quantity = Number(values.quantity);
    values.startDate = new Date(values.startDate).toISOString();
    values.endDate = new Date(values.endDate).toISOString();
    values.dueDate = values.endDate;
    try {
      await onUpdate(values);
      setEditing(false);
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  };
  const requestedStart = borrow.startDate && new Date(borrow.startDate) > new Date()
    ? borrow.startDate
    : new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const requestedEnd = borrow.endDate || borrow.dueDate;
  return <article className="funding-row">
    <div className="funding-symbol"><Laptop size={17} /></div>
    <div className="funding-details"><strong>{borrow.equipmentId?.name || 'Equipment request'} · {borrow.clubId?.name}</strong><span>Quantity: {borrow.quantity || 1}{borrow.eventId?.title ? ` · For ${borrow.eventId.title}` : ''}</span><span>Requested by {borrow.profileId?.name || 'club president'} · {formatDate(requestedStart, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} to {formatDate(requestedEnd, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>{borrow.purpose && <span>Reason: {borrow.purpose}</span>}<ReviewHistory entries={reviewHistoryFor(borrow)} />{borrow.rejectionFeedback && <small className="rejection-feedback">Feedback: {borrow.rejectionFeedback}</small>}</div>
    <div className="funding-actions"><span className={statusClass(borrow.status)}>{borrow.status.replaceAll('_', ' ')}</span>{canEdit && <button className="button button-outline button-small" type="button" disabled={!editable} title={!editable ? 'Editing is disabled after mentor review has started.' : undefined} onClick={() => setEditing(!editing)}>{editing ? 'Cancel edit' : 'Edit request'}</button>}{canReview && <div className="review-actions"><button className="review-accept" onClick={() => onReview('approved')} aria-label="Approve equipment request"><Check size={15} /></button><button className="review-decline" onClick={() => onReview('rejected')} aria-label="Reject equipment request"><X size={15} /></button></div>}</div>
    {editing && editable && <form className="modal-form" onSubmit={save}>
      <label className="field-label">Quantity<input name="quantity" type="number" min="1" max={borrow.equipmentId?.availableQuantity || borrow.quantity || 1} defaultValue={borrow.quantity || 1} required /></label>
      <div className="form-row">
        <label className="field-label">Needed from<input name="startDate" type="datetime-local" min={toDateTimeInput(new Date(Date.now() + 5 * 60 * 1000))} defaultValue={toDateTimeInput(requestedStart)} required /></label>
        <label className="field-label">Needed until<input name="endDate" type="datetime-local" min={toDateTimeInput(requestedStart)} defaultValue={toDateTimeInput(requestedEnd)} required /></label>
      </div>
      <label className="field-label">Reason for request<textarea name="purpose" maxLength="1000" rows="2" defaultValue={borrow.purpose || ''} required /></label>
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
    </form>}
  </article>;
}

function ReportRow({ report, canResubmit, canEdit, canReview, onReview, onDownload, onResubmit, onError }) {
  const [editing, setEditing] = useState(false);
  const [images, setImages] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canEditBeforeReview = report.status === 'mentor_pending' && !mentorReviewStarted(report);
  const submitRevision = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const formData = new FormData(event.currentTarget);
    const values = report.reportDetails
      ? { reportDetails: buildReportDetails(formData, images, report.reportDetails) }
      : Object.fromEntries(formData.entries());
    if (!report.reportDetails) values.budgetSpent = Number(values.budgetSpent || report.budgetSpent || 0);
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
  const pickImage = async (event, field) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const image = await resizeImage(file, 1400, 'image/jpeg', false);
      setImages((current) => ({ ...current, [field]: image }));
      setError('');
    } catch (imageError) {
      setError(imageError.message);
    }
  };

  return <article className={`report-review-card ${canReview ? 'notification-needs-attention' : ''}`}>
    <div className="application-title"><strong>{report.eventId?.title || 'Campus event'} · {report.clubId?.name}</strong><span className={statusClass(report.status)}>{report.status.replaceAll('_', ' ')}</span>{canReview && <span className="notification-inline-label">NEEDS YOUR REVIEW</span>}</div>
    <small>Submitted by {report.submittedBy?.name || 'club representative'}</small>
    <p>{report.summary}</p><p><strong>Activities:</strong> {report.activities}</p><p><strong>Outcomes:</strong> {report.outcomes}</p>
    {report.issues && <p><strong>Issues / learnings:</strong> {report.issues}</p>}
    <EventReportSummary details={report.reportDetails} />
    <small>{report.attendeeCount} attendees · {formatMoney(report.budgetSpent)} spent</small>
    <ReviewHistory entries={reviewHistoryFor(report)} />
    {report.rejectionFeedback && <p className="rejection-feedback">Feedback: {report.rejectionFeedback}</p>}
    <div className="review-actions">
      <button className="button button-outline button-small" onClick={onDownload}><Download size={14} /> Download OD roster</button>
      {canReview && <><button className="button button-outline button-small" onClick={() => onReview('approved')}>Approve</button><button className="button button-quiet button-small" onClick={() => onReview('rejected')}>Reject</button></>}
      {canEdit && <button className="button button-outline button-small" disabled={!canEditBeforeReview} title={!canEditBeforeReview ? 'Editing is disabled after mentor review has started.' : undefined} onClick={() => setEditing(!editing)}>{editing ? 'Close edit' : 'Edit report'}</button>}
      {canResubmit && report.status === 'rejected' && <button className="button button-outline button-small" onClick={() => setEditing(!editing)}>{editing ? 'Close edit' : 'Revise & resubmit'}</button>}
    </div>
    {editing && (canEditBeforeReview || (canResubmit && report.status === 'rejected')) && <form className="modal-form report-edit-form" onSubmit={submitRevision}>
      {report.reportDetails
        ? <EventReportFields initialDetails={report.reportDetails} images={images} onImageChange={pickImage} />
        : <>
          <label className="field-label">Summary<textarea name="summary" defaultValue={report.summary} required maxLength={5000} rows="2" /></label>
          <label className="field-label">Activities<textarea name="activities" defaultValue={report.activities} required maxLength={5000} rows="2" /></label>
          <label className="field-label">Outcomes<textarea name="outcomes" defaultValue={report.outcomes} required maxLength={5000} rows="2" /></label>
          <label className="field-label">Issues / learnings<textarea name="issues" defaultValue={report.issues} maxLength={3000} rows="2" /></label>
          <label className="field-label">Amount spent (INR)<input name="budgetSpent" type="number" min="0" step="1" defaultValue={report.budgetSpent || 0} /></label>
        </>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Resubmitting…' : 'Send revised report'} <ArrowRight size={15} /></button>
    </form>}
  </article>;
}

function ClubCard({ club, index, application, isMember, onApply, isAdmin, canApply, onEdit, onDetails }) {
  const colors = ['club-lilac', 'club-peach', 'club-mint', 'club-blue'];
  const icon = [Compass, Laptop, Users][index % 3];
  const Icon = icon;
  const openDetails = (event) => {
    if (event.target.closest('button, a, input, select, textarea')) return;
    onDetails();
  };
  return <article className="club-card club-card-interactive" onClick={openDetails}
    onKeyDown={(event) => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
        event.preventDefault();
        onDetails();
      }
    }} tabIndex="0" aria-label={`View ${club.name} club details`}>
    <div className={`club-art ${colors[index % colors.length]}`}>
      {club.logoUrl
        ? <img className="club-logo" src={club.logoUrl} alt={`${club.name} logo`} />
        : <><span className="club-art-orbit" /><span className="club-icon"><Icon size={22} /></span><span className="club-art-number">0{index + 1}</span></>}
    </div>
    <div className="club-card-body"><div className="club-category">{club.category || 'Campus community'}</div><h2>{club.name}</h2><p>{club.description || 'Club information has not been added yet.'}</p>
      <span className="club-coordinator">{club.clubType === 'technical' ? 'Technical club' : 'Non-technical club'}{club.mentors?.length ? ` · Mentors: ${club.mentors.map((mentor) => mentor.name).join(', ')}` : club.mentorDirectory?.length ? ` · Mentors: ${club.mentorDirectory.map((mentor) => mentor.name).join(', ')}` : ''}</span>
      {isAdmin ? <button className="text-link club-join" onClick={onEdit}>Edit club details <ArrowRight size={15} /></button> :
        isMember ? <span className="club-applied status status-approved">You’re a member</span> :
          application?.status === 'pending' ? <span className={`club-applied ${statusClass(application.status)}`}>Application pending</span> :
                canApply && club.recruitmentOpen ? <button className="text-link club-join" onClick={onApply}>{application?.status === 'rejected' ? 'Apply again' : application?.status === 'approved' ? 'Join again' : 'I’m interested'} <ArrowRight size={15} /></button>
                : !canApply ? <span className="club-manager-note">{club.recruitmentOpen ? 'Club details · membership applications are for students' : 'Recruitment is currently closed.'}</span>
                  : <span className="club-manager-note">Recruitment is currently closed.</span>}
    </div>
  </article>;
}

function ClubDetailsDialog({ club, onClose, onApply, canApply, isMember, application }) {
  const mentors = club.mentors?.length ? club.mentors : club.mentorDirectory || [];
  const motto = club.motto || club.tagline || club.mission;
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  return <div className="event-dialog-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="club-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="club-detail-title">
      <button className="icon-button club-detail-close" type="button" onClick={onClose} aria-label="Close club details"><X size={18} /></button>
      <div className="club-detail-insignia">
        {club.logoUrl ? <img src={club.logoUrl} alt={`${club.name} insignia`} /> : <Compass size={46} aria-hidden="true" />}
      </div>
      <div className="club-detail-content">
        <span className="eyebrow">{club.category || 'Campus community'}</span>
        <h2 id="club-detail-title">{club.name}</h2>
        {motto && <p className="club-detail-motto">{motto}</p>}
        <p>{club.description || 'Club information has not been added yet.'}</p>
        <dl>
          <div><dt>Type</dt><dd>{club.clubType === 'technical' ? 'Technical club' : 'Non-technical club'}</dd></div>
          <div><dt>Mentor{mentors.length === 1 ? '' : 's'}</dt><dd>{mentors.length ? mentors.map((mentor) => mentor.name).join(', ') : 'Not listed'}</dd></div>
          {club.domains?.length > 0 && <div><dt>Areas</dt><dd>{club.domains.join(', ')}</dd></div>}
        </dl>
        {canApply && club.recruitmentOpen && !isMember && application?.status !== 'pending' && (
          <button className="button button-primary" type="button" onClick={onApply}>
            {application?.status === 'rejected' ? 'Apply again' : 'Apply to join'}
          </button>
        )}
        {isMember && <span className="status status-approved">You’re a member</span>}
        {application?.status === 'pending' && <span className="status status-pending">Application pending</span>}
        {!club.recruitmentOpen && <span className="club-manager-note">Recruitment is currently closed.</span>}
      </div>
    </section>
  </div>;
}

function ApplicationRow({ application, isOwn, canReview, onReview }) {
  return <article className={`application-row ${canReview && application.status === 'pending' ? 'notification-needs-attention' : ''}`}>  <div className="application-avatar">{initials(application.profileId?.name)}</div><div className="application-details"><div className="application-title"><strong>{application.clubId?.name || 'Club application'}</strong><span className={statusClass(application.status)}>{application.status}</span>{canReview && application.status === 'pending' && <span className="notification-inline-label">NEW APPLICATION</span>}</div><p>{isOwn ? 'Your application' : <>{application.profileId?.name || 'A student'}{application.profileId?.email && <> · <a href={`mailto:${application.profileId.email}`}>{application.profileId.email}</a></>}</>}</p><small>Applying for: {application.requestedPosition === 'executive' ? 'Executive consideration' : 'Club membership'}</small>
    <details className="applicant-details" open={canReview && application.status === 'pending'}><summary>Applicant details</summary><dl>
      <div><dt>Name</dt><dd>{application.profileId?.name || 'Not provided'}</dd></div>
      <div><dt>Roll number</dt><dd>{application.profileId?.registerNumber || 'Not provided'}</dd></div>
      <div><dt>Department</dt><dd>{application.profileId?.department || 'Not provided'}</dd></div>
      <div><dt>Year of study</dt><dd>{application.yearOfStudy || 'Not provided'}</dd></div>
      <div><dt>Phone</dt><dd>{(application.applicantPhone || application.profileId?.phone) ? <a href={`tel:${application.applicantPhone || application.profileId?.phone}`}>{application.applicantPhone || application.profileId?.phone}</a> : 'Not provided'}</dd></div>
      <div><dt>Domain</dt><dd>{application.domain || 'General'}</dd></div>
      <div className="applicant-reason"><dt>Reason for joining</dt><dd>{application.reason || 'Not provided'}</dd></div>
    </dl></details>
    <ReviewHistory entries={reviewHistoryFor(application)} />{application.rejectionFeedback && <small className="rejection-feedback">Feedback: {application.rejectionFeedback}</small>}<time>{formatDate(application.appliedDate)}</time></div>
    {canReview && application.status === 'pending' && <div className="review-actions"><button className="review-accept" onClick={() => onReview('approved')} aria-label="Approve application"><Check size={16} /></button><button className="review-decline" onClick={() => onReview('rejected')} aria-label="Decline application"><X size={16} /></button></div>}
  </article>;
}

function PositionInvitation({ membership, onRespond }) {
  const club = membership.clubId?.name || 'a campus club';
  const title = membership.position.replaceAll('_', ' ');
  return <article className="application-row position-invitation notification-needs-attention">
    <div className="application-avatar"><ShieldCheck size={16} /></div>
    <div className="application-details">
      <div className="application-title"><strong>Office-bearer invitation · {club}</strong><span className={statusClass('pending')}>awaiting your response</span><span className="notification-inline-label">RESPONSE NEEDED</span></div>
      <p>You have been nominated as {title}. Accept to activate this club role.</p>
    </div>
    <div className="review-actions"><button className="review-accept" onClick={() => onRespond('accepted')} aria-label="Accept office-bearer invitation"><Check size={16} /></button><button className="review-decline" onClick={() => onRespond('declined')} aria-label="Decline office-bearer invitation"><X size={16} /></button></div>
  </article>;
}

function MemberRow({ member, canEdit, canRemove, onRemove, onRoleChange }) {
  const [officeBearerGroup, setOfficeBearerGroup] = useState(member.officeBearerGroup);
  const isEnded = member.membershipStatus === 'ended';
  const isOfficeBearer = ['office_bearer', 'president', 'vice_president', 'treasurer', 'secretary'].includes(member.position)
    || (member.position === 'executive' && member.officeBearerGroup);
  useEffect(() => { setOfficeBearerGroup(member.officeBearerGroup); }, [member.officeBearerGroup]);
  return <article className="member-row">
    <span className="application-avatar">{initials(member.profileId?.name)}</span>
    <span className="member-person"><strong>{member.profileId?.name || 'Campus member'}</strong><small>{member.profileId?.email && <a href={`mailto:${member.profileId.email}`}>{member.profileId.email}</a>}</small></span>
    <span className="member-date">{isEnded ? `Ended ${formatDate(member.endedAt, { month: 'short', day: 'numeric', year: 'numeric' })}` : `Joined ${formatDate(member.joinedDate, { month: 'short', day: 'numeric', year: 'numeric' })}`}</span>
    {isEnded && <span className={statusClass('ended')}>Membership ended</span>}
    {member.membershipStatus === 'pending' && <span className={statusClass('pending')}>Invitation pending</span>}
    <select aria-label={`Position for ${member.profileId?.name || 'member'}`} value={member.position} disabled={!canEdit} onChange={(event) => onRoleChange(event.target.value, false)}>
      <option value="member">Member</option><option value="executive">Executive</option>
      {isOfficeBearer && <><option value="office_bearer">Office bearer</option><option value="president">President</option><option value="vice_president">Vice president</option><option value="treasurer">Treasurer</option><option value="secretary">Secretary</option></>}
    </select>
    {member.position === 'executive' && isOfficeBearer && <label className="member-ob-toggle"><input type="checkbox" checked={Boolean(officeBearerGroup)} disabled={!canEdit} onChange={(event) => {
      setOfficeBearerGroup(event.target.checked);
      onRoleChange(member.position, event.target.checked);
    }} /> OB</label>}
    {isEnded && <small className="member-end-note">Ended by {member.endedBy?.name || 'club leadership'}</small>}
    {canRemove && !isEnded && <button className="button button-quiet button-small member-remove" type="button" onClick={onRemove}>Remove</button>}
  </article>;
}

function ParticipationRow({ record }) {
  return <article className="participation-row"><span className="participation-mark"><Check size={15} /></span><div><strong>{record.eventId?.title || 'Campus event'}</strong><small>{record.eventId?.clubId?.name || 'Campus community'} · {formatDate(record.eventId?.eventDate)}</small></div><span className={statusClass(record.status)}>{record.status}</span></article>;
}

function EquipmentCard({ equipment, index, isPresident, activeBorrow, onBorrow, onReturn }) {
  return <article className="surface-card equipment-card"><div className={`equipment-art equipment-art-${index % 3}`}><Laptop size={25} /><span className="equipment-condition">{equipment.condition || 'good'} condition</span></div><div className="equipment-card-body"><span className="club-category">{equipment.clubId?.name || 'Club equipment'}</span><h2>{equipment.name}</h2><p>{equipment.description || 'Shared by your campus community.'}</p><div className="equipment-card-bottom"><span className={equipment.availableQuantity ? 'availability' : 'unavailable'}><i />{equipment.availableQuantity} of {equipment.totalQuantity} available</span>{activeBorrow && ['borrowed', 'overdue'].includes(activeBorrow.status) && <button className="button button-outline button-small" onClick={onReturn}>Return item</button>}{isPresident && (!activeBorrow || ['returned', 'rejected'].includes(activeBorrow.status)) && <button className="button button-outline button-small" disabled={!equipment.availableQuantity} onClick={onBorrow}>Request equipment</button>}</div></div></article>;
}

function FundingRowDisplay({ request, canReview, onReview }) {
  return <article className={`funding-row ${canReview ? 'notification-needs-attention' : ''}`}><div className="funding-details"><strong>{request.clubId?.name || 'Club funding'}</strong>{request.eventId?.title && <span>For {request.eventId.title}</span>}<small>Applied {formatDate(request.requestDate)}{request.createdBy?.name ? ` · Requested by ${request.createdBy.name}` : ''}</small><span>{request.purpose}</span>{canReview && <small className="notification-inline-label">NEEDS YOUR REVIEW</small>}<ReviewHistory entries={reviewHistoryFor(request)} />{request.rejectionFeedback && <small className="rejection-feedback">Feedback: {request.rejectionFeedback}</small>}</div><div className="funding-actions"><strong>{formatMoney(request.requestedAmount)}</strong><span className={statusClass(request.status)}>{String(request.status).replaceAll('_', ' ')}</span>{canReview && <div className="review-actions"><button className="review-accept" onClick={() => onReview('approved')} aria-label={request.status === 'student_affairs_pending' ? 'Approve funding request as Student Affairs' : 'Approve funding request as mentor'}><Check size={15} /></button><button className="review-decline" onClick={() => onReview('rejected')} aria-label="Decline funding request"><X size={15} /></button></div>}</div></article>;
}

function FundingRow({ request, canReview, canEdit, onReview, onUpdate, onError }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const editable = request.status === 'mentor_pending' && !mentorReviewStarted(request);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await onUpdate({
        requestedAmount: Number(form.get('requestedAmount')),
        purpose: form.get('purpose'),
      });
      setEditing(false);
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  };
  return <>
    <FundingRowDisplay request={request} canReview={canReview} onReview={onReview} />
    {canEdit && <div className="funding-actions">
      <button className="button button-outline button-small" type="button" disabled={!editable}
        title={!editable ? 'Editing is disabled after mentor review has started.' : undefined}
        onClick={() => setEditing(!editing)}>{editing ? 'Cancel edit' : 'Edit request'}</button>
    </div>}
    {editing && editable && <form className="modal-form" onSubmit={save}>
      <label className="field-label">Amount requested (INR)<input name="requestedAmount" type="number" min="1" step="1" defaultValue={request.requestedAmount} required /></label>
      <label className="field-label">Purpose<textarea name="purpose" maxLength="2000" rows="2" defaultValue={request.purpose} required /></label>
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
    </form>}
  </>;
}

function SpendingChart({ transactions }) {
  const spending = transactions
    .filter((transaction) => transaction.type === 'debit')
    .reduce((totals, transaction) => {
      const clubName = transaction.clubId?.name || 'Club';
      const description = transaction.description || 'Other spending';
      const key = `${clubName}::${description}`;
      const current = totals.get(key) || { clubName, description, amount: 0 };
      current.amount += Number(transaction.amount) || 0;
      totals.set(key, current);
      return totals;
    }, new Map());
  const rows = [...spending.values()].sort((first, second) => second.amount - first.amount).slice(0, 6);
  const maximum = rows[0]?.amount || 0;

  return <section className="spending-chart" aria-label="Recorded club spending">
    <SectionHeading title="Where funds are spent" subtitle="Recorded expenses by club and purpose." />
    {rows.length ? rows.map((row) => (
      <div className="spending-chart-row" key={`${row.clubName}::${row.description}`}>
        <div className="spending-chart-label"><span><strong>{row.description}</strong><small>{row.clubName}</small></span><b>{formatMoney(row.amount)}</b></div>
        <div className="spending-chart-track"><i style={{ width: `${Math.max(row.amount / maximum * 100, 2)}%` }} /></div>
      </div>
    )) : <p className="spending-chart-empty">No expenses have been recorded yet.</p>}
  </section>;
}

function AnnouncementRow({ note }) {
  return <article className="announcement-row"><span className={`announcement-dot ${note.priority === 'high' ? 'announcement-dot-warm' : ''}`} /><div><strong>{note.title}</strong><p>{note.clubId?.name || 'Campus community'} <span>·</span> {formatDate(note.postedDate, { month: 'short', day: 'numeric' })}</p></div></article>;
}

function EmptyState({ title, text }) {
  return <div className="empty-state"><strong>{title}</strong><p>{text}</p></div>;
}

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const staticPage = path === '/privacy-policy' ? 'privacy'
    : path === '/terms-and-conditions' ? 'terms'
      : path === '/' ? '' : 'notFound';
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

  useEffect(() => {
    const metadata = {
      privacy: {
        title: 'Privacy policy | Amrita Sangam',
        description: 'Learn what account and campus activity data Amrita Sangam uses and how access is managed.',
      },
      terms: {
        title: 'Terms and conditions | Amrita Sangam',
        description: 'Read the terms for using the Amrita Sangam campus clubs and events portal.',
      },
      notFound: {
        title: 'Page not found | Amrita Sangam',
        description: 'The page you requested could not be found.',
      },
    }[staticPage];
    if (!metadata) return;
    document.title = metadata.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', metadata.description);
  }, [staticPage]);

  const toggleTheme = () => setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark');

  useEffect(() => {
    if (staticPage) return undefined;
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
  }, [staticPage]);

  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) { setProfile(null); return undefined; }
    let active = true;
    api('/profiles/me').then((currentProfile) => {
      if (active) setProfile(currentProfile);
    }).catch((error) => {
      if (!active) return;
      if (error.status === 401) {
        setSession(null);
        setProfile(null);
        setProfileError('');
        return;
      }
      setProfileError(error.message);
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

  if (staticPage) return <PublicPage page={staticPage} />;
  if (session === undefined) return <div className="app-loading"><span className="loading-orbit" /><p>Getting your campus ready…</p></div>;
  if (profileError) {
    return <div className="profile-error"><div className="config-card"><span className="eyebrow">A CONNECTION ISSUE</span><h1>One more moment.</h1><p>{profileError}</p><button className="button button-primary" onClick={() => window.location.reload()}>Try again <ArrowRight size={16} /></button><button className="text-link" onClick={logout}>Sign out</button></div><SiteFooter /></div>;
  }
  if (!session) return <AuthScreen onAuthenticated={setSession} theme={theme} onToggleTheme={toggleTheme} />;
  if (!profile) return <div className="app-loading"><span className="loading-orbit" /><p>Setting up your space…</p></div>;
  if (profile.role === 'icts') return <IctsDashboard onLogout={logout} theme={theme} onToggleTheme={toggleTheme} />;
  return <Dashboard profile={profile} onLogout={logout} onProfileUpdate={setProfile} theme={theme} onToggleTheme={toggleTheme} />;
}

function PublicPage({ page }) {
  if (page === 'notFound') {
    return <main className="public-page"><section className="public-page-card">
      <span className="eyebrow">404 · PAGE NOT FOUND</span>
      <h1>This page isn’t here.</h1>
      <p>The link may be outdated, or the address may have been typed incorrectly.</p>
      <a className="button button-primary" href="/">Return to Amrita Sangam</a>
    </section><SiteFooter /></main>;
  }

  const isPrivacy = page === 'privacy';
  return <main className="public-page">
    <article className="public-page-card">
      <a className="public-page-brand" href="/">Amrita Sangam</a>
      <span className="eyebrow">CAMPUS COMMUNITY</span>
      <h1>{isPrivacy ? 'Privacy policy' : 'Terms and conditions'}</h1>
      {isPrivacy ? <>
        <p>This policy describes the information used by Amrita Sangam, a campus portal for club membership, events, announcements and related services.</p>
        <h2>Information used by the portal</h2>
        <p>Depending on your account and activity, the portal processes your name, institutional email, student or faculty identifiers, department, profile details, club applications, memberships, event registrations, attendance, messages, equipment requests and funding records. Information you submit is used to provide the corresponding campus service.</p>
        <h2>Storage and access</h2>
        <p>Authentication is provided through Supabase. Campus profiles and portal records are stored in the campus database. Access to records is restricted by account role so that students, club representatives, mentors and administrators can use only the information needed for their responsibilities.</p>
        <h2>Shared club accounts</h2>
        <p>Club accounts are shared credentials. Activity performed through a shared account is associated with that account and may not identify the individual person who used it. Do not use another person’s credentials.</p>
        <h2>Questions and corrections</h2>
        <p>For help with account information or this policy, contact the institution’s ICTS support team through its established support channel.</p>
      </> : <>
        <p>By signing in to Amrita Sangam, you agree to use the portal for legitimate campus club and event activities and to follow applicable institution policies.</p>
        <h2>Account responsibilities</h2>
        <p>Keep your sign-in details secure, provide accurate information and use only accounts assigned to you. Shared club credentials should be used only by authorized club representatives.</p>
        <h2>Campus services</h2>
        <p>Club memberships, event proposals, equipment requests and funding requests may require review or approval. Submitting a request does not guarantee approval or availability. Event registrations are final and cannot be cancelled through the portal.</p>
        <h2>Acceptable use</h2>
        <p>Do not use the portal to disrupt services, access information without permission, impersonate another person or submit unlawful, misleading or harmful content. The institution may restrict access when needed to protect accounts, records or campus services.</p>
        <h2>Changes to these terms</h2>
        <p>These terms may be updated when campus services or institutional requirements change. Continued use after an update means you accept the revised terms.</p>
      </>}
      <a className="public-page-back" href="/">Back to Amrita Sangam</a>
    </article><SiteFooter />
  </main>;
}
