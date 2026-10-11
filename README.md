# Amrita Sangam

Amrita Sangam is a college-club management portal. The project is organized into `frontend/` (React/Vite) and `backend/` (FastAPI). FastAPI manages Supabase Auth sessions with secure cookies; MongoDB stores profiles and campus records.

## Run locally

Use Python 3.10 or newer and Node.js 20.19+.

1. Create a Supabase project and a MongoDB database.
2. Copy `frontend/.env.example` to `frontend/.env`. The API URL defaults to the local FastAPI service.
3. Copy `backend/.env.example` to `backend/.env`. Add the MongoDB URI and Supabase server settings. Keep the MongoDB URI and service-role key private.
   - Set `ICTS_EMAIL` to the email for the ICTS login you create in Supabase Auth.
   - Set `CLIENT_ORIGIN` to the browser origin running Vite (normally `http://localhost:5173`).
   - Keep `COOKIE_SAMESITE=none` for the local HTTP Vite page talking to the HTTPS API. Cookies remain `Secure` and `HttpOnly`; the API also checks the exact configured browser origin on every write request.
4. Start the FastAPI service:

   ```powershell
   cd backend
   python -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   python -m app.seed --demo
   python -m app.main
   ```

   The API listens at `https://localhost:5000`; its health endpoint is `https://localhost:5000/api/health`. In development, the backend creates a self-signed localhost certificate in `backend/certs/`.
5. In another terminal, start the frontend:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

   Open the local URL printed by Vite, normally `http://localhost:5173`. Accept the local API certificate warning once so the browser can connect to FastAPI.

## Identity and account creation

The browser sends sign-in, password-change, and password-reset requests to FastAPI over HTTPS. Supabase Auth validates sign-in credentials and manages passwords. Forgot-password sends a recovery OTP to the account email; entering the code and a new password verifies it with Supabase before updating the credential. Configure SMTP in Supabase and set the recovery email template to display the OTP (`{{ .Token }}`) rather than relying only on a recovery link. After a successful sign-in, FastAPI creates a random, revocable session in MongoDB and sends its opaque identifier in a `Secure`, `HttpOnly`, `SameSite` cookie; only a hash of that identifier is stored in MongoDB. Normal API requests look up the session and profile in MongoDB and do not call Supabase. Sessions expire after 30 days, and MongoDB removes expired session records. Write requests must have the configured `CLIENT_ORIGIN`. Sign-out revokes the MongoDB session and clears the cookie.

Supabase Auth manages personal and newly provisioned or updated club account passwords. For those club accounts, `clubcredentials` stores only the Supabase user ID and email mapping. Historical club accounts with a legacy PBKDF2 password hash remain supported until their password is reset through the ICTS approval flow; these hashes cannot be converted back into Supabase passwords. ICTS credential changes remain encrypted in MongoDB only while pending approval/application, and are removed when applied or rejected.

1. Set `ICTS_EMAIL` in `backend/.env`. In Supabase Dashboard → **Authentication → Users**, create the ICTS login with that email. Disable public sign-ups so accounts are issued only by ICTS.
2. Sign in as ICTS and use **Account desk** to create:
   - **Admins**: Student Affairs, Principal, or Other authority.
   - **Faculty**: name, email, password, department, and joining year. Department and year are selected from dropdowns. Faculty departments are ECE, EEE, Mechanical Engineering (MEE), Mathematics (MAT), Physics (PHY), Chemistry (CHE), English (ENG), CSE, Management & Commerce / MBA Programs (MBA), and CIR; faculty IDs use the selected department code.
   - **Students**: name, email, password, department, joining year, and a department-specific section selected from a dropdown. CSE uses A/B/C, AIE D/E/F, AID G, ECE H/I/J, EAC K, EEE L, ELC M, and MEE N. Student IDs use Bangalore campus (`BL`) and the four-year undergraduate code (`U4`); the school code follows the department, and class-roll ranges advance by section in groups of 100 (for example, CSE sections A/B/C start at 001/101/201).
3. Account creation provisions the Supabase Auth identity and a MongoDB profile. ICTS can edit account details, department, role, login email, and (optionally) set a new password at any time; changing department/year/section reissues the corresponding faculty ID or student register number. ICTS can permanently delete issued accounts and their linked campus records; the ICTS account cannot edit or delete itself.
4. Student Affairs manages clubs and college-level approvals. Assigned faculty mentors manage club rosters and review club requests. Plain club executives retain event, funding, equipment, and report submission actions. Office bearers using personal sign-in can use club chats but cannot recruit/review applications, propose or edit events, request equipment or funding, submit event reports, view reports/transactions, publish announcements, or remove members. Signing in with the shared club email and password opens that club's scoped workspace directly, where the user can review membership applications, view the roster, propose events, request funding and equipment, submit event reports, and view report counts/details. API authorization limits the shared session to its configured club. Because the credentials are shared, sign-in notifications to active office bearers and assigned mentors record when the club account was used but cannot identify the individual using it.

### Club shared sign-in and credential approvals

Student Affairs/admins can set a club's shared login email and password while creating or editing it; both are required for initial setup. Club accounts are provisioned in Supabase Auth, and their MongoDB record contains only the Supabase identity/email mapping. ICTS requests club email/password changes from the **Club logins** tab. Student Affairs approves or rejects each request; ICTS must apply an approved request before the new credentials become active. A pending password is encrypted only until application or rejection, never displayed, and removed from MongoDB afterward. Club sign-in accepts the Supabase-managed shared email and password and immediately opens a session scoped to that club. Historical clubs with legacy password hashes continue to work until ICTS resets their passwords through this flow. Each successful login sends an in-app notification to its active office bearers and assigned faculty mentors with the club name and login time; shared credentials do not identify the individual using them. The workspace includes that club's membership applications and roster, event proposals, equipment and funding requests, event reports, and report counts/details. Ordinary personal sign-in retains the restricted office-bearer dashboard.

The supplied directory contains no shared club login emails or passwords, so none are invented; Student Affairs or ICTS must configure those details before shared login can be used.

The profile response and ICTS account list classify known account types as student or faculty and derive the school from the issued school code, roll-number prefix, faculty ID, or mapped department. Unknown school codes remain unclassified. This classification does not grant admin privileges; those remain assigned explicitly by ICTS.

## Configuration

Do not share or commit `.env` files. Frontend variables prefixed with `VITE_` are embedded into browser assets and must not contain secrets.

| Variable | Location | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `frontend/.env` | FastAPI URL, normally `https://localhost:5000/api`. |
| `MONGO_URI` | `backend/.env` | MongoDB URI. Never expose it to the browser. |
| `SUPABASE_URL` | `backend/.env` | Supabase endpoint used by FastAPI. |
| `SUPABASE_ANON_KEY` | `backend/.env` | Used by FastAPI for Supabase Auth login and password operations. |
| `SUPABASE_SERVICE_ROLE_KEY` | `backend/.env` only | Privileged key used for account provisioning and deletion. |
| `ICTS_EMAIL` | `backend/.env` | Email mapped to the ICTS role. `SUPER_ADMIN_EMAIL` is a legacy alias. |
| `CLIENT_ORIGIN` | `backend/.env` | Browser origin allowed by FastAPI CORS. |
| `COOKIE_SAMESITE` | `backend/.env` | Cookie SameSite policy: `none`, `lax`, or `strict`. `none` is needed for the local HTTP frontend with the HTTPS API; use `lax` for a same-site HTTPS deployment where possible. |
| `PORT` | `backend/.env` | API port; defaults to `5000`. |
| `TLS_KEY_PATH`, `TLS_CERT_PATH` | `backend/.env` | Optional TLS private key and certificate paths. |
| `TLS_MODE`, `NODE_ENV` | `backend/.env` | `TLS_MODE=off` is only for a deployment behind a TLS-terminating proxy. |

## MongoDB and existing data

FastAPI uses PyMongo and the existing MongoDB collections directly; it does not replace or reset the database. Current profiles, clubs, memberships, applications, events, registrations, attendance, budgets, funding requests, equipment, messages, and reports remain in their collections. Startup applies the existing legacy-field and role migrations and preserves the existing data.

MongoDB Atlas `mongodb+srv://` connections use TLS by default. Back up a production database before deploying schema or application changes.

## Club logos and event posters

Admins can upload PNG logos when creating or editing clubs and configure the club-specific domains shown on membership applications. Applicants provide their year of study, phone number, selected domain, and reason; reviewers can see these details alongside the student's issued name, register number, and department.

On startup, the backend ensures the supplied campus directory exists: the listed student clubs and eight requested venues are added without replacing existing records, and the existing Squad entry is renamed to its full supplied name. New clubs start with recruitment closed and no assigned faculty mentor; Student Affairs must assign a mentor and open recruitment before they can accept applications or propose club events. DASTHAN, Aarohan - Science Fair, and department-specific Freshers groups are represented as non-login campus event organizers. Student Affairs can create events for those organizers and select multiple clubs or organizer groups as co-hosts, supporting joint departmental Freshers events and club collaborations. These organizer records do not create user sign-in accounts.

The campus directory includes the provided faculty mentor names and affiliations and supports multiple mentors per club. ICTS can create faculty accounts from the regular account form; a matching faculty profile is linked to its listed clubs automatically. A mentor's provided campus affiliation is directory information and does not replace the faculty department selected for their account.

Active plain club executives and the shared club account can add a PNG, JPEG, or WebP poster when proposing an event. Event proposals require a hosting club, venue, start time, and end time and can include co-host clubs. Every assigned mentor of each participating club must approve before Student Affairs; participating clubs must have at least one assigned mentor. Technical proposals also include optional fields based on the Technical Event Proposal Form, including category, IIC activity, quarter, program level/theme, SDG alignment, participants, resource-person details, outcomes, budget and impact analysis. These details are saved with the event; they do not change the approval stages. The app shows occupied venues for overlapping time ranges and the API checks availability again when saving. The app resizes images before saving them to the existing MongoDB club/event records; uploads are validated and size-limited by the API. Events without an uploaded poster still show a generated Amrita Sangam poster. The Overview page automatically rotates through upcoming events in a split hero carousel, with the poster on the left and event details on the right. Arrow and dot controls allow manual navigation; hovering or focusing the carousel pauses autoplay. Selecting an event opens an animated details carousel, where attendees can register after confirming.

The shared club account for an event’s host club is the only account that can take or update attendance; mentors and all admin accounts can review event proposals but cannot edit attendance. Active plain club executives and the shared club account can submit event reports and funding requests. A Create report button opens a form for an eligible completed event. The detailed report collects multi-select promotion, event category, program type, theme, SDG, session mode and resource-person data, internal/external participant counts and remarks, and activity-completion values with remarks. It includes a detailed report limited to 1,000 words, a brochure/flyer upload, and four photograph uploads. Every assigned mentor of every participating club must approve event reports and proposals before Student Affairs reviews them. Each funding request must select an event hosted by its club; all mentors of each participating event club review it before Student Affairs. Funding is added to the club budget and ledger only after Student Affairs approves it. Once an event report is submitted, its OD attendance CSV contains exactly two columns: student name and issued roll number.

Eligible club executives and the shared club account can request available equipment through a form that selects the club’s event and collects a return date and optional purpose. All assigned mentors of each participating event club review the request before Student Affairs; only Student Affairs can make the final decision and complete the loan.

The Funding page lists each request's club, application date, requested amount, reason, and review status. It also charts recorded debit transactions by club and purpose for users with funding access.

Membership, event, funding, equipment-borrow, and event-report review records include reviewer history where applicable. Removing a club member ends the membership while retaining its history; authorized club reviewers can include past members in the roster. Status filters are available on the main review queues.

The seed command requires an explicit `--demo` flag. Seeded sample records carry a `Demo data` label, and the dashboard displays a notice when those records are present; do not use sample records as evidence of live campus activity.

The dashboard notification bell and page badges highlight pending applications, office-bearer invitations, event proposals, funding requests, event reports, announcements, unread Club chat messages, and club shared-account sign-ins for the relevant role. Notifications refresh while the dashboard is open; opening a chat room marks its messages as read, and newly seen announcements are marked on the Announcements page.

## Appearance

The sign-in screen, student/staff dashboard, and ICTS Account Desk support light and dark themes. Use the sun/moon button in the top bar (or on the sign-in screen); the selection is saved in the browser for the next visit.

## TLS

Development runs with HTTPS using an automatically generated self-signed certificate for localhost. In production, set `NODE_ENV=production` and provide `TLS_KEY_PATH` and `TLS_CERT_PATH`. If a reverse proxy terminates TLS, set `TLS_MODE=off` and protect the proxy-to-API connection.

## Checks

Run the backend tests from `backend/` with `python -m pytest`. Run the frontend checks from `frontend/` with `npm run lint` and `npm run build`.
