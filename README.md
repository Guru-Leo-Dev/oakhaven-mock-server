# Oakhaven — Full Stack (Frontend + Mock Backend)

This folder contains two pieces:

- **`oakhaven-frontend/`** — the production React frontend (see its own
  `README.md` for full details).
- **`mock-server/`** — a small, dependency-free Node script that stands in
  for the real User/Product/Order microservices, so you can run and click
  through the entire frontend without standing up the actual backend.

## Quickest way to try it: Docker Compose

```bash
docker compose up --build
```

Then open **http://localhost:3000**.

- Frontend: `http://localhost:3000`
- Mock API: `http://localhost:8081/api`

Log in with the seeded demo account: **demo@oakhaven.test / password123**
(or just register a new one — it's all in-memory).

## Running without Docker

In one terminal:

```bash
cd mock-server
node server.js
# Oakhaven mock API listening on http://localhost:4000/api
```

In another terminal:

```bash
cd oakhaven-frontend
npm install
echo "VITE_API_BASE_URL=http://localhost:4000/api" > .env
npm run dev
```

Then open the Vite dev URL it prints (typically `http://localhost:5173`).

## What the mock server does

- Seeds 6 categories (Sofas, Chairs, Tables, Beds, Storage, Lighting) and
  ~24 products with varying stock levels, so you can see the in-stock,
  low-stock, and out-of-stock states on the Product Detail page.
- Implements register/login with real in-memory sessions (fake JWT-style
  tokens), so `GET /users/me` and protected routes behave correctly.
- Simulates the real backend's async order settlement: a new order is
  `PENDING`, becomes `CONFIRMED` after ~2.5s, then resolves to `PAID`
  (or, about 12% of the time, `FAILED`, so you can see that state too)
  after ~5.5s — mirroring the real system's inventory check → Kafka event
  → payment simulation flow that the Order Confirmation page's "Refresh
  Status" button is built around.
- Has no persistence — all data resets when the process restarts.

This is a development/demo aid only, not a reference implementation of the
real microservices.
