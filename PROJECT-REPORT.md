# Amrita Sangam Website Report

This report describes the current website in plain language: what screens exist, what users can do in them, how the source folders are organized, and where the main behavior lives.

## 1. Project at a glance

- **Product:** Amrita Sangam, a college club and campus-activity management portal.
- **Frontend:** React 18 with Vite, written in JSX and styled with CSS.
- **Visual design:** Responsive frosted-glass surfaces with a saved light/dark theme, an auto-advancing Overview event hero carousel, and an animated, navigable event-details carousel.
- **Sign-in appearance:** Amrita Sangam wordmark using raspberry `#B50346`, orange `#F7941D`, and a light gray `#EFEFEF` background.
- **Backend:** FastAPI (Python).
- **Data and identity:** MongoDB stores campus records and profiles; Supabase Auth handles login credentials.
- **Main user groups:** students, club executives and office bearers, club presidents, faculty mentors, Student Affairs/college admins, and ICTS account administrators.
- **Page navigation:** The main dashboard changes its displayed page in React state. The dashboard sections do **not** currently have separate URL routes.

## 2. How many pages/screens are there?

There are **13 shared dashboard pages**. The navigation menu shows a role-specific subset of those pages. In addition, there is a sign-in screen and a separate ICTS Account Desk screen. The Account Desk has three in-page tabs (Accounts, Password, and Club logins).

That is **15 top-level screens** (13 dashboard pages, sign-in, and ICTS Account Desk), or **17 view states** when the ICTS Password and Club logins tabs are counted separately. This is a count of screens/views, not separate URL routes.

| Dashboard page | What it does | Who can see it |
| --- | --- | --- |
| **Overview** | Role-specific home page with an auto-advancing upcoming-event hero carousel (poster on the left, event details on the right), activity summaries, shortcuts, and selected campus updates. The carousel pauses on hover/focus and includes arrow and dot controls; selecting a slide opens event details. | All dashboard roles |
| **Explore clubs** | Browse and search clubs, read about them, see their mentor and recruitment status, apply with student details/domain/reason, and (for admins) create or edit clubs and their application domains. | All dashboard roles |
| **Events** | Browse events in a three-column card grid on desktop (two on medium screens and one on phones) and open an animated details carousel with the poster on the left and event information on the right. Navigate events with its arrows or keyboard arrows; proposals include a hosting club, venue, start/end time, and date. Technical proposals show optional fields from the Technical Event Proposal Form and save them with the event while retaining mentor-then-Student-Affairs approval. Club accounts can edit their event until any assigned mentor begins review; afterward the edit control is disabled. Registration and cancellation are confirmed in the details view. The host club’s shared account can see registered attendees and mark attendance as present or absent. | All dashboard roles |
| **Membership** | See the current user's applications and membership progress; assigned mentors and Student Affairs can filter, approve, or reject applications. Review history records reviewer, stage, outcome, date, and feedback. Users can respond to office-bearer invitations. | Students, executives, and mentors |
| **Club members** | Select a managed club and review its active members. Mentors and Student Affairs can edit roles, remove memberships without deleting records, and include past members in the roster. | Mentors and Student Affairs |
| **Club chats** | Read and send messages in a club conversation, with the displayed conversation selected by club and group. Unread messages produce a dashboard notification and club/room unread counts; opening a room marks its messages as read. Club office bearers retain access to member and private office-bearer rooms. | Club members, including office bearers |
| **Equipment** | Browse club equipment, open a request form that selects the club event and captures a return date and optional purpose, return an active loan, and review the mentor-to-Student-Affairs approval workflow. The verified club account can edit its pending borrowing request until mentor review begins; the edit control is disabled afterward. Only Student Affairs can decide the second-stage review. Authorized managers can add equipment. | Student Affairs, mentors, eligible club executives, and verified club accounts |
| **Funding** | View eligible funding requests, request funding for a selected club event as a plain executive, and review requests as an assigned mentor or Student Affairs. The verified club account can edit its pending request until mentor review begins; the edit control is disabled afterward. Funding is added to the club budget and ledger only after Student Affairs approves it; Student Affairs can set budgets and record transactions. | Student Affairs, mentors, plain executives, and verified club accounts |
| **Reports** | View club/member/event/application summary figures and a per-club activity/budget table, including submitted event-report counts; eligible users can export a CSV. A verified office-bearer session sees only its verified club's report data. | Student Affairs; verified office bearers (their club only) |
| **Event reports** | Assigned mentors and Student Affairs review submitted post-event reports, download the OD roster (name and roll number only), and provide written rejection feedback. Plain executives and office bearers with a verified shared club session can open Create report for an eligible completed event. The verified club account can edit its report until mentor review begins and can download its attendance roster; the edit control is disabled after review starts. | Student Affairs and mentors; executives and verified office bearers |
| **Announcements** | Read campus and club notices, including high-priority notices. New notices receive a NEW marker and clear from the unread count when the page is opened. Student Affairs and assigned mentors can post announcements; office bearers and executives can only view them. | All dashboard roles |
| **Club login changes** | Admins can set a shared club email while creating or editing a club; the email is shown only in admin-managed club data. Student Affairs reviews ICTS requests to change an existing club's shared email or password. Approval alone does not activate an ICTS-requested change; ICTS applies it. | Admins and Student Affairs |
| **My profile** | View issued account details, edit phone number and biography, upload/remove a profile image, and change the password. | All dashboard roles |

### Role-based page availability

The actual menu is calculated from the user's role and club membership/position. A person with multiple memberships is assigned one dashboard track according to the app's role-priority logic.

| Dashboard track | Pages in the menu |
| --- | --- |
| Student | Overview, Explore clubs, Events, Membership, Announcements, My profile |
| Club executive | Overview, Explore clubs, Events, Membership, Club chats, Announcements, My profile |
| Club office bearer | Personal sign-in uses the restricted executive-style dashboard and chat access. After shared club verification, may propose/edit events, request equipment/funding, submit/revise event reports, and view/export that club's report counts; does not gain recruitment review, member removal, announcement publishing, or transaction access. |
| Faculty mentor | Overview, Explore clubs, Events, Membership, Club members, Equipment, Funding, Event reports, Announcements, My profile |
| Student Affairs / college admin | Overview, Explore clubs, Events, Equipment, Funding, Reports, Event reports, Announcements, Club login changes, My profile (Student Affairs only) |
| ICTS | Separate Account Desk; it is not part of the dashboard menu |

The dashboard notification bell and page badges surface pending applications/invitations, event proposals, funding requests, reports, unread announcements, unread club chat messages, and verified shared-club sign-ins. A successful club sign-in is possible only after both the shared club credentials and the user's personal Supabase account are verified and the active office-bearer membership is checked. Other active office bearers and club mentors receive the actor and sign-in time. Review queues for events, membership, funding, and event reports can be filtered by status; review history is shown where applicable. Notification lists refresh while the dashboard is open. The availability of individual actions is permission-checked in the interface and API; seeing events does not automatically allow a user to approve them.

The backend startup migration ensures the supplied directory of 56 student clubs, eight campus venues, and 16 non-login event organizers (DASTHAN, Aarohan - Science Fair, and Freshers groups for all 14 student/faculty department codes) exists. The directory lists the supplied faculty mentors and affiliations and supports multiple linked mentor accounts per club. Matching faculty accounts created by ICTS are automatically linked to their listed clubs. Student Affairs creates events for the campus event organizers; those events remain in the Student Affairs approval queue. Events can list multiple club or organizer co-hosts, so combined Freshers events and club tie-ups can be represented. Newly added clubs require Student Affairs to assign a mentor and open recruitment before student applications or club-led events are available.

## 3. Sign-in and ICTS screens

### Sign-in

- Collects email and password and sends the sign-in request to the FastAPI service.
- Supports club shared sign-in followed by individual personal-account verification; the shared account password alone never creates a session.
- Provides a forgot-password flow that requests an email OTP and accepts the verified code with a new password.
- The frontend checks the current server session when the app starts.
- On successful sign-in, the app loads the matching Amrita Sangam profile and directs ICTS users to the account desk or other users to their role-based dashboard.
- Displays a connection/error screen when session or profile loading fails.
- Offers a light/dark theme toggle; the selected theme is stored in the browser.

### ICTS Account Desk

- **Accounts tab:** Create administrator, faculty, and student accounts; search, filter, and edit issued account details; optionally change an account password; permanently delete an account and associated campus records.
- **Club logins tab:** ICTS requests a shared club email/password change, sees Student Affairs approval status, and applies only approved changes. The UI does not display saved club passwords.
- ICTS account creation keeps name, email, and password as text fields; account type, authority designation, department, joining year, and student section are dropdowns. Faculty departments are ECE, EEE, Mechanical Engineering (MEE), Mathematics (MAT), Physics (PHY), Chemistry (CHE), English (ENG), CSE, Management & Commerce / MBA Programs (MBA), and CIR. For students, department controls the valid section list: CSE A/B/C, AIE D/E/F, AID G, ECE H/I/J, EAC K, EEE L, ELC M, and MEE N. The school code follows the department. Student IDs use the fixed `BL` Bangalore campus and `U4` four-year undergraduate codes; the three-section departments assign section roll ranges starting at 001/101/201, while a one-section department starts at 001.
- **Password tab:** Change the ICTS user's password.
- Account creation provisions the login through Supabase Auth and creates the campus profile in MongoDB.
- The profile response identifies known accounts as student or faculty and derives school from their issued school code, roll-number prefix, or mapped department; this classification does not assign administrative authority.
- This screen is separate from the shared dashboard and is only shown to the ICTS role.

## 4. Important user workflows

- **Joining a club:** An admin configures club-specific application domains. A student chooses a domain and year of study, adds a phone number and reason, and sees application status in Membership. Reviewers see the student's name, register number, department, and submitted application details.
- **Club leadership:** Mentors or other authorized users can invite active members to leadership roles. The nominee must respond to the invitation.
- **Planning an event:** A plain active executive or the shared club account proposes an event with its hosting club, venue, start time, and end time; co-host clubs may be included. Every assigned mentor of every participating club must approve before Student Affairs reviews. Approved events accept registrations through a Yes/No confirmation in the details dialog; only the shared account for the host club can record attendance. Office bearers cannot propose or edit events.
- **Closing an event:** A plain active executive or the shared club account submits or revises a report after the event. The report includes multi-select promotion, event-category, program-type, theme, SDG, delivery-mode and resource-person sections with remarks; internal/external participant counts; activity-completion details; a detailed report limited to 1,000 words; and uploads for a brochure/flyer and four photographs. Every assigned mentor of every participating club must approve before Student Affairs. The OD roster contains only student name and roll number. Office bearers cannot submit reports or access report dashboards.
- **Borrowing equipment:** Active plain executives or the shared club account submit a loan request linked to an event. Every assigned mentor of every participating event club must approve before Student Affairs; the borrower can record a return. Office bearers cannot request equipment.
- **Managing club finances:** Plain executives or the shared club account make funding requests linked to an event. Every assigned mentor of every participating event club must approve before Student Affairs; funding is written to the ledger and allocation only after final approval. Rejections require feedback. Admins can manage budgets and transactions. Office bearers cannot request funding or access transactions/budget reports.
- **Campus updates:** Student Affairs and assigned club mentors publish announcements; other roles can view club and campus notices in Announcements and selected notices on Overview.
- **Shared club sign-in:** The shared club email/password is managed by Supabase Auth and opens a session scoped to that club without secondary personal verification. MongoDB stores the club-to-Supabase identity mapping. Other active office bearers and assigned mentors receive a notification when the club account is used.
- **Club credential changes:** Student Affairs may set credentials during club creation or editing. For ICTS-requested changes, Student Affairs approves/rejects the request and ICTS applies an approved change. Pending passwords are encrypted until application or rejection, then removed from MongoDB; newly provisioned or updated credentials are managed by Supabase Auth and never returned by the API. Historical PBKDF2 club hashes remain supported until reset. No club login email or password is invented from the mentor directory.
- **Account administration:** ICTS issues or removes accounts. Supabase Auth manages credentials; MongoDB holds application profiles and associated campus records.

## 5. Frontend source structure

Files and folders below exclude installed dependencies, virtual environments, generated output, and local environment files.

```text
frontend/
├── index.html                 Browser document, title, description, and app mount point
├── package.json               Frontend scripts and dependency list
├── package-lock.json          Locked frontend dependency versions
├── README.md                  Frontend-specific notes
├── .env.example               Example frontend API configuration
├── vite.config.js             Vite development/build configuration
├── eslint.config.js           Frontend linting rules
├── public/
│   └── amrita-symbol.jpg      Browser tab icon
└── src/
    ├── main.jsx               Starts React and loads global styles
    ├── index.css              Global font, color, and reset styles
    ├── App.css                Dashboard, forms, cards, dialogs, responsive layout styles
    ├── components/
    │   └── PortalBrand.jsx    Reusable Amrita Sangam wordmark
    ├── pages/
    │   └── App.jsx            Sign-in, ICTS desk, dashboard pages, and most UI components
    └── services/
        └── api.js             Shared JSON API requests and CSV downloads
```

### Frontend organization observations

- The filename `pages/App.jsx` is currently the single main application implementation, not a directory of individual page files. It contains the sign-in flow, role-based dashboard, all twelve dashboard page bodies, the ICTS desk, dialogs, the Overview event hero carousel, and numerous smaller components.
- The dashboard uses in-memory state for page selection; browser URLs do not identify the selected page.
- `App.css` contains most of the product-specific layout and component styling, including responsive layouts and glass-like card treatments. `index.css` sets global defaults, design tokens, and smooth scrolling (with reduced-motion support).
- `api.js` centralizes requests to the backend and includes credentials so the browser's session cookie is sent.

## 6. Frontend component inventory

There are **32 React components declared in `src/pages/App.jsx`**, plus the `PortalBrand` component in its own file.

| Component | What it is responsible for |
| --- | --- |
| `App` | Checks the session/profile and selects the sign-in, error/loading, ICTS, or standard dashboard view. |
| `AuthScreen` | Sign-in form, authentication feedback, and the email OTP password-reset flow. |
| `IctsDashboard` | Account creation, search/filtering, account editing/deletion, and ICTS password tab. |
| `IctsEditAccountModal` | ICTS editor for profile, login email/password, role, department, and issued ID details. |
| `Dashboard` | Shared role-based dashboard shell, navigation, data loading, page content, and user actions. |
| `ProfilePage` | Profile photo/contact/about fields and password settings. |
| `PasswordCard` | Password-change form with validation and status feedback. |
| `Modal` | Reusable dialog/form for club applications, club creation/editing, events, announcements, equipment, budgets, transactions, and funding requests. |
| `PortalBrand` | Reusable Amrita Sangam wordmark shown on the sign-in screen. |
| `Avatar` | Displays a user's uploaded picture or generated initials fallback. |
| `StatCard` | A dashboard metric card. |
| `ReportStat` | A compact summary metric used by Reports. |
| `SectionHeading` | Standard heading, explanatory text, and optional action link for a content section. |
| `ClubCard` | Club information, recruitment state, membership/application status, and join/edit action. |
| `EventRow` | Event summary, poster, status, and approval controls. |
| `EventDetailsDialog` | Expanded event description, date/time, venue, and capacity details, plus registration/cancellation confirmation. |
| `AttendancePanel` | Attendance recording and attendee list for an approved event. |
| `Modal` | Shared event, technical proposal, equipment request, funding request, and report forms. |
| `ReportRow` | Post-event report details, approval actions, roster download, and rejected-report revision form. |
| `ApplicationRow` | Membership application details and permitted approval/rejection actions. |
| `PositionInvitation` | Shows a leadership-position invitation and lets the invited member respond. |
| `MemberRow` | A club member's details and permitted role/removal controls. |
| `ParticipationRow` | A student's past event participation record. |
| `EquipmentCard` | Equipment availability plus borrow/return controls. |
| `BorrowApprovalRow` | Equipment loan request status and approval/rejection controls. |
| `FundingRow` | Funding request details and review actions. |
| `TransactionRow` | A budget ledger entry. |
| `AnnouncementRow` | Compact announcement display used in feed/summary areas. |
| `EmptyState` | Reusable explanatory message shown when a list has no records. |

`App.jsx` also contains non-visual helper functions for role/track selection, role-specific navigation, date and currency formatting, status labels, initials, image resizing, legacy browser-session cleanup, and page descriptions.

## 7. Backend and data structure

```text
backend/
├── requirements.txt           Python dependencies
├── .env.example               Example backend configuration
├── certs/                      Local HTTPS development certificate location
├── app/
│   ├── main.py                FastAPI setup, middleware, error handling, TLS startup, route registration
│   ├── config.py              Reads server settings from environment
│   ├── database.py            MongoDB connection, legacy-data migration, serialization
│   ├── auth.py                Shared authentication/session and permission helpers
│   ├── seed.py                Creates/updates clearly labeled demo venues, clubs, events, budgets, and equipment (`--demo` required)
│   ├── models/                Model package
│   ├── schemas/               Schema package
│   ├── routes/
│   │   ├── auth.py            Sign-in, current session, sign-out, password change
│   │   ├── public.py          Health and public club/event/announcement reads
│   │   ├── profiles.py        Profile access/update and ICTS account provisioning/deletion
│   │   ├── clubs.py           Club management, memberships, position invitations, applications
│   │   ├── events.py          Event approvals, registration, venues, attendance, event reports
│   │   └── campus.py          Announcements, budgets, funding, transactions, equipment, chats, summaries
│   └── services/
│       ├── common.py          Shared route/service behavior
│       ├── media.py           Image handling and validation
│       └── supabase.py        Supabase Auth and account operations
└── tests/
    └── test_api.py            Backend API tests
```

The application exposes **65 API routes** across the route modules, plus the API root endpoint. In broad terms:

- **Authentication:** FastAPI validates Supabase Auth credentials and issues a revocable, cookie-based application session. MongoDB stores a hash of the session identifier.
- **Profiles:** Profiles include campus roles and issued IDs; ICTS account creation/deletion connects Supabase identities with MongoDB profiles.
- **Clubs:** Club records and their application domains, mentors, member roles, position invitations, and applications with applicant study/contact details.
- **Events:** Event proposals and approvals, venue records and time-slot availability checks, registrations, attendance, and post-event reports/rosters.
- **Campus services:** Announcements, funding requests, budgets, transactions, equipment inventory/loans, club messages, and report summaries.
- **Database startup:** Existing MongoDB records are migrated for legacy role/field formats and indexes are applied; startup does not replace the existing database.

The backend uses existing MongoDB collections directly. Supabase Auth is the credential authority; passwords are not stored in the application profile collection. The frontend's `.env` and backend's `.env` are local configuration files and should remain private.

## 8. Good next improvements

These are opportunities suggested by the current structure, not claims that the features are broken.

1. **Split `App.jsx` by responsibility.** It combines application startup, account management, dashboard state, twelve page bodies, and many reusable components. Moving these into dedicated page/component files would make changes easier to find and test.
2. **Add URL-based page navigation.** Use routes for dashboard sections so a user can refresh, bookmark, or share a page and use browser Back/Forward naturally. Keep role-based access checks when adding routes.
3. **Add frontend tests for key workflows.** Prioritize sign-in/session recovery, role-based navigation, membership review, event approval/registration, and event-report approval/resubmission.
4. **Document a role/action permission matrix.** The interface already varies navigation and actions by role and club membership; a compact matrix would make expected access easier to review and maintain.
5. **Review responsive and accessibility behavior page by page.** The styles include a mobile layout and visible keyboard focus styles; test forms, dialogs, status feedback, and data-heavy pages on small screens and with keyboard/screen-reader navigation.
6. **Make user-facing behavior easier to discover.** For example, adding visible explanations for approval stages and clear empty/loading/error states can help first-time students and club leaders understand what to do next.

## 9. Running checks

- Backend tests: run `python -m pytest` from `backend/`.
- Frontend lint: run `npm run lint` from `frontend/`.
- Frontend production build: run `npm run build` from `frontend/`.

See the repository `README.md` for environment setup, local startup steps, and deployment configuration.
