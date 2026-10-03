# CampusSphere client

The client is a React 18 application built with Vite. Supabase Auth handles email/password sessions; the Express API validates the session and serves campus data.

From this folder, copy `.env.example` to `.env`, add the Supabase project URL and anon key, and run:

```powershell
npm install
npm run dev
```

The API defaults to `http://localhost:5000/api`. Set `VITE_API_URL` to change it. See the [project setup guide](../README.md) for the server, MongoDB, seed, and first-admin setup.
