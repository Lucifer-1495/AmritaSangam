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
   python -m app.seed
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

The browser sends sign-in and password-change requests to FastAPI over HTTPS. Supabase Auth validates sign-in credentials and manages passwords. After a successful sign-in, FastAPI creates a random, revocable session in MongoDB and sends its opaque identifier in a `Secure`, `HttpOnly`, `SameSite` cookie; only a hash of that identifier is stored in MongoDB. Normal API requests look up the session and profile in MongoDB and do not call Supabase. Sessions expire after 30 days, and MongoDB removes expired session records. Write requests must have the configured `CLIENT_ORIGIN`. Sign-out revokes the MongoDB session and clears the cookie.

Supabase Auth hashes account passwords with bcrypt. Amrita Sangam never stores plaintext passwords or password hashes in MongoDB; ICTS-issued passwords are sent directly to Supabase Auth over HTTPS.

1. Set `ICTS_EMAIL` in `backend/.env`. In Supabase Dashboard → **Authentication → Users**, create the ICTS login with that email. Disable public sign-ups so accounts are issued only by ICTS.
2. Sign in as ICTS and use **Account desk** to create:
   - **Admins**: Student Affairs, Principal, or Other authority.
   - **Faculty**: name, email, password, department, and joining year. A faculty ID is generated.
   - **Students**: name, email, password, department, joining year, school (SC/EN/SB), and section (A/B/C). Student IDs use Bangalore campus (`BL`) and the four-year undergraduate code (`U4`); the next class roll is assigned automatically within each school, department, joining year, and section. For example, `BL.SC.U4CSE25204` is a Computing/CSE student who joined in 2025, in section C, class roll 04.
3. Account creation provisions the Supabase Auth identity and a MongoDB profile. ICTS can permanently delete issued accounts and their linked campus records; the ICTS account cannot delete itself.
4. Admins manage clubs and college-level approvals. Assigned faculty mentors and club office bearers manage their permitted club membership, events, and reports.

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

Active office bearers can add a PNG, JPEG, or WebP poster when proposing an event. Event proposals require a hosting club, venue, start time, and end time and go first to the club mentor, then to Student Affairs. The app shows occupied venues for overlapping time ranges and the API checks availability again when saving. The app resizes images before saving them to the existing MongoDB club/event records; uploads are validated and size-limited by the API. Events without an uploaded poster still show a generated Amrita Sangam poster. The Overview page automatically rotates through upcoming events in a split hero carousel, with the poster on the left and event details on the right. Arrow and dot controls allow manual navigation; hovering or focusing the carousel pauses autoplay. Selecting an event opens an animated details carousel, where attendees can register after confirming.

Active office bearers can submit event reports and funding requests. Both follow mentor review followed by Student Affairs review; either reviewer must provide a reason when rejecting a request. Funding is added to the club budget and ledger only after Student Affairs approves it. Once an event report is submitted, its OD attendance CSV contains exactly two columns: student name and issued roll number.

The Funding page lists each request's club, application date, requested amount, reason, and review status. It also charts recorded debit transactions by club and purpose for users with funding access.

The dashboard notification bell and page badges highlight pending applications, office-bearer invitations, event proposals, funding requests, event reports, announcements, and unread Club chat messages for the relevant role. Notifications refresh while the dashboard is open; opening a chat room marks its messages as read, and newly seen announcements are marked on the Announcements page.

## Appearance

The sign-in screen, student/staff dashboard, and ICTS Account Desk support light and dark themes. Use the sun/moon button in the top bar (or on the sign-in screen); the selection is saved in the browser for the next visit.

## TLS

Development runs with HTTPS using an automatically generated self-signed certificate for localhost. In production, set `NODE_ENV=production` and provide `TLS_KEY_PATH` and `TLS_CERT_PATH`. If a reverse proxy terminates TLS, set `TLS_MODE=off` and protect the proxy-to-API connection.

## Checks

Run the backend tests from `backend/` with `python -m pytest`. Run the frontend checks from `frontend/` with `npm run lint` and `npm run build`.
