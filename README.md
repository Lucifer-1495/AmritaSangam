# CampusSphere

CampusSphere is a college-club management app with a React/Vite client, an Express API, MongoDB for application data, and Supabase Auth for sign-in.

> Supabase Auth and MongoDB are separate services: Supabase stores and verifies login identities, while MongoDB stores CampusSphere profiles and application records.

## Run locally

1. Create a Supabase project and a MongoDB database.
2. Copy `client/.env.example` to `client/.env` and add your Supabase project URL and **publishable/anon** key. Set `VITE_API_URL` to your API URL.
3. Copy `server/.env.example` to `server/.env`. Add the same Supabase URL and anon key, plus your MongoDB connection string. Keep the MongoDB URI private and never put it in the client environment.
   - Add the Supabase **service-role/secret key** to `SUPABASE_SERVICE_ROLE_KEY` in `server/.env` so ICTS can provision accounts. This key must never be placed in `client/.env`, returned to the browser, or committed.
   - Set `ICTS_EMAIL` to the email address of the ICTS account you create in Supabase Auth. Set `CLIENT_ORIGIN` to the browser origin running the client.
4. Install and start the API:

   ```powershell
   cd server
   npm install
   npm run seed
   npm run dev
   ```

5. In a second terminal, install and start React:

   ```powershell
   cd client
   npm install
   npm run dev
   ```

   Open the local URL Vite prints (normally `http://localhost:5173`). The API health endpoint is `http://localhost:5000/api/health`.

## Identity, roles and account creation

The React client uses Supabase Auth for email/password sign-in. It sends the resulting access token to Express; the API verifies that token with Supabase before loading the matching MongoDB profile. Passwords remain in Supabase Auth and are not stored in MongoDB.

1. Set `ICTS_EMAIL` in `server/.env`. In Supabase Dashboard → **Authentication → Users**, create the ICTS login with that same email. Disable public sign-ups so accounts are issued only by ICTS.
2. Sign in as ICTS and use **Account desk** to create:
   - **Admins**: select Student Affairs, Principal or Other authority. Other authority requires a designation. There may be any number of each type; all admin types have the same application permissions.
   - **Faculty**: provide name, email, password, department and joining year. A faculty ID is generated, e.g. `FA23CSE001`.
   - **Students**: provide the same fields. A student ID is generated, e.g. `CSE23001`.
3. Every issued login is created in Supabase Auth and gets a profile document in MongoDB. ICTS is still the only account-creation role and can permanently delete issued accounts from the account list. Deletion removes the Supabase login, MongoDB profile, memberships, applications, registrations, attendance, borrow records and messages; reports submitted by that account are removed, attendee details are scrubbed from retained reports, and shared clubs/events keep no references to the deleted profile. The ICTS account cannot delete itself.
4. Admin accounts manage clubs and college-level approvals. A club's assigned faculty mentor can review membership applications and recruit members even before any office bearers are appointed. After approving an application, the mentor can invite the active member as president, vice president, treasurer, secretary or office bearer, with an optional custom position title; the student must accept the invitation before the role activates. Once appointed, club office bearers can also review applications.

Name, email, department and generated IDs cannot be edited by their owners. Everyone can add a phone number and photo and change their password (My profile).

## Services, keys and configuration

The repository includes placeholder values in `client/.env.example` and `server/.env.example`; it does not include the real key values in this guide. Do not share or commit `.env` files. `client/.env` values prefixed with `VITE_` are embedded in the browser build and must never contain secrets.

| Variable | Location | Purpose / handling |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `client/.env` | Supabase project endpoint used by the Supabase JS client. |
| `VITE_SUPABASE_ANON_KEY` | `client/.env` | Public/publishable Supabase key for client sign-in. Configure Supabase access policies appropriately; it is not an admin secret. |
| `VITE_API_URL` | `client/.env` | Express API base URL, normally `https://localhost:5000/api` in development. |
| `SUPABASE_URL` | `server/.env` | Supabase endpoint used by Express for token verification and account provisioning. |
| `SUPABASE_ANON_KEY` | `server/.env` | Used by Express when validating access tokens with Supabase Auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | `server/.env` only | Privileged Supabase key used to create/delete Auth users. Treat as a password; never expose to the browser, logs, or Git. |
| `MONGO_URI` | `server/.env` only | MongoDB connection URI, including database user credentials. Never send it to the client or share it publicly. |
| `ICTS_EMAIL` | `server/.env` | Email address mapped to the ICTS role. Required; `SUPER_ADMIN_EMAIL` remains as a legacy alias. |
| `CLIENT_ORIGIN` | `server/.env` | Browser origin allowed by Express CORS. |
| `PORT` | `server/.env` | API listening port; defaults to `5000`. |
| `TLS_KEY_PATH`, `TLS_CERT_PATH` | `server/.env` | Optional file paths for the API TLS private key and certificate. Keep the key private. |
| `TLS_MODE`, `NODE_ENV` | `server/.env` | `TLS_MODE=off` is only for a deployment behind a TLS-terminating proxy; production otherwise requires configured certificates. |

The API does not reveal any of these key values. If a real secret has been committed or shared, rotate it in the relevant service and update the local server configuration.

## MongoDB data and cluster

The API connects through Mongoose using `MONGO_URI`. With a MongoDB Atlas `mongodb+srv://` URI, TLS is enabled by the MongoDB driver by default. The app's collections are:

- `profiles` — MongoDB profile, role, and Supabase user ID; it does not contain passwords.
- `clubs`, `clubmembers`, `membershipapplications` — clubs, memberships and applications.
- `events`, `eventregistrations`, `venues`, `attendances`, `eventreports` — event planning, registration and reports.
- `equipment`, `equipmentborrows`, `announcements`, `clubmessages` — club resources and communication.
- `clubbudgets`, `fundingrequests`, `budgettransactions` — club budgets and financial records.
- `counters` — generated student and faculty ID sequences.

MongoDB references between these records use document IDs (for example, a club mentor references a profile, and an event references a club and venue). The API startup migration preserves existing profile documents, fills missing admin type as Student Affairs, and removes the old unique MongoDB index that allowed only one `college_admin`. Back up a production cluster before deploying schema or application migrations.

## TLS (HTTPS)

TLS (Transport Layer Security) encrypts data while it travels between services and uses certificates to identify the server; HTTPS is HTTP carried over TLS. TLS does not by itself encrypt data stored at rest. The API serves HTTPS with TLS 1.2 or newer (and sends an HSTS header when the request is secure).

- **Development:** nothing to configure. On first start the server creates a self-signed certificate for `localhost` in `server/certs/`. Open `https://localhost:5000/api/health` once in your browser and accept the warning, otherwise the React app cannot reach the API. For a certificate your browser trusts, use [mkcert](https://github.com/FiloSottile/mkcert) and set `TLS_KEY_PATH` / `TLS_CERT_PATH`.
- **Production:** set `NODE_ENV=production` with `TLS_KEY_PATH` and `TLS_CERT_PATH` (e.g. Let's Encrypt). If your host terminates TLS itself, set `TLS_MODE=off` and ensure the proxy-to-API network is appropriately protected.
- `VITE_API_URL` must use HTTPS outside local development. The browser-to-API link uses the API TLS certificate; Supabase Auth requests use HTTPS; MongoDB Atlas connections use TLS via the MongoDB driver.
- Deploying the API against the target cluster runs its startup migrations, including the admin index removal and profile type backfill described above. Back up the cluster first and check the API startup logs.

## Included workflows

- Supabase email/password login; Express verifies the Supabase access token before protected requests. ICTS-issued accounts have a Supabase identity and matching MongoDB profile.
- Club discovery and admin club creation.
- Open/closed club recruitment, student membership applications, and office-bearer/admin review with rejection feedback.
- Students can request regular membership or executive consideration. Assigned club mentors and active office bearers can review applications; approved applicants receive the requested member/executive position.
- Admins assign each club a faculty mentor. The assigned mentor can invite active club members to office-bearer positions, including a custom position title; the student accepts or declines the invitation. Mentors can change or end club positions/memberships without deleting the student's account.
- Users can edit their display name; it is synchronized to Supabase Auth metadata and the MongoDB profile while the college email remains the sign-in ID.
- Technical and non-technical clubs; event requests move from the club mentor to Student Affairs before becoming public. Students can register across clubs, subject to capacity.
- Private member and office-bearer group chats, club announcements, and club-scoped member management.
- President-submitted equipment requests and event reports, mentor→admin approvals, attendance tracking, and an authorized OD attendance CSV.
- Funding requests, budgets, transactions, venue, and activity report endpoints.
- Repeatable seed data; running `npm run seed` preserves existing records.

The API returns actionable validation, authorization, and conflict errors. Public read-only pages include clubs, approved events, announcements, and health status; writes and personal records require a valid Supabase session.

## Dashboards

ICTS has the account desk. Admins (Student Affairs, Principal and other authorities), mentors, the club **president**, other office bearers, **executives** (club members) and **regular students** each get a dashboard, all with a Log out button and a Change password form under My profile.
