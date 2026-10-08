# CampusSphere

CampusSphere is a college-club management portal. The project is organized into `frontend/` (React/Vite) and `backend/` (FastAPI). FastAPI manages Supabase Auth sessions with secure cookies; MongoDB stores profiles and campus records.

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

Supabase Auth hashes account passwords with bcrypt. CampusSphere never stores plaintext passwords or password hashes in MongoDB; ICTS-issued passwords are sent directly to Supabase Auth over HTTPS.

1. Set `ICTS_EMAIL` in `backend/.env`. In Supabase Dashboard → **Authentication → Users**, create the ICTS login with that email. Disable public sign-ups so accounts are issued only by ICTS.
2. Sign in as ICTS and use **Account desk** to create:
   - **Admins**: Student Affairs, Principal, or Other authority.
   - **Faculty**: name, email, password, department, and joining year. A faculty ID is generated.
   - **Students**: the same fields; a student register number is generated.
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

Admins can upload PNG logos when creating or editing clubs. Club presidents can add a PNG, JPEG, or WebP poster when proposing an event. The app resizes images before saving them to the existing MongoDB club/event records; uploads are validated and size-limited by the API. Events without an uploaded poster still show a generated CampusSphere poster, and selecting one opens its details in a dialog.

## TLS

Development runs with HTTPS using an automatically generated self-signed certificate for localhost. In production, set `NODE_ENV=production` and provide `TLS_KEY_PATH` and `TLS_CERT_PATH`. If a reverse proxy terminates TLS, set `TLS_MODE=off` and protect the proxy-to-API connection.

## Checks

Run the backend tests from `backend/` with `python -m pytest`. Run the frontend checks from `frontend/` with `npm run lint` and `npm run build`.
