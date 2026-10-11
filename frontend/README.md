# Amrita Sangam frontend

The Amrita Sangam frontend is a React 18 application built with Vite. Supabase Auth handles email/password sessions; the FastAPI backend validates the session and serves campus data.

Copy `.env.example` to `.env`, add the Supabase project URL and anon key, and run:

```powershell
npm install
npm run dev
```

The API defaults to `https://localhost:5000/api`. Set `VITE_API_URL` to change it. See the [project setup guide](../README.md) for FastAPI, MongoDB, seed, and first-admin setup.
