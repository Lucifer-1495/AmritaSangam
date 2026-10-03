const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const Profile = require('./models/profile');
const Club = require('./models/Club');
const Event = require('./models/Event');
const Venue = require('./models/Venue');
const EventRegistration = require('./models/EventRegistration');
const ClubMember = require('./models/ClubMember');
const Attendance = require('./models/Attendance');
const Equipment = require('./models/Equipment');
const EquipmentBorrow = require('./models/EquipmentBorrow');
const ClubBudget = require('./models/ClubBudget');
const FundingRequest = require('./models/FundingRequest');
const BudgetTransaction = require('./models/BudgetTransaction');
const MembershipApplication = require('./models/MembershipApplication');
const Announcement = require('./models/Announcement');
const EventReport = require('./models/EventReport');
const ClubMessage = require('./models/ClubMessage');
const Counter = require('./models/Counter');
const https = require('https');
const { loadTlsOptions } = require('./tls');

const app = express();
const PORT = Number(process.env.PORT) || 5000;
// The single ICTS account (created in Supabase Auth by you). ICTS creates every other account.
const ICTS_EMAIL = (process.env.ICTS_EMAIL || process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
const roles = {
  student: 'student',
  committee: 'club_committee',
  faculty: 'faculty_coordinator',
  admin: 'college_admin',
  icts: 'icts',
};

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
}));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '1mb' }));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === '');
  if (missing.length) throw new HttpError(400, `Required fields: ${missing.join(', ')}`);
}

function requireRejectionFeedback(body) {
  if (typeof body.rejectionFeedback !== 'string' || !body.rejectionFeedback.trim()) {
    throw new HttpError(400, 'Provide a reason when rejecting a request.');
  }
}

// New-style secret keys (sb_secret_...) are not JWTs: send them only in the apikey header.
// Legacy service_role keys are JWTs and are also accepted as a Bearer token.
function serviceHeaders(serviceRoleKey, extra = {}) {
  const headers = { apikey: serviceRoleKey, ...extra };
  if (serviceRoleKey.startsWith('eyJ')) headers.Authorization = `Bearer ${serviceRoleKey}`;
  return headers;
}

async function createSupabaseUser({ email, password, name }) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new HttpError(503, 'Account provisioning is not configured. Add SUPABASE_SERVICE_ROLE_KEY to server/.env.');
  }

  let response;
  try {
    response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users`, {
      method: 'POST',
      headers: serviceHeaders(serviceRoleKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      }),
    });
  } catch (error) {
    throw new HttpError(502, `Could not reach Supabase Auth (${error.name}).`);
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status === 422 || response.status === 409 ? 409 : 400;
    throw new HttpError(status, result.msg || result.message || result.error_description || 'Supabase could not create this account.');
  }
  if (!result.id || !result.email) throw new HttpError(502, 'Supabase created no valid user identity.');
  return result;
}

async function deleteSupabaseUser(userId) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new HttpError(503, 'Account deletion is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env.');
  }
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: serviceHeaders(serviceRoleKey),
  });
  if (response.status === 404) return;
  if (!response.ok) throw new HttpError(502, `Supabase could not delete this login (status ${response.status}).`);
}

function parseCsvRow(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function removeCsvRowsForEmail(csv, email) {
  const rows = String(csv || '').split(/\r?\n/).filter(Boolean).map(parseCsvRow);
  if (!rows.length) return { csv: '', removed: 0 };
  const emailColumn = rows[0].findIndex((heading) => heading.toLowerCase() === 'email');
  if (emailColumn < 0) return { csv, removed: 0 };
  const keptRows = [rows[0]];
  let removed = 0;
  for (const row of rows.slice(1)) {
    if ((row[emailColumn] || '').toLowerCase() === email.toLowerCase()) {
      removed += 1;
    } else {
      keptRows.push(row);
    }
  }
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  return {
    csv: keptRows.map((row) => row.map(quote).join(',')).join('\r\n'),
    removed,
  };
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.profile.role)) {
      return next(new HttpError(403, 'You do not have permission to perform this action.'));
    }
    return next();
  };
}

async function authenticate(req, res, next) {
  try {
    const authorization = req.get('authorization');
    const token = authorization && authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!token) throw new HttpError(401, 'Sign in to continue.');
    if (!supabaseUrl || !supabaseKey) {
      throw new HttpError(503, 'Supabase authentication is not configured on the server.');
    }

    const authResponse = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` },
    });
    if (!authResponse.ok) throw new HttpError(401, 'Your session is invalid or has expired.');

    req.authUser = await authResponse.json();
    if (!req.authUser.id || !req.authUser.email) throw new HttpError(401, 'The session has no valid user.');
    return next();
  } catch (error) {
    return next(error);
  }
}

async function currentProfile(req, res, next) {
  try {
    const email = req.authUser.email.toLowerCase();
    const isIcts = Boolean(ICTS_EMAIL && email === ICTS_EMAIL);
    const name = req.authUser.user_metadata?.full_name
      || req.authUser.user_metadata?.name
      || email.split('@')[0];
    if (isIcts && !(await Profile.exists({ supabaseId: req.authUser.id }))) {
      // The ICTS login was (re)created in Supabase: reattach any older profile that uses this email.
      await Profile.updateOne(
        { email },
        { $set: { supabaseId: req.authUser.id, role: roles.icts } },
        { overwriteImmutable: true },
      );
    }
    req.profile = await Profile.findOneAndUpdate(
      { supabaseId: req.authUser.id },
      { $setOnInsert: { name, email, role: roles.icts } },
      { new: true, upsert: isIcts, runValidators: true, setDefaultsOnInsert: true },
    );
    if (!req.profile) {
      throw new HttpError(403, 'This account has not been issued by ICTS. Ask ICTS to create your CampusSphere account.');
    }
    if (isIcts && req.profile.role !== roles.icts) {
      req.profile.role = roles.icts;
      await req.profile.save();
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

const authenticated = [authenticate, currentProfile];
const isAdmin = roles.admin;
const isFacultyOrAdmin = [roles.faculty, roles.admin];

async function canManageClub(clubId, profile) {
  const club = await Club.findById(clubId);
  if (!club) throw new HttpError(404, 'Club not found.');
  if (profile.role === roles.admin) return true;
  if (String(club.mentor) === String(profile._id)) return true;
  return Boolean(await ClubMember.exists({
    clubId,
    profileId: profile._id,
    membershipStatus: 'active',
    position: { $in: ['executive', 'office_bearer', 'president', 'vice_president', 'treasurer', 'secretary'] },
  }));
}

const officeBearerPositions = ['office_bearer', 'president', 'vice_president', 'treasurer', 'secretary'];

async function getClubPosition(clubId, profileId) {
  return ClubMember.findOne({ clubId, profileId, membershipStatus: 'active' });
}

async function requireClubPosition(clubId, profile, positions) {
  if (profile.role === roles.admin) return null;
  const membership = await getClubPosition(clubId, profile._id);
  if (!membership) throw new HttpError(403, 'You must be a member of this club.');
  const matchesNamedPosition = positions.includes(membership.position);
  const matchesCustomOfficeBearer = positions.includes('office_bearer')
    && membership.officeBearerGroup
    && membership.position === 'executive';
  if (!matchesNamedPosition && !matchesCustomOfficeBearer) {
    throw new HttpError(403, `This action requires a club ${positions.join(' or ')} role.`);
  }
  return membership;
}

async function canReviewMemberships(clubId, profile) {
  if (profile.role === roles.admin) return true;
  const club = await Club.findById(clubId, 'mentor').lean();
  if (profile.role === roles.faculty && String(club?.mentor || '') === String(profile._id)) return true;
  const membership = await getClubPosition(clubId, profile._id);
  return Boolean(membership && (
    officeBearerPositions.includes(membership.position)
    || (membership.position === 'executive' && membership.officeBearerGroup)
  ));
}

async function clubMentorIds(clubIds) {
  const clubs = await Club.find({ _id: { $in: clubIds }, mentor: { $exists: true } }, 'mentor').lean();
  return clubs.map((club) => club.mentor);
}

async function visibleClubIds(profile, positions = null) {
  const membershipFilter = { profileId: profile._id, membershipStatus: 'active' };
  if (positions) {
    membershipFilter.$or = [
      { position: { $in: positions } },
      ...(positions.includes('office_bearer')
        ? [{ position: 'executive', officeBearerGroup: true }]
        : []),
    ];
  }
  const memberships = await ClubMember.find(membershipFilter, 'clubId').lean();
  const ids = memberships.map((membership) => membership.clubId);
  if (profile.role === roles.admin) return (await Club.find({}, '_id').lean()).map((club) => club._id);
  if (profile.role === roles.faculty) {
    const mentored = await Club.find({ mentor: profile._id }, '_id').lean();
    ids.push(...mentored.map((club) => club._id));
  }
  return [...new Map(ids.map((id) => [String(id), id])).values()];
}

async function buildAttendanceRoster(eventId, title) {
  const attendance = await Attendance.find({ eventId, status: 'present' })
    .populate('profileId', 'name email')
    .sort({ checkInTime: 1 })
    .lean();
  const attendees = attendance.filter((item) => item.profileId);
  const quoteCsv = (value) => `"${String(value || '').replaceAll('"', '""')}"`;
  const rosterCsv = [
    ['Name', 'Email', 'Attendance status', 'Checked in at'],
    ...attendees.map((item) => [
      item.profileId.name,
      item.profileId.email,
      item.status,
      item.checkInTime ? new Date(item.checkInTime).toISOString() : '',
    ]),
  ].map((row) => row.map(quoteCsv).join(',')).join('\r\n');
  return {
    attendeeCount: attendees.length,
    attendeeIds: attendees.map((item) => item.profileId._id),
    rosterFileName: `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-od-attendance.csv`,
    rosterCsv,
  };
}

async function requireClubManager(req, res, next) {
  try {
    if (!req.params.clubId && !req.body.clubId) {
      throw new HttpError(400, 'A clubId is required.');
    }
    const allowed = await canManageClub(req.params.clubId || req.body.clubId, req.profile);
    if (!allowed) throw new HttpError(403, 'Only this club’s committee, assigned faculty, or an admin can do that.');
    return next();
  } catch (error) {
    return next(error);
  }
}

app.get('/api/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'database_unavailable',
    database: connected ? 'connected' : 'disconnected',
  });
});

app.get('/api/clubs', async (req, res, next) => {
  try {
    const clubs = await Club.find().populate('mentor', 'name email').sort({ name: 1 }).lean();
    res.json(clubs);
  } catch (error) { next(error); }
});

app.get('/api/events', async (req, res, next) => {
  try {
    const events = await Event.find({ status: 'approved' })
      .populate('clubId', 'name')
      .populate('venueId', 'name location')
      .sort({ eventDate: 1 })
      .lean();
    const eventIds = events.map((event) => event._id);
    const registrationCounts = await EventRegistration.aggregate([
      { $match: { eventId: { $in: eventIds }, status: { $ne: 'cancelled' } } },
      { $group: { _id: '$eventId', count: { $sum: 1 } } },
    ]);
    const counts = new Map(registrationCounts.map((item) => [String(item._id), item.count]));
    res.json(events.map((event) => ({ ...event, registeredCount: counts.get(String(event._id)) || 0 })));
  } catch (error) { next(error); }
});

app.get('/api/announcements', async (req, res, next) => {
  try {
    res.json(await Announcement.find()
      .populate('clubId', 'name')
      .sort({ postedDate: -1 })
      .limit(50)
      .lean());
  } catch (error) { next(error); }
});

app.use('/api', ...authenticated);

app.get('/api/profiles/me', (req, res) => res.json(req.profile));

app.get('/api/members/mine', async (req, res, next) => {
  try {
    res.json(await ClubMember.find({ profileId: req.profile._id })
      .populate('clubId', 'name category')
      .sort({ joinedDate: -1 })
      .lean());
  } catch (error) { next(error); }
});

app.get('/api/events/manage', async (req, res, next) => {
  try {
    const clubIds = await visibleClubIds(req.profile);
    const filter = req.profile.role === roles.admin
      ? {}
      : req.profile.role === roles.faculty
        ? { $or: [{ status: 'approved' }, { clubId: { $in: clubIds } }] }
        : req.profile.role === roles.committee
          ? { $or: [{ status: 'approved' }, { clubId: { $in: clubIds } }] }
          : { $or: [{ status: 'approved' }, { clubId: { $in: clubIds } }] };
    const events = await Event.find(filter)
      .populate('clubId', 'name clubType mentor')
      .populate('venueId', 'name location')
      .sort({ eventDate: 1 })
      .lean();
    res.json(events);
  } catch (error) { next(error); }
});

app.get('/api/profiles', requireRole(isAdmin, roles.icts), async (req, res, next) => {
  try { res.json(await Profile.find({}, '-avatarUrl').sort({ name: 1 }).lean()); } catch (error) { next(error); }
});

app.delete('/api/profiles/:id', requireRole(roles.icts), async (req, res, next) => {
  try {
    const target = await Profile.findById(req.params.id);
    if (!target) throw new HttpError(404, 'Account not found.');
    if (target.role === roles.icts || target.supabaseId === req.authUser.id) {
      throw new HttpError(409, 'The ICTS account cannot delete itself.');
    }

    await deleteSupabaseUser(target.supabaseId);
    const profileId = target._id;
    try {
      const reportsWithAttendee = await EventReport.find(
        { attendeeIds: { $in: [profileId] } },
        '_id rosterCsv attendeeCount',
      ).lean();
      for (const report of reportsWithAttendee) {
        const { csv, removed } = removeCsvRowsForEmail(report.rosterCsv, target.email);
        await EventReport.updateOne(
          { _id: report._id },
          {
            $set: { rosterCsv: csv },
            $inc: { attendeeCount: -removed },
            $pull: { attendeeIds: profileId },
          },
        );
      }

      await Promise.all([
        Club.updateMany({ mentor: profileId }, { $unset: { mentor: '' } }),
        Event.updateMany(
          { $or: [{ createdBy: profileId }, { mentorReviewedBy: profileId }, { studentAffairsReviewedBy: profileId }] },
          {
            $unset: {
              createdBy: '',
              mentorReviewedBy: '',
              studentAffairsReviewedBy: '',
            },
          },
        ),
        MembershipApplication.deleteMany({ profileId }),
        MembershipApplication.updateMany({ reviewedBy: profileId }, { $unset: { reviewedBy: '' } }),
        ClubMember.deleteMany({ profileId }),
        EventRegistration.deleteMany({ profileId }),
        Attendance.deleteMany({ profileId }),
        EquipmentBorrow.deleteMany({ profileId }),
        EquipmentBorrow.updateMany(
          { $or: [{ mentorReviewedBy: profileId }, { studentAffairsReviewedBy: profileId }] },
          { $unset: { mentorReviewedBy: '', studentAffairsReviewedBy: '' } },
        ),
        ClubMessage.deleteMany({ senderId: profileId }),
        EventReport.deleteMany({ submittedBy: profileId }),
        EventReport.updateMany({ mentorReviewedBy: profileId }, { $unset: { mentorReviewedBy: '' } }),
        EventReport.updateMany({ studentAffairsReviewedBy: profileId }, { $unset: { studentAffairsReviewedBy: '' } }),
        FundingRequest.updateMany({ reviewedBy: profileId }, { $unset: { reviewedBy: '' } }),
      ]);

      await Profile.deleteOne({ _id: profileId });

      res.json({ message: 'Account and account-linked records were deleted.' });
    } catch (error) {
      console.error('Supabase login deleted, but MongoDB account cleanup failed:', error);
      return next(new HttpError(500, 'The login was deleted in Supabase, but some CampusSphere data could not be cleaned up. Retry the deletion to finish cleanup.'));
    }
  } catch (error) {
    return next(error);
  }
});

app.get('/api/profiles/students', requireRole(roles.faculty, roles.admin), async (req, res, next) => {
  try {
    const assignedClubIds = await Club.find({ mentor: req.profile._id }).distinct('_id');
    const memberProfileIds = assignedClubIds.length
      ? await ClubMember.distinct('profileId', {
        clubId: { $in: assignedClubIds },
        membershipStatus: 'active',
      })
      : [];
    res.json(await Profile.find({
      _id: { $in: memberProfileIds },
      role: { $in: [roles.student, roles.committee] },
    }, 'name email role')
      .sort({ name: 1 })
      .lean());
  } catch (error) { next(error); }
});

// Name, email, department and IDs are issued by ICTS and cannot be edited by the user.
const editableProfileFields = {
  phone: { max: 20, pattern: /^[+\d][\d\s()-]{6,19}$/, message: 'Enter a valid phone number (digits, spaces, +, - or brackets).' },
  bio: { max: 500 },
};

app.patch('/api/profiles/me', async (req, res, next) => {
  try {
    const body = req.body || {};
    for (const [field, rule] of Object.entries(editableProfileFields)) {
      if (body[field] === undefined) continue;
      const value = String(body[field]).trim();
      if (value.length > rule.max) throw new HttpError(400, `${field} must be ${rule.max} characters or fewer.`);
      if (value && rule.pattern && !rule.pattern.test(value)) throw new HttpError(400, rule.message);
      req.profile[field] = value;
    }
    if (body.avatarUrl !== undefined) {
      const avatar = String(body.avatarUrl);
      if (avatar && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)) {
        throw new HttpError(400, 'Profile picture must be a PNG, JPEG or WebP image.');
      }
      if (avatar.length > 400000) throw new HttpError(400, 'Profile picture is too large. Choose a smaller image.');
      req.profile.avatarUrl = avatar;
    }
    await req.profile.save();
    res.json(req.profile);
  } catch (error) { next(error); }
});

async function nextIdNumber(prefix) {
  const counter = await Counter.findOneAndUpdate({ _id: prefix }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  if (counter.seq > 999) throw new HttpError(409, `All 999 IDs for ${prefix} are used. Contact the system owner.`);
  return String(counter.seq).padStart(3, '0');
}

// ICTS-only: create admin accounts, faculty mentors and students.
app.post('/api/profiles', requireRole(roles.icts), async (req, res, next) => {
  let createdAuthUser;
  try {
    requireFields(req.body, ['name', 'email', 'password', 'role']);
    const name = String(req.body.name).trim();
    const email = String(req.body.email).trim().toLowerCase();
    const password = String(req.body.password);
    const role = req.body.role;
    const adminType = req.body.adminType || 'student_affairs';
    const designation = String(req.body.designation || '').trim();
    if (!name || name.length > 100) throw new HttpError(400, 'Name must be between 1 and 100 characters.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    if (![roles.admin, roles.faculty, roles.student].includes(role)) {
      throw new HttpError(400, 'ICTS can create admin, faculty and student accounts.');
    }
    if (role === roles.admin && !['student_affairs', 'principal', 'other_authority'].includes(adminType)) {
      throw new HttpError(400, 'Choose Student Affairs, Principal or Other authority for the admin type.');
    }
    if (role === roles.admin && adminType === 'other_authority' && !designation) {
      throw new HttpError(400, 'Enter the other authority designation.');
    }
    if (designation.length > 100) throw new HttpError(400, 'Designation must be 100 characters or fewer.');
    if (email === ICTS_EMAIL) throw new HttpError(409, 'That email belongs to the ICTS account.');
    if (await Profile.exists({ email })) throw new HttpError(409, 'An account with this email already exists.');

    let department = '';
    let joiningYear;
    if (role !== roles.admin) {
      department = String(req.body.department || '').trim().toUpperCase();
      joiningYear = Number(req.body.joiningYear);
      if (!/^[A-Z]{2,6}$/.test(department)) throw new HttpError(400, 'Department must be 2-6 letters, e.g. CSE.');
      if (!Number.isInteger(joiningYear) || joiningYear < 2000 || joiningYear > new Date().getFullYear() + 1) {
        throw new HttpError(400, 'Enter a valid 4-digit joining year.');
      }
    }

    createdAuthUser = await createSupabaseUser({ email, password, name });
    const profileData = { supabaseId: createdAuthUser.id, name, email, role };
    if (role === roles.admin) Object.assign(profileData, { adminType, designation });
    if (role !== roles.admin) {
      const yy = String(joiningYear).slice(-2);
      Object.assign(profileData, { department, joiningYear });
      if (role === roles.faculty) profileData.facultyId = `FA${yy}${department}${await nextIdNumber(`FA${yy}${department}`)}`;
      else profileData.registerNumber = `${department}${yy}${await nextIdNumber(`${department}${yy}`)}`;
    }
    const profile = await Profile.create(profileData);
    res.status(201).json(profile);
  } catch (error) {
    if (createdAuthUser?.id) {
      try {
        await deleteSupabaseUser(createdAuthUser.id);
      } catch (rollbackError) {
        console.error('Failed to roll back a Supabase user after profile creation failed:', rollbackError.message);
        return next(new HttpError(500, 'The account was created in Supabase but could not be saved in CampusSphere. Contact the system owner.'));
      }
    }
    return next(error);
  }
});

app.get('/api/my/clubs', async (req, res, next) => {
  try {
    if (req.profile.role === roles.admin) {
      return res.json(await Club.find().populate('mentor', 'name email').sort({ name: 1 }).lean());
    }
    const clubIds = await visibleClubIds(req.profile);
    return res.json(await Club.find({ _id: { $in: clubIds } }).populate('mentor', 'name email').sort({ name: 1 }).lean());
  } catch (error) { return next(error); }
});

async function assertAssignableMentor(mentorId) {
  if (!(await Profile.exists({ _id: mentorId, role: roles.faculty }))) {
    throw new HttpError(400, 'Choose a faculty mentor account created by ICTS.');
  }
}

app.post('/api/clubs', requireRole(isAdmin), async (req, res, next) => {
  try {
    requireFields(req.body, ['name', 'description', 'clubType', 'mentor']);
    if (!['technical', 'non_technical'].includes(req.body.clubType)) throw new HttpError(400, 'Choose a technical or non-technical club type.');
    await assertAssignableMentor(req.body.mentor);
    const club = await Club.create({
      name: req.body.name,
      description: req.body.description,
      category: req.body.category,
      clubType: req.body.clubType,
      mentor: req.body.mentor || undefined,
      recruitmentOpen: Boolean(req.body.recruitmentOpen),
    });
    res.status(201).json(club);
  } catch (error) { next(error); }
});

app.patch('/api/clubs/:id', async (req, res, next) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) throw new HttpError(404, 'Club not found.');
    if (req.profile.role !== roles.admin && !(await canManageClub(req.params.id, req.profile))) {
      throw new HttpError(403, 'Only this club’s leadership or Student Affairs can edit it.');
    }
    const allowed = req.profile.role === roles.admin
      ? ['name', 'description', 'category', 'clubType', 'mentor', 'recruitmentOpen']
      : ['name', 'description', 'category'];
    const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    if ('mentor' in update && !update.mentor) throw new HttpError(400, 'Every club needs an assigned faculty mentor.');
    if (update.mentor && String(update.mentor) !== String(club.mentor)) await assertAssignableMentor(update.mentor);
    Object.assign(club, update);
    await club.save();
    res.json(club);
  } catch (error) { next(error); }
});

app.post('/api/clubs/:clubId/members', async (req, res, next) => {
  try {
    requireFields(req.body, ['profileId', 'position']);
    const allowedPositions = [...officeBearerPositions];
    if (!allowedPositions.includes(req.body.position)) throw new HttpError(400, 'Invalid club position.');
    const club = await Club.findById(req.params.clubId);
    if (!club) throw new HttpError(404, 'Club not found.');
    if (req.profile.role !== roles.admin && String(club.mentor) !== String(req.profile._id)) {
      throw new HttpError(403, 'Only this club’s mentor or an admin can assign an office-bearer position.');
    }
    const nominee = await Profile.findById(req.body.profileId, 'role');
    if (!nominee) throw new HttpError(404, 'Profile not found.');
    if (![roles.student, roles.committee].includes(nominee.role)) {
      throw new HttpError(400, 'Only a student can be assigned a club office-bearer position.');
    }
    const currentMembership = await ClubMember.findOne({
      clubId: req.params.clubId,
      profileId: req.body.profileId,
      membershipStatus: 'active',
    });
    if (!currentMembership) {
      throw new HttpError(409, 'Approve the student’s application before assigning an office-bearer position.');
    }
    const positionTitle = String(req.body.positionTitle || '').trim();
    if (positionTitle.length > 80) throw new HttpError(400, 'Custom position title must be 80 characters or fewer.');
    const member = currentMembership;
    member.priorPosition = member.position;
    member.priorPositionTitle = member.positionTitle;
    member.priorOfficeBearerGroup = member.officeBearerGroup;
    member.hadPriorMembership = true;
    member.position = req.body.position;
    member.positionTitle = positionTitle;
    member.officeBearerGroup = true;
    member.membershipStatus = 'pending';
    await member.save();
    res.status(201).json(member);
  } catch (error) { next(error); }
});

app.get('/api/applications', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.clubId) {
      if (!(await canReviewMemberships(req.query.clubId, req.profile))) throw new HttpError(403, 'Only this club’s mentor, office bearers or an admin can review membership applications.');
      filter.clubId = req.query.clubId;
    } else if (req.profile.role === roles.admin) {
      filter.status = { $in: ['pending', 'approved', 'rejected'] };
    } else {
      const clubIds = await visibleClubIds(req.profile, officeBearerPositions);
      if (req.profile.role === roles.faculty) {
        clubIds.push(...await Club.find({ mentor: req.profile._id }).distinct('_id'));
      }
      filter.$or = [
        { profileId: req.profile._id },
        ...(clubIds.length ? [{ clubId: { $in: clubIds } }] : []),
      ];
    }
    res.json(await MembershipApplication.find(filter)
      .populate('clubId', 'name')
      .populate('profileId', 'name email')
      .sort({ appliedDate: -1 })
      .lean());
  } catch (error) { next(error); }
});

app.post('/api/applications', async (req, res, next) => {
  try {
    if (![roles.student, roles.committee].includes(req.profile.role)) {
      throw new HttpError(403, 'Only a student account can apply to join a club.');
    }
    requireFields(req.body, ['clubId', 'reason']);
    if (req.body.requestedPosition && !['member', 'executive'].includes(req.body.requestedPosition)) {
      throw new HttpError(400, 'Membership applications can request member or executive consideration.');
    }
    const club = await Club.findById(req.body.clubId);
    if (!club) throw new HttpError(404, 'Club not found.');
    if (!club.recruitmentOpen) throw new HttpError(409, 'Applications for this club are currently closed.');
    if (await ClubMember.exists({ clubId: req.body.clubId, profileId: req.profile._id })) {
      throw new HttpError(409, 'You are already a member of this club.');
    }
    if (await MembershipApplication.exists({
      clubId: req.body.clubId,
      profileId: req.profile._id,
      status: 'pending',
    })) throw new HttpError(409, 'You already have a pending application for this club.');
    const application = await MembershipApplication.create({
      clubId: req.body.clubId,
      profileId: req.profile._id,
      reason: req.body.reason,
      requestedPosition: req.body.requestedPosition || 'member',
    });
    res.status(201).json(application);
  } catch (error) { next(error); }
});

app.patch('/api/applications/:id', async (req, res, next) => {
  try {
    requireFields(req.body, ['status']);
    if (!['approved', 'rejected'].includes(req.body.status)) throw new HttpError(400, 'Status must be approved or rejected.');
    const application = await MembershipApplication.findById(req.params.id);
    if (!application) throw new HttpError(404, 'Application not found.');
    const club = await Club.findById(application.clubId, 'mentor').lean();
    const isAssignedMentor = req.profile.role === roles.faculty
      && String(club?.mentor || '') === String(req.profile._id);
    if (req.profile.role !== roles.admin && !isAssignedMentor
      && !(await canReviewMemberships(application.clubId, req.profile))) {
      throw new HttpError(403, 'Only this club’s assigned mentor, office bearers or an admin can review this application.');
    }
    if (req.body.status === 'rejected') requireRejectionFeedback(req.body);
    if (application.status !== 'pending') throw new HttpError(409, 'This application has already been reviewed.');
    const reviewed = await MembershipApplication.findOneAndUpdate(
      { _id: application._id, status: 'pending' },
      { status: req.body.status, reviewedBy: req.profile._id, rejectionFeedback: req.body.rejectionFeedback || '' },
      { new: true },
    );
    if (!reviewed) throw new HttpError(409, 'This application has already been reviewed.');
    if (reviewed.status === 'approved') {
      try {
        await ClubMember.updateOne(
          { clubId: reviewed.clubId, profileId: reviewed.profileId },
          { $setOnInsert: {
            position: reviewed.requestedPosition,
            positionTitle: '',
            membershipStatus: 'active',
            officeBearerGroup: false,
          } },
          { upsert: true },
        );
      } catch (error) {
        await MembershipApplication.updateOne(
          { _id: reviewed._id, status: 'approved' },
          { status: 'pending', $unset: { reviewedBy: 1 } },
        );
        throw error;
      }
    }
    res.json(reviewed);
  } catch (error) { next(error); }
});

app.get('/api/members', async (req, res, next) => {
  try {
    requireFields(req.query, ['clubId']);
    const club = await Club.findById(req.query.clubId, 'mentor');
    if (!club) throw new HttpError(404, 'Club not found.');
    if (!(await canReviewMemberships(req.query.clubId, req.profile))
      && String(club.mentor) !== String(req.profile._id)) {
      throw new HttpError(403, 'Only this club’s mentor, office bearers, or Student Affairs can view the member roster.');
    }
    res.json(await ClubMember.find({ clubId: req.query.clubId })
      .populate('profileId', 'name email')
      .sort({ joinedDate: -1 })
      .lean());
  } catch (error) { next(error); }
});

app.patch('/api/members/:id', async (req, res, next) => {
  try {
    requireFields(req.body, ['position']);
    const allowedPositions = ['member', 'executive', ...officeBearerPositions];
    if (!allowedPositions.includes(req.body.position)) throw new HttpError(400, 'Invalid club position.');
    const member = await ClubMember.findById(req.params.id);
    if (!member) throw new HttpError(404, 'Member not found.');
    if (member.membershipStatus !== 'active') {
      throw new HttpError(409, 'Pending invitations cannot be edited as active club roles.');
    }
    const club = await Club.findById(member.clubId, 'mentor');
    const canAssignPosition = req.profile.role === roles.admin || String(club?.mentor) === String(req.profile._id);
    if (!canAssignPosition) {
      throw new HttpError(403, 'Only this club’s mentor or Student Affairs can change club positions.');
    }
    const positionChanged = member.position !== req.body.position;
    member.position = req.body.position;
    if (req.body.positionTitle !== undefined) {
      const positionTitle = String(req.body.positionTitle || '').trim();
      if (positionTitle.length > 80) throw new HttpError(400, 'Custom position title must be 80 characters or fewer.');
      member.positionTitle = positionTitle;
    }
    member.officeBearerGroup = officeBearerPositions.includes(member.position)
      || (req.body.officeBearerGroup === undefined
        ? positionChanged ? false : member.officeBearerGroup
        : Boolean(req.body.officeBearerGroup));
    await member.save();
    res.json(member);
  } catch (error) { next(error); }
});

app.delete('/api/members/:id', async (req, res, next) => {
  try {
    const member = await ClubMember.findById(req.params.id);
    if (!member) throw new HttpError(404, 'Club member not found.');
    const club = await Club.findById(member.clubId, 'mentor');
    if (req.profile.role !== roles.admin && String(club?.mentor) !== String(req.profile._id)) {
      throw new HttpError(403, 'Only the assigned club mentor or Student Affairs can remove a member.');
    }
    await member.deleteOne();
    res.json({ message: 'Club membership ended.' });
  } catch (error) { next(error); }
});

app.patch('/api/members/:id/respond', async (req, res, next) => {
  try {
    requireFields(req.body, ['response']);
    if (!['accepted', 'declined'].includes(req.body.response)) {
      throw new HttpError(400, 'Response must be accepted or declined.');
    }
    const member = await ClubMember.findById(req.params.id);
    if (!member || String(member.profileId) !== String(req.profile._id)) {
      throw new HttpError(404, 'Office-bearer invitation not found.');
    }
    if (member.membershipStatus !== 'pending') throw new HttpError(409, 'This invitation has already been answered.');
    let deleted = false;
    if (req.body.response === 'accepted') {
      member.membershipStatus = 'active';
      member.priorPosition = undefined;
      member.priorPositionTitle = undefined;
      member.priorOfficeBearerGroup = undefined;
      member.hadPriorMembership = false;
    } else if (member.hadPriorMembership) {
      member.position = member.priorPosition || 'member';
      member.positionTitle = member.priorPositionTitle || '';
      member.officeBearerGroup = member.priorOfficeBearerGroup || false;
      member.membershipStatus = 'active';
      member.priorPosition = undefined;
      member.priorPositionTitle = undefined;
      member.priorOfficeBearerGroup = undefined;
      member.hadPriorMembership = false;
    } else {
      await member.deleteOne();
      deleted = true;
    }
    if (!deleted) await member.save();
    res.json({ message: req.body.response === 'accepted' ? 'Office-bearer invitation accepted.' : 'Office-bearer invitation declined.' });
  } catch (error) { next(error); }
});

app.post('/api/events', async (req, res, next) => {
  try {
    requireFields(req.body, ['title', 'eventDate', 'clubId']);
    const club = await Club.findById(req.body.clubId);
    if (!club) throw new HttpError(404, 'Club not found.');
    if (!club.mentor) throw new HttpError(409, 'Assign a faculty mentor to this club before proposing events.');
    const position = await getClubPosition(req.body.clubId, req.profile._id);
    if (!position || !['president', 'executive'].includes(position.position)) {
      throw new HttpError(403, 'Only this club’s president or executive can propose an event.');
    }
    if (req.body.eventType && req.body.eventType !== club.clubType) {
      throw new HttpError(400, `This club can only host ${club.clubType.replace('_', ' ')} events.`);
    }
    if (req.body.venueId && !(await Venue.exists({ _id: req.body.venueId, isAvailable: true }))) {
      throw new HttpError(400, 'Choose an available venue.');
    }
    const event = await Event.create({
      title: req.body.title,
      description: req.body.description,
      eventDate: req.body.eventDate,
      clubId: req.body.clubId,
      eventType: club.clubType,
      venueId: req.body.venueId || undefined,
      capacity: req.body.capacity ?? 100,
      createdBy: req.profile._id,
      status: position.position === 'president' ? 'mentor_pending' : 'draft',
    });
    res.status(201).json(event);
  } catch (error) { next(error); }
});

app.patch('/api/events/:id', async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) throw new HttpError(404, 'Event not found.');
    const position = await getClubPosition(event.clubId, req.profile._id);
    if (!position || !['president', 'executive'].includes(position.position)) {
      throw new HttpError(403, 'Only this club’s president or executive can edit an event.');
    }
    if (event.status !== 'draft' && event.status !== 'rejected') {
      throw new HttpError(409, 'An event under review or already approved cannot be edited.');
    }
    if (position.position !== 'president') {
      throw new HttpError(403, 'Only the club president can edit and submit this event request.');
    }
    const allowed = ['title', 'description', 'eventDate', 'venueId', 'capacity'];
    Object.entries(req.body).forEach(([key, value]) => {
      if (allowed.includes(key)) event[key] = value;
    });
    if (event.venueId && !(await Venue.exists({ _id: event.venueId, isAvailable: true }))) {
      throw new HttpError(400, 'Choose an available venue.');
    }
    event.status = 'draft';
    event.rejectionFeedback = '';
    event.rejectionStage = undefined;
    await event.save();
    res.json(event);
  } catch (error) { next(error); }
});

app.patch('/api/events/:id/submit', async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) throw new HttpError(404, 'Event not found.');
    const position = await getClubPosition(event.clubId, req.profile._id);
    if (position?.position !== 'president') {
      throw new HttpError(403, 'Only the club president can send an event request for approval.');
    }
    if (!['draft', 'rejected'].includes(event.status)) throw new HttpError(409, 'This event is already in the approval process.');
    event.status = 'mentor_pending';
    event.rejectionFeedback = '';
    event.rejectionStage = undefined;
    event.mentorReviewedBy = undefined;
    event.studentAffairsReviewedBy = undefined;
    await event.save();
    res.json(event);
  } catch (error) { next(error); }
});

app.patch('/api/events/:id/approval', async (req, res, next) => {
  try {
    requireFields(req.body, ['status']);
    if (!['approved', 'rejected'].includes(req.body.status)) throw new HttpError(400, 'Status must be approved or rejected.');
    const event = await Event.findById(req.params.id);
    if (!event) throw new HttpError(404, 'Event not found.');
    const club = await Club.findById(event.clubId);
    const isMentor = String(club?.mentor) === String(req.profile._id);
    const isStudentAffairs = req.profile.role === roles.admin;
    const stage = event.status === 'mentor_pending' && isMentor
      ? 'mentor'
      : event.status === 'student_affairs_pending' && isStudentAffairs
        ? 'student_affairs'
        : null;
    if (!stage) throw new HttpError(403, 'This request is not awaiting your approval.');
    if (req.body.status === 'rejected') requireRejectionFeedback(req.body);
    if (stage === 'mentor') {
      event.mentorReviewedBy = req.profile._id;
      event.status = req.body.status === 'approved' ? 'student_affairs_pending' : 'rejected';
      event.rejectionStage = req.body.status === 'rejected' ? 'mentor' : undefined;
    } else {
      event.studentAffairsReviewedBy = req.profile._id;
      event.status = req.body.status;
      event.rejectionStage = req.body.status === 'rejected' ? 'student_affairs' : undefined;
    }
    event.rejectionFeedback = req.body.status === 'rejected' ? req.body.rejectionFeedback.trim() : '';
    await event.save();
    res.json(event);
  } catch (error) { next(error); }
});

app.get('/api/registrations', async (req, res, next) => {
  try {
    const filter = req.query.eventId ? { eventId: req.query.eventId } : { profileId: req.profile._id };
    if (req.query.eventId) {
      const event = await Event.findById(req.query.eventId);
      if (!event) throw new HttpError(404, 'Event not found.');
      if (!(await canManageClub(event.clubId, req.profile))) throw new HttpError(403, 'Not allowed to view registrations for this event.');
    }
    res.json(await EventRegistration.find(filter)
      .populate('eventId', 'title eventDate clubId')
      .populate('profileId', 'name email')
      .sort({ registrationDate: -1 })
      .lean());
  } catch (error) { next(error); }
});

app.post('/api/registrations', async (req, res, next) => {
  try {
    requireFields(req.body, ['eventId']);
    const event = await Event.findOneAndUpdate(
      {
        _id: req.body.eventId,
        status: 'approved',
        $expr: { $lt: ['$registeredCount', '$capacity'] },
      },
      { $inc: { registeredCount: 1 } },
      { new: true },
    );
    if (!event) {
      const approvedEvent = await Event.findOne({ _id: req.body.eventId, status: 'approved' });
      if (!approvedEvent) throw new HttpError(404, 'Approved event not found.');
      throw new HttpError(409, 'This event is full.');
    }
    try {
      const existing = await EventRegistration.findOneAndUpdate(
        { eventId: event._id, profileId: req.profile._id, status: 'cancelled' },
        { status: 'registered', registrationDate: new Date() },
        { new: true },
      );
      const registration = existing || await EventRegistration.create({
        eventId: event._id,
        profileId: req.profile._id,
      });
      res.status(201).json(registration);
    } catch (error) {
      await Event.updateOne({ _id: event._id }, { $inc: { registeredCount: -1 } });
      if (error.code === 11000) throw new HttpError(409, 'You are already registered for this event.');
      throw error;
    }
  } catch (error) { next(error); }
});

app.delete('/api/registrations/:id', async (req, res, next) => {
  try {
    const registration = await EventRegistration.findOneAndUpdate(
      { _id: req.params.id, profileId: req.profile._id, status: 'registered' },
      { status: 'cancelled' },
      { new: true },
    );
    if (!registration) throw new HttpError(404, 'Active registration not found.');
    await Event.updateOne({ _id: registration.eventId, registeredCount: { $gt: 0 } }, { $inc: { registeredCount: -1 } });
    res.json(registration);
  } catch (error) { next(error); }
});

app.get('/api/venues', async (req, res, next) => {
  try { res.json(await Venue.find({ isAvailable: true }).sort({ name: 1 }).lean()); } catch (error) { next(error); }
});

app.post('/api/venues', requireRole(isAdmin), async (req, res, next) => {
  try {
    requireFields(req.body, ['name', 'capacity', 'location']);
    res.status(201).json(await Venue.create(req.body));
  } catch (error) { next(error); }
});

app.post('/api/announcements', requireClubManager, async (req, res, next) => {
  try {
    requireFields(req.body, ['clubId', 'title', 'content']);
    res.status(201).json(await Announcement.create({
      clubId: req.body.clubId,
      title: req.body.title,
      content: req.body.content,
      priority: req.body.priority || 'normal',
    }));
  } catch (error) { next(error); }
});

app.get('/api/funding-requests', async (req, res, next) => {
  try {
    const clubIds = await visibleClubIds(req.profile);
    const filter = req.profile.role === roles.admin ? {} : { clubId: { $in: clubIds } };
    res.json(await FundingRequest.find(filter).populate('clubId', 'name').sort({ requestDate: -1 }).lean());
  } catch (error) { next(error); }
});

app.post('/api/funding-requests', requireClubManager, async (req, res, next) => {
  try {
    requireFields(req.body, ['clubId', 'requestedAmount', 'purpose']);
    if (!(await Club.exists({ _id: req.body.clubId }))) throw new HttpError(404, 'Club not found.');
    res.status(201).json(await FundingRequest.create({
      clubId: req.body.clubId,
      eventId: req.body.eventId || undefined,
      requestedAmount: req.body.requestedAmount,
      purpose: req.body.purpose,
    }));
  } catch (error) { next(error); }
});

app.patch('/api/funding-requests/:id/approval', async (req, res, next) => {
  try {
    requireFields(req.body, ['status']);
    if (!['approved', 'rejected'].includes(req.body.status)) throw new HttpError(400, 'Status must be approved or rejected.');
    const pendingRequest = await FundingRequest.findById(req.params.id);
    if (!pendingRequest) throw new HttpError(404, 'Funding request not found.');
    const club = await Club.findById(pendingRequest.clubId);
    if (req.profile.role !== roles.admin && String(club?.mentor) !== String(req.profile._id)) {
      throw new HttpError(403, 'Only the assigned club mentor or Student Affairs can review this request.');
    }
    if (req.body.status === 'rejected') requireRejectionFeedback(req.body);
    const budget = req.body.status === 'approved'
      ? await ClubBudget.findOne({ clubId: pendingRequest.clubId }).sort({ academicYear: -1 })
      : null;
    if (req.body.status === 'approved' && !budget) {
      throw new HttpError(409, 'This club needs a budget before funding can be approved.');
    }
    const request = await FundingRequest.findOneAndUpdate(
      { _id: pendingRequest._id, status: 'pending' },
      { status: req.body.status, reviewedBy: req.profile._id, rejectionFeedback: req.body.rejectionFeedback || '' },
      { new: true },
    );
    if (!request) throw new HttpError(409, 'This request has already been reviewed.');

    if (req.body.status === 'approved') {
      let transaction;
      try {
        transaction = await BudgetTransaction.create({
          clubId: request.clubId,
          fundingRequestId: request._id,
          amount: request.requestedAmount,
          type: 'credit',
          description: `Approved funding: ${request.purpose}`,
        });
        const budgetUpdate = await ClubBudget.updateOne(
          { _id: budget._id },
          { $inc: { totalAllocated: request.requestedAmount } },
        );
        if (!budgetUpdate.matchedCount) throw new HttpError(404, 'The club budget no longer exists.');
      } catch (error) {
        const rollback = [
          transaction && BudgetTransaction.deleteOne({ _id: transaction._id }),
          FundingRequest.updateOne(
            { _id: request._id, status: 'approved', reviewedBy: req.profile._id },
            { status: 'pending', $unset: { reviewedBy: 1 } },
          ),
        ].filter(Boolean);
        const results = await Promise.allSettled(rollback);
        results.filter((result) => result.status === 'rejected')
          .forEach((result) => console.error('Funding approval rollback failed:', result.reason));
        throw error;
      }
    }
    res.json(request);
  } catch (error) { next(error); }
});

app.get('/api/budgets', async (req, res, next) => {
  try {
    const filter = req.query.clubId ? { clubId: req.query.clubId } : {};
    if (req.query.clubId && !(await canManageClub(req.query.clubId, req.profile))) {
      throw new HttpError(403, 'Not allowed to view this club’s budget.');
    }
    if (!req.query.clubId && req.profile.role !== roles.admin) {
      filter.clubId = { $in: await visibleClubIds(req.profile) };
    }
    res.json(await ClubBudget.find(filter).populate('clubId', 'name').sort({ academicYear: -1 }).lean());
  } catch (error) { next(error); }
});

app.post('/api/budgets', requireRole(isAdmin), async (req, res, next) => {
  try {
    requireFields(req.body, ['clubId', 'academicYear', 'totalAllocated']);
    if (!(await Club.exists({ _id: req.body.clubId }))) throw new HttpError(404, 'Club not found.');
    res.status(201).json(await ClubBudget.create({
      clubId: req.body.clubId,
      academicYear: req.body.academicYear,
      totalAllocated: req.body.totalAllocated,
    }));
  } catch (error) { next(error); }
});

app.get('/api/transactions', requireRole(...isFacultyOrAdmin), async (req, res, next) => {
  try {
    const filter = req.profile.role === roles.admin ? {} : { clubId: { $in: await visibleClubIds(req.profile) } };
    res.json(await BudgetTransaction.find(filter).populate('clubId', 'name').sort({ transactionDate: -1 }).lean());
  } catch (error) { next(error); }
});

app.post('/api/transactions', requireRole(isAdmin), async (req, res, next) => {
  try {
    requireFields(req.body, ['clubId', 'amount', 'type', 'description']);
    if (!['credit', 'debit'].includes(req.body.type)) throw new HttpError(400, 'Type must be credit or debit.');
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Amount must be a positive number.');
    const budget = await ClubBudget.findOne({ clubId: req.body.clubId }).sort({ academicYear: -1 });
    if (!budget) throw new HttpError(404, 'Create a club budget before recording a transaction.');
    const budgetUpdate = req.body.type === 'debit'
      ? await ClubBudget.findOneAndUpdate(
        {
          _id: budget._id,
          $expr: { $lte: [{ $add: ['$totalSpent', amount] }, '$totalAllocated'] },
        },
        { $inc: { totalSpent: amount } },
        { new: true },
      )
      : await ClubBudget.findByIdAndUpdate(
        budget._id,
        { $inc: { totalAllocated: amount } },
        { new: true },
      );
    if (!budgetUpdate) throw new HttpError(409, 'This transaction exceeds the club’s remaining budget.');
    try {
      const transaction = await BudgetTransaction.create({
        clubId: req.body.clubId,
        amount,
        type: req.body.type,
        description: req.body.description,
      });
      return res.status(201).json(transaction);
    } catch (error) {
      const rollback = req.body.type === 'debit' ? { totalSpent: -amount } : { totalAllocated: -amount };
      await ClubBudget.updateOne({ _id: budget._id }, { $inc: rollback });
      throw error;
    }
  } catch (error) { next(error); }
});

app.get('/api/equipment', async (req, res, next) => {
  try {
    const filter = req.query.clubId ? { clubId: req.query.clubId } : {};
    res.json(await Equipment.find(filter).populate('clubId', 'name').sort({ name: 1 }).lean());
  } catch (error) { next(error); }
});

app.post('/api/equipment', requireClubManager, async (req, res, next) => {
  try {
    requireFields(req.body, ['clubId', 'name', 'totalQuantity']);
    res.status(201).json(await Equipment.create({
      clubId: req.body.clubId,
      name: req.body.name,
      description: req.body.description,
      totalQuantity: req.body.totalQuantity,
      availableQuantity: req.body.totalQuantity,
      condition: req.body.condition,
    }));
  } catch (error) { next(error); }
});

app.get('/api/equipment-borrows', async (req, res, next) => {
  try {
    const clubIds = await visibleClubIds(req.profile);
    const filter = req.profile.role === roles.admin
      ? {}
      : { $or: [{ profileId: req.profile._id }, { clubId: { $in: clubIds } }] };
    await EquipmentBorrow.updateMany(
      { ...filter, status: 'borrowed', dueDate: { $lt: new Date() } },
      { status: 'overdue' },
    );
    res.json(await EquipmentBorrow.find(filter)
      .populate('equipmentId', 'name clubId')
      .populate('clubId', 'name')
      .populate('profileId', 'name email')
      .sort({ borrowDate: -1 })
      .lean());
  } catch (error) { next(error); }
});

app.post('/api/equipment-borrows', async (req, res, next) => {
  try {
    requireFields(req.body, ['equipmentId', 'clubId', 'dueDate']);
    const dueDate = new Date(req.body.dueDate);
    if (Number.isNaN(dueDate.getTime()) || dueDate <= new Date()) {
      throw new HttpError(400, 'Choose a due date in the future.');
    }
    const club = await Club.findById(req.body.clubId);
    if (!club) throw new HttpError(404, 'Club not found.');
    if (!club.mentor) throw new HttpError(409, 'Assign a faculty mentor to this club before requesting equipment.');
    const position = await getClubPosition(req.body.clubId, req.profile._id);
    if (position?.position !== 'president') {
      throw new HttpError(403, 'Only this club’s president can request equipment borrowing approval.');
    }
    const equipment = await Equipment.findOne({ _id: req.body.equipmentId, clubId: req.body.clubId });
    if (!equipment) throw new HttpError(404, 'Equipment not found in this club.');
    if (equipment.availableQuantity < 1) throw new HttpError(409, 'This equipment is unavailable.');
    const borrow = await EquipmentBorrow.create({
      equipmentId: equipment._id,
      clubId: equipment.clubId,
      profileId: req.profile._id,
      dueDate,
      status: 'mentor_pending',
    });
    res.status(201).json(borrow);
  } catch (error) { next(error); }
});

app.patch('/api/equipment-borrows/:id/approval', async (req, res, next) => {
  try {
    requireFields(req.body, ['status']);
    if (!['approved', 'rejected'].includes(req.body.status)) throw new HttpError(400, 'Status must be approved or rejected.');
    const borrow = await EquipmentBorrow.findById(req.params.id);
    if (!borrow) throw new HttpError(404, 'Equipment request not found.');
    const club = await Club.findById(borrow.clubId);
    const mentorReview = borrow.status === 'mentor_pending' && String(club?.mentor) === String(req.profile._id);
    const studentAffairsReview = borrow.status === 'student_affairs_pending' && req.profile.role === roles.admin;
    if (!mentorReview && !studentAffairsReview) throw new HttpError(403, 'This equipment request is not awaiting your approval.');
    if (req.body.status === 'rejected') requireRejectionFeedback(req.body);
    if (mentorReview) {
      borrow.mentorReviewedBy = req.profile._id;
      borrow.status = req.body.status === 'approved' ? 'student_affairs_pending' : 'rejected';
      borrow.rejectionStage = req.body.status === 'rejected' ? 'mentor' : undefined;
    } else if (req.body.status === 'rejected') {
      borrow.studentAffairsReviewedBy = req.profile._id;
      borrow.status = 'rejected';
      borrow.rejectionStage = 'student_affairs';
    } else {
      const equipment = await Equipment.findOneAndUpdate(
        { _id: borrow.equipmentId, availableQuantity: { $gt: 0 } },
        { $inc: { availableQuantity: -1 } },
        { new: true },
      );
      if (!equipment) throw new HttpError(409, 'The equipment is no longer available.');
      borrow.studentAffairsReviewedBy = req.profile._id;
      borrow.status = 'borrowed';
    }
    borrow.rejectionFeedback = req.body.status === 'rejected' ? req.body.rejectionFeedback.trim() : '';
    await borrow.save();
    res.json(borrow);
  } catch (error) { next(error); }
});

app.patch('/api/equipment-borrows/:id/return', async (req, res, next) => {
  try {
    const borrow = await EquipmentBorrow.findById(req.params.id);
    if (!borrow) throw new HttpError(404, 'Equipment request not found.');
    const equipment = await Equipment.findById(borrow.equipmentId);
    const position = await getClubPosition(borrow.clubId, req.profile._id);
    if (req.profile.role !== roles.admin
      && String(borrow.profileId) !== String(req.profile._id)
      && !position) {
      throw new HttpError(403, 'Not allowed to return this equipment.');
    }
    const returnedBorrow = await EquipmentBorrow.findOneAndUpdate(
      { _id: borrow._id, status: { $in: ['borrowed', 'overdue'] } },
      { status: 'returned', returnDate: new Date() },
      { new: true },
    );
    if (!returnedBorrow) throw new HttpError(409, 'This equipment has already been returned.');
    await Equipment.updateOne({ _id: borrow.equipmentId }, { $inc: { availableQuantity: 1 } });
    res.json(returnedBorrow);
  } catch (error) { next(error); }
});

app.post('/api/attendance', async (req, res, next) => {
  try {
    requireFields(req.body, ['eventId', 'profileId', 'status']);
    const event = await Event.findById(req.body.eventId);
    if (!event || event.status !== 'approved') throw new HttpError(404, 'Approved event not found.');
    await requireClubPosition(event.clubId, req.profile, ['executive', ...officeBearerPositions]);
    if (!(await EventRegistration.exists({
      eventId: event._id,
      profileId: req.body.profileId,
      status: 'registered',
    }))) throw new HttpError(409, 'Attendance can only be recorded for a registered participant.');
    res.status(201).json(await Attendance.create(req.body));
  } catch (error) { next(error); }
});

app.patch('/api/attendance/:id', async (req, res, next) => {
  try {
    requireFields(req.body, ['status']);
    if (!['present', 'absent', 'excused'].includes(req.body.status)) throw new HttpError(400, 'Invalid attendance status.');
    const record = await Attendance.findById(req.params.id);
    if (!record) throw new HttpError(404, 'Attendance record not found.');
    const event = await Event.findById(record.eventId);
    if (!event) throw new HttpError(404, 'Event not found.');
    await requireClubPosition(event.clubId, req.profile, ['executive', ...officeBearerPositions]);
    record.status = req.body.status;
    record.checkInTime = req.body.status === 'present' ? new Date() : record.checkInTime;
    await record.save();
    res.json(record);
  } catch (error) { next(error); }
});

app.get('/api/attendance', async (req, res, next) => {
  try {
    requireFields(req.query, ['eventId']);
    const event = await Event.findById(req.query.eventId);
    if (!event) throw new HttpError(404, 'Event not found.');
    await requireClubPosition(event.clubId, req.profile, ['executive', ...officeBearerPositions]);
    res.json(await Attendance.find({ eventId: event._id })
      .populate('profileId', 'name email')
      .sort({ checkInTime: -1 })
      .lean());
  } catch (error) { next(error); }
});

app.get('/api/event-reports', async (req, res, next) => {
  try {
    const leadershipClubIds = req.profile.role === roles.admin
      ? []
      : await visibleClubIds(req.profile, officeBearerPositions);
    const mentoredClubs = req.profile.role === roles.admin
      ? []
      : (await Club.find({ mentor: req.profile._id }, '_id').lean()).map((club) => club._id);
    const filter = req.profile.role === roles.admin
      ? {}
      : { $or: [
        { submittedBy: req.profile._id },
        { clubId: { $in: leadershipClubIds } },
        { clubId: { $in: mentoredClubs } },
      ] };
    res.json(await EventReport.find(filter)
      .populate('eventId', 'title eventDate')
      .populate('clubId', 'name')
      .populate('submittedBy', 'name')
      .sort({ createdAt: -1 })
      .lean());
  } catch (error) { next(error); }
});

app.post('/api/events/:id/report', async (req, res, next) => {
  try {
    requireFields(req.body, ['summary', 'activities', 'outcomes']);
    const event = await Event.findById(req.params.id);
    if (!event || event.status !== 'approved') throw new HttpError(404, 'Approved event not found.');
    const position = await getClubPosition(event.clubId, req.profile._id);
    if (position?.position !== 'president') {
      throw new HttpError(403, 'Only the club president can submit the event report.');
    }
    if (new Date(event.eventDate) > new Date()) throw new HttpError(409, 'Submit the detailed report after the event has finished.');
    if (await EventReport.exists({ eventId: event._id })) throw new HttpError(409, 'A report has already been submitted for this event.');

    const roster = await buildAttendanceRoster(event._id, event.title);

    const report = await EventReport.create({
      eventId: event._id,
      clubId: event.clubId,
      submittedBy: req.profile._id,
      summary: req.body.summary,
      activities: req.body.activities,
      outcomes: req.body.outcomes,
      issues: req.body.issues || '',
      budgetSpent: req.body.budgetSpent || 0,
      ...roster,
    });
    res.status(201).json(report);
  } catch (error) { next(error); }
});

app.get('/api/event-reports/:id/roster', async (req, res, next) => {
  try {
    const report = await EventReport.findById(req.params.id);
    if (!report) throw new HttpError(404, 'Event report not found.');
    if (req.profile.role !== roles.admin) {
      const club = await Club.findById(report.clubId);
      const isMentor = String(club?.mentor) === String(req.profile._id);
      const isOfficeBearer = await canReviewMemberships(report.clubId, req.profile);
      if (!isMentor && !isOfficeBearer) throw new HttpError(403, 'You do not have access to this attendance roster.');
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${report.rosterFileName.replace(/["\r\n]/g, '')}"`);
    res.send(report.rosterCsv);
  } catch (error) { next(error); }
});

app.patch('/api/event-reports/:id/approval', async (req, res, next) => {
  try {
    requireFields(req.body, ['status']);
    if (!['approved', 'rejected'].includes(req.body.status)) throw new HttpError(400, 'Status must be approved or rejected.');
    const report = await EventReport.findById(req.params.id);
    if (!report) throw new HttpError(404, 'Event report not found.');
    const club = await Club.findById(report.clubId);
    const mentorReview = report.status === 'mentor_pending' && String(club?.mentor) === String(req.profile._id);
    const studentAffairsReview = report.status === 'student_affairs_pending'
      && req.profile.role === roles.admin;
    if (!mentorReview && !studentAffairsReview) throw new HttpError(403, 'This report is not awaiting your review.');
    if (req.body.status === 'rejected') requireRejectionFeedback(req.body);
    if (mentorReview) {
      report.mentorReviewedBy = req.profile._id;
      report.status = req.body.status === 'approved' ? 'student_affairs_pending' : 'rejected';
      report.rejectionStage = req.body.status === 'rejected' ? 'mentor' : undefined;
    } else {
      report.studentAffairsReviewedBy = req.profile._id;
      report.status = req.body.status;
      report.rejectionStage = req.body.status === 'rejected' ? 'student_affairs' : undefined;
    }
    report.rejectionFeedback = req.body.status === 'rejected' ? req.body.rejectionFeedback.trim() : '';
    await report.save();
    res.json(report);
  } catch (error) { next(error); }
});

app.patch('/api/event-reports/:id/resubmit', async (req, res, next) => {
  try {
    const report = await EventReport.findById(req.params.id);
    if (!report) throw new HttpError(404, 'Event report not found.');
    const position = await getClubPosition(report.clubId, req.profile._id);
    if (position?.position !== 'president') {
      throw new HttpError(403, 'Only the club president can revise the report.');
    }
    if (report.status !== 'rejected') throw new HttpError(409, 'Only a rejected report can be resubmitted.');
    for (const field of ['summary', 'activities', 'outcomes', 'issues']) {
      if (req.body[field] !== undefined) report[field] = req.body[field];
    }
    if (req.body.budgetSpent !== undefined) report.budgetSpent = req.body.budgetSpent;
    const event = await Event.findById(report.eventId, 'title');
    if (!event) throw new HttpError(404, 'The event for this report no longer exists.');
    Object.assign(report, await buildAttendanceRoster(report.eventId, event.title));
    report.status = 'mentor_pending';
    report.rejectionFeedback = '';
    report.rejectionStage = undefined;
    report.mentorReviewedBy = undefined;
    report.studentAffairsReviewedBy = undefined;
    await report.save();
    res.json(report);
  } catch (error) { next(error); }
});

app.get('/api/clubs/:clubId/messages', async (req, res, next) => {
  try {
    const group = req.query.group === 'office_bearers' ? 'office_bearers' : 'members';
    const membership = await getClubPosition(req.params.clubId, req.profile._id);
    if (!membership && req.profile.role !== roles.admin) throw new HttpError(403, 'Join this club to access its group chat.');
    if (group === 'office_bearers' && req.profile.role !== roles.admin
      && !officeBearerPositions.includes(membership.position)
      && !(membership.position === 'executive' && membership.officeBearerGroup)) {
      throw new HttpError(403, 'The office-bearers chat is private to this club’s office bearers.');
    }
    res.json(await ClubMessage.find({ clubId: req.params.clubId, group })
      .populate('senderId', 'name')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean());
  } catch (error) { next(error); }
});

app.post('/api/clubs/:clubId/messages', async (req, res, next) => {
  try {
    requireFields(req.body, ['content', 'group']);
    if (!['members', 'office_bearers'].includes(req.body.group)) throw new HttpError(400, 'Invalid chat group.');
    const membership = await getClubPosition(req.params.clubId, req.profile._id);
    if (!membership && req.profile.role !== roles.admin) throw new HttpError(403, 'Join this club to send a message.');
    if (req.body.group === 'office_bearers' && req.profile.role !== roles.admin
      && !officeBearerPositions.includes(membership.position)
      && !(membership.position === 'executive' && membership.officeBearerGroup)) {
      throw new HttpError(403, 'Only this club’s office bearers can send messages to their private group.');
    }
    const message = await ClubMessage.create({
      clubId: req.params.clubId,
      senderId: req.profile._id,
      group: req.body.group,
      content: req.body.content,
    });
    await message.populate('senderId', 'name');
    res.status(201).json(message);
  } catch (error) { next(error); }
});

app.get('/api/participation', async (req, res, next) => {
  try {
    const records = await Attendance.find({ profileId: req.profile._id })
      .populate({ path: 'eventId', select: 'title eventDate clubId', populate: { path: 'clubId', select: 'name' } })
      .sort({ checkInTime: -1 })
      .lean();
    res.json(records);
  } catch (error) { next(error); }
});

app.get('/api/reports/summary', async (req, res, next) => {
  try {
    const clubIds = await visibleClubIds(req.profile);
    const [clubs, events, members, applications, budgets, equipment] = await Promise.all([
      req.profile.role === roles.admin ? Club.countDocuments() : clubIds.length,
      Event.countDocuments({ clubId: { $in: clubIds } }),
      ClubMember.countDocuments({ clubId: { $in: clubIds } }),
      MembershipApplication.countDocuments({ clubId: { $in: clubIds }, status: 'pending' }),
      ClubBudget.aggregate([
        { $match: { clubId: { $in: clubIds } } },
        { $group: { _id: null, allocated: { $sum: '$totalAllocated' }, spent: { $sum: '$totalSpent' } } },
      ]),
      Equipment.countDocuments({ clubId: { $in: clubIds } }),
    ]);
    const reportClubIds = req.profile.role === roles.admin
      ? (await Club.find({}, '_id').lean()).map((club) => club._id)
      : await visibleClubIds(req.profile, officeBearerPositions);
    const visibleClubs = await Club.find({ _id: { $in: reportClubIds } }, 'name category').sort({ name: 1 }).lean();
    const clubReports = await Promise.all(visibleClubs.map(async (club) => {
      const [clubMembers, clubEvents, clubApplications, clubAnnouncements, budget] = await Promise.all([
        ClubMember.countDocuments({ clubId: club._id }),
        Event.countDocuments({ clubId: club._id }),
        MembershipApplication.countDocuments({ clubId: club._id, status: 'pending' }),
        Announcement.countDocuments({ clubId: club._id }),
        ClubBudget.findOne({ clubId: club._id }).sort({ academicYear: -1 }).lean(),
      ]);
      const mayViewBudget = req.profile.role === roles.admin
        || req.profile.role === roles.faculty
        || Boolean(await canReviewMemberships(club._id, req.profile));
      return {
        _id: club._id,
        name: club.name,
        category: club.category,
        members: clubMembers,
        events: clubEvents,
        pendingApplications: clubApplications,
        announcements: clubAnnouncements,
        allocated: mayViewBudget ? budget?.totalAllocated || 0 : 0,
        spent: mayViewBudget ? budget?.totalSpent || 0 : 0,
      };
    }));
    res.json({
      clubs,
      events,
      members,
      pendingApplications: applications,
      equipment,
      allocated: req.profile.role === roles.admin || req.profile.role === roles.faculty
        ? budgets[0]?.allocated || 0
        : (await Promise.all(reportClubIds.map(async (clubId) => canReviewMemberships(clubId, req.profile)))).some(Boolean)
          ? budgets[0]?.allocated || 0
          : 0,
      spent: req.profile.role === roles.admin || req.profile.role === roles.faculty
        ? budgets[0]?.spent || 0
        : (await Promise.all(reportClubIds.map(async (clubId) => canReviewMemberships(clubId, req.profile)))).some(Boolean)
          ? budgets[0]?.spent || 0
          : 0,
      clubReports,
    });
  } catch (error) { next(error); }
});

app.get('/', (req, res) => res.json({ name: 'CampusSphere API', health: '/api/health' }));

app.use((req, res, next) => next(new HttpError(404, `API route not found: ${req.method} ${req.originalUrl}`)));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.name === 'ValidationError') {
    return res.status(400).json({ error: error.message });
  }
  if (error.name === 'CastError') {
    return res.status(400).json({ error: `Invalid ${error.path}.` });
  }
  if (error.code === 11000) {
    return res.status(409).json({ error: 'A record with those details already exists.' });
  }
  const status = error.status || 500;
  if (status >= 500) console.error('API error:', error);
  return res.status(status).json({ error: status >= 500 ? 'An unexpected server error occurred.' : error.message });
});

async function migrateLegacyData() {
  const database = mongoose.connection.db;
  const profileCollections = await database.listCollections(
    { name: Profile.collection.collectionName },
    { nameOnly: true },
  ).toArray();
  if (profileCollections.length) {
    const profileIndexes = await Profile.collection.indexes();
    const singleAdminIndex = profileIndexes.find((index) => index.unique
      && index.key.role === 1
      && index.partialFilterExpression?.role === roles.admin);
    if (singleAdminIndex) await Profile.collection.dropIndex(singleAdminIndex.name);
  }

  const collections = await database.listCollections({ name: 'clubmembers' }, { nameOnly: true }).toArray();
  if (collections.length) {
    const memberCollection = database.collection('clubmembers');
    const duplicateGroups = await memberCollection.aggregate([
      {
        $group: {
          _id: { clubId: '$clubId', profileId: '$profileId' },
          members: { $push: '$$ROOT' },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
    const positionPriority = {
      member: 0,
      executive: 1,
      office_bearer: 2,
      secretary: 3,
      treasurer: 4,
      vice_president: 5,
      president: 6,
    };
    for (const group of duplicateGroups) {
      const members = group.members.sort((first, second) =>
        (positionPriority[second.position] ?? positionPriority[second.role] ?? 0)
          - (positionPriority[first.position] ?? positionPriority[first.role] ?? 0));
      const keep = members[0];
      await memberCollection.updateOne(
        { _id: keep._id },
        {
          $set: {
            officeBearerGroup: members.some((member) => member.officeBearerGroup === true),
            positionTitle: keep.positionTitle || members.find((member) => member.positionTitle)?.positionTitle || '',
          },
        },
      );
      await memberCollection.deleteMany({ _id: { $in: members.slice(1).map((member) => member._id) } });
    }
    const indexes = await memberCollection.indexes();
    const obsoleteIndex = indexes.find((index) => index.unique
      && index.key.clubId === 1
      && index.key.profileId === 1
      && index.key.positionTitle === 1);
    if (obsoleteIndex) await memberCollection.dropIndex(obsoleteIndex.name);
  }

  await Profile.updateMany({ role: 'faculty' }, { role: roles.faculty });
  await Profile.updateMany({ role: 'admin' }, { role: roles.admin });
  await Profile.updateMany(
    { role: roles.admin, adminType: { $exists: false } },
    { $set: { adminType: 'student_affairs' } },
  );
  await Profile.updateMany({ email: ICTS_EMAIL }, { role: roles.icts });
  await ClubMember.updateMany(
    { membershipStatus: { $exists: false } },
    { $set: { membershipStatus: 'active' } },
  );
  await mongoose.connection.db.collection('clubs').updateMany(
    { mentor: { $exists: false }, facultyCoordinator: { $exists: true } },
    [{ $set: { mentor: '$facultyCoordinator' } }],
  );
  await Club.updateMany(
    { clubType: { $exists: false } },
    { $set: { clubType: 'non_technical' } },
  );
  await ClubMember.updateMany(
    { position: { $exists: false } },
    [{
      $set: {
        position: {
          $switch: {
            branches: [
              { case: { $eq: ['$role', 'executive'] }, then: 'executive' },
              { case: { $eq: ['$role', 'office_bearer'] }, then: 'office_bearer' },
            ],
            default: 'member',
          },
        },
        positionTitle: '',
        officeBearerGroup: { $eq: ['$role', 'office_bearer'] },
      },
    }],
    { updatePipeline: true },
  );
  await mongoose.connection.db.collection('clubmembers').updateMany(
    { role: { $exists: true } },
    { $unset: { role: '' } },
  );
  await Event.updateMany({ status: 'pending' }, { status: 'mentor_pending' });
  await Event.updateMany({ status: { $exists: false } }, { status: 'mentor_pending' });
  const eventsMissingTypes = await Event.find({ eventType: { $exists: false } }, '_id clubId').lean();
  for (const event of eventsMissingTypes) {
    const club = await Club.findById(event.clubId, 'clubType').lean();
    await Event.updateOne(
      { _id: event._id, eventType: { $exists: false } },
      { $set: { eventType: club?.clubType || 'non_technical' } },
    );
  }
  await Club.updateMany(
    { recruitmentOpen: { $exists: false } },
    { $set: { recruitmentOpen: false } },
  );
  await Event.updateMany({ status: 'approved', mentorReviewedBy: { $exists: false } }, {
    $set: { mentorReviewedBy: null },
  });
  const borrowsMissingClub = await EquipmentBorrow.find({ clubId: { $exists: false } }, '_id equipmentId').lean();
  for (const borrow of borrowsMissingClub) {
    const equipment = await Equipment.findById(borrow.equipmentId, 'clubId').lean();
    if (equipment) await EquipmentBorrow.updateOne({ _id: borrow._id }, { clubId: equipment.clubId });
  }

  const eventsMissingCounts = await Event.find({ registeredCount: { $exists: false } }, '_id').lean();
  for (const event of eventsMissingCounts) {
    const count = await EventRegistration.countDocuments({ eventId: event._id, status: { $ne: 'cancelled' } });
    await Event.updateOne({ _id: event._id, registeredCount: { $exists: false } }, { registeredCount: count });
  }
}

if (require.main === module) {
  async function startServer() {
    if (!process.env.MONGO_URI) {
      console.error('MONGO_URI is missing. Add your MongoDB connection string to server/.env.');
      process.exitCode = 1;
      return;
    }

    try {
      await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    } catch (error) {
      console.error(`MongoDB connection failed (${error.name}). Check server/.env, Atlas network access, and the database user's credentials.`);
      await mongoose.disconnect();
      process.exitCode = 1;
      return;
    }

    try {
      await migrateLegacyData();
      console.log('MongoDB connected and legacy profiles/events migrated.');
      const tlsOptions = await loadTlsOptions();
      const server = tlsOptions
        ? https.createServer(tlsOptions, app).listen(PORT, () => console.log(`CampusSphere API listening on https://localhost:${PORT} (TLS 1.2+)`))
        : app.listen(PORT, () => console.log(`CampusSphere API listening on port ${PORT} (TLS_MODE=off: TLS must be terminated by a proxy)`));
      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`Port ${PORT} is already in use. Stop the existing server, then start CampusSphere again.`);
        } else {
          console.error(`CampusSphere could not listen on port ${PORT} (${error.code || error.name}).`);
        }
        mongoose.disconnect().catch((disconnectError) => {
          console.error(`MongoDB disconnect failed (${disconnectError.name}).`);
        }).finally(() => {
          process.exitCode = 1;
        });
      });
    } catch (error) {
      console.error(`CampusSphere legacy-data migration failed (${error.name}${error.code ? `, code ${error.code}` : ''}): ${error.message}`);
      await mongoose.disconnect();
      process.exitCode = 1;
    }
  }

  startServer();
}

module.exports = app;