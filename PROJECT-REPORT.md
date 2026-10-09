# my AMRITA Website Report

This report describes the current website in plain language: what screens exist, what users can do in them, how the source folders are organized, and where the main behavior lives.

## 1. Project at a glance

- **Product:** my AMRITA, a college club and campus-activity management portal.
- **Frontend:** React 18 with Vite, written in JSX and styled with CSS.
- **Visual design:** Responsive frosted-glass surfaces with a saved light/dark theme, an auto-advancing Overview event hero carousel, and an animated, navigable event-details carousel.
- **Sign-in appearance:** Amrita-inspired “my AMRITA” wordmark using raspberry `#B50346`, orange `#F7941D`, and a light gray `#EFEFEF` background.
- **Backend:** FastAPI (Python).
- **Data and identity:** MongoDB stores campus records and profiles; Supabase Auth handles login credentials.
- **Main user groups:** students, club executives and office bearers, club presidents, faculty mentors, Student Affairs/college admins, and ICTS account administrators.
- **Page navigation:** The main dashboard changes its displayed page in React state. The dashboard sections do **not** currently have separate URL routes.

## 2. How many pages/screens are there?

There are **12 shared dashboard pages**. The navigation menu shows a role-specific subset of those pages. In addition, there is a sign-in screen and a separate ICTS Account Desk screen. The Account Desk has two in-page tabs (Accounts and Password).

That is **14 top-level screens** (12 dashboard pages, sign-in, and ICTS Account Desk), or **15 view states** if the ICTS Password tab is counted separately. This is a count of screens/views, not separate URL routes.

| Dashboard page | What it does | Who can see it |
| --- | --- | --- |
| **Overview** | Role-specific home page with an auto-advancing upcoming-event hero carousel (poster on the left, event details on the right), activity summaries, shortcuts, and selected campus updates. The carousel pauses on hover/focus and includes arrow and dot controls; selecting a slide opens event details. | All dashboard roles |
| **Explore clubs** | Browse and search clubs, read about them, see their mentor and recruitment status, apply with student details/domain/reason, and (for admins) create or edit clubs and their application domains. | All dashboard roles |
| **Events** | Browse events in a three-column card grid on desktop (two on medium screens and one on phones) and open an animated details carousel with the poster on the left and event information on the right. Navigate events with its arrows or keyboard arrows; proposals include a hosting club, venue, start/end time, and date. Registration and cancellation are confirmed in the details view. Authorized users can review approvals, take attendance, and submit a post-event report. | All dashboard roles |
| **Membership** | See the current user's applications and membership progress; permitted reviewers can approve or reject applications. Users can also respond to position invitations. Students see their event participation history here. | Students, mentors, presidents, and office bearers |
| **Club members** | Select a managed club, review its active members, and perform permitted member or leadership-role actions. Mentors/admins can also nominate active members for leadership positions. | Student Affairs, mentors, presidents, and office bearers |
| **Club chats** | Read and send messages in a club conversation, with the displayed conversation selected by club and group. | Presidents, office bearers, and executives |
| **Equipment** | Browse club equipment, request to borrow it, return an active loan, and review the mentor-to-Student-Affairs approval workflow. Authorized leaders can add equipment. | Student Affairs, mentors, and presidents |
| **Funding** | Review funding requests and club budgets, see allocation/spending totals, and view recent transactions where accessible. Authorized users can request funds; administrators can set budgets and record transactions. | Student Affairs, mentors, presidents, and office bearers |
| **Reports** | View club/member/event/application summary figures and a per-club activity/budget table; eligible users can export a CSV. | Student Affairs, presidents, and office bearers |
| **Event reports** | Review post-event report status and details, download the attendance/OD roster, approve/reject reports, or revise a rejected report if the user is the president. | Student Affairs, mentors, and presidents |
| **Announcements** | Read campus and club notices, including high-priority notices. Authorized club leaders can post announcements. | All dashboard roles |
| **My profile** | View issued account details, edit phone number and biography, upload/remove a profile image, and change the password. | All dashboard roles |

### Role-based page availability

The actual menu is calculated from the user's role and club membership/position. A person with multiple memberships is assigned one dashboard track according to the app's role-priority logic.

| Dashboard track | Pages in the menu |
| --- | --- |
| Student | Overview, Explore clubs, Events, Membership, Announcements, My profile |
| Club executive | Overview, Explore clubs, Events, Club chats, Announcements, My profile |
| Club office bearer | Overview, Explore clubs, Events, Membership, Club members, Club chats, Funding, Reports, Announcements, My profile |
| Club president | Overview, Explore clubs, Events, Membership, Club members, Club chats, Equipment, Funding, Reports, Event reports, Announcements, My profile |
| Faculty mentor | Overview, Explore clubs, Events, Membership, Club members, Equipment, Funding, Event reports, Announcements, My profile |
| Student Affairs / college admin | Overview, Explore clubs, Events, Club members, Equipment, Funding, Reports, Event reports, Announcements, My profile |
| ICTS | Separate Account Desk; it is not part of the dashboard menu |

The availability of individual actions is also permission-checked in the interface and API. For example, seeing events does not automatically allow a user to approve them.

## 3. Sign-in and ICTS screens

### Sign-in

- Collects email and password and sends the sign-in request to the FastAPI service.
- The frontend checks the current server session when the app starts.
- On successful sign-in, the app loads the matching my AMRITA profile and directs ICTS users to the account desk or other users to their role-based dashboard.
- Displays a connection/error screen when session or profile loading fails.
- Offers a light/dark theme toggle; the selected theme is stored in the browser.

### ICTS Account Desk

- **Accounts tab:** Create administrator, faculty, and student accounts; search and filter issued accounts; permanently delete an account and associated campus records.
- **Password tab:** Change the ICTS user's password.
- Account creation provisions the login through Supabase Auth and creates the campus profile in MongoDB.
- This screen is separate from the shared dashboard and is only shown to the ICTS role.

## 4. Important user workflows

- **Joining a club:** An admin configures club-specific application domains. A student chooses a domain and year of study, adds a phone number and reason, and sees application status in Membership. Reviewers see the student's name, register number, department, and submitted application details.
- **Club leadership:** Mentors or other authorized users can invite active members to leadership roles. The nominee must respond to the invitation.
- **Planning an event:** A club president/executive proposes an event with its hosting club, venue, start time, and end time. Venue availability is checked for overlapping bookings and checked again when the proposal is submitted. The mentor and then Student Affairs review it. Approved events accept registrations through a Yes/No confirmation in the details dialog; eligible leaders can record attendance.
- **Closing an event:** The president submits a report after the event. A roster is generated from attendance records, and the report follows the mentor/Student Affairs review process. Rejected reports can be revised and resubmitted.
- **Borrowing equipment:** Users submit a loan request. The request goes through mentor and Student Affairs approval; the borrower can record a return.
- **Managing club finances:** Authorized users make funding requests. Admins can manage budgets and transactions. Summary figures and CSV export help with reporting.
- **Campus updates:** Authorized leaders publish announcements; users see club and campus notices in Announcements and selected notices on Overview.
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
    │   └── PortalBrand.jsx    Reusable my AMRITA wordmark
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

There are **27 React components declared in `src/pages/App.jsx`**, plus the `PortalBrand` component in its own file.

| Component | What it is responsible for |
| --- | --- |
| `App` | Checks the session/profile and selects the sign-in, error/loading, ICTS, or standard dashboard view. |
| `AuthScreen` | Sign-in form and authentication feedback. |
| `IctsDashboard` | Account creation, account search/filtering, account deletion, and ICTS password tab. |
| `Dashboard` | Shared role-based dashboard shell, navigation, data loading, page content, and user actions. |
| `ProfilePage` | Profile photo/contact/about fields and password settings. |
| `PasswordCard` | Password-change form with validation and status feedback. |
| `Modal` | Reusable dialog/form for club applications, club creation/editing, events, announcements, equipment, budgets, transactions, and funding requests. |
| `PortalBrand` | Reusable my AMRITA wordmark shown on the sign-in screen. |
| `Avatar` | Displays a user's uploaded picture or generated initials fallback. |
| `StatCard` | A dashboard metric card. |
| `ReportStat` | A compact summary metric used by Reports. |
| `SectionHeading` | Standard heading, explanatory text, and optional action link for a content section. |
| `ClubCard` | Club information, recruitment state, membership/application status, and join/edit action. |
| `EventRow` | Event summary, poster, status, approval controls, and attendance/report actions. |
| `EventDetailsDialog` | Expanded event description, date/time, venue, and capacity details, plus registration/cancellation confirmation. |
| `AttendancePanel` | Attendance recording and attendee list for an approved event. |
| `EventReportComposer` | Form for a club president to submit a post-event report. |
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
│   ├── seed.py                Creates/updates demo venues, clubs, events, budgets, and equipment
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

The application exposes **63 API routes** across the route modules, plus the API root endpoint. In broad terms:

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
