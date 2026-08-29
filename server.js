/**
 * Oakhaven mock API gateway.
 *
 * A tiny, dependency-free stand-in for the real User/Product/Order
 * microservices, so the Oakhaven frontend can be run and clicked through
 * end-to-end without the real backend. Not for production use.
 *
 * Implements exactly the endpoints the frontend calls:
 *   POST /api/users/register
 *   POST /api/users/login
 *   GET  /api/users/me
 *   GET  /api/products
 *   GET  /api/products/category/:category
 *   GET  /api/products/categories
 *   GET  /api/products/:id
 *   POST /api/orders
 *   GET  /api/orders/:id
 *   GET  /api/orders/user/:userId
 */

const http = require("http");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 4000;

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const CATEGORIES = ["Sofas", "Chairs", "Tables", "Beds", "Storage", "Lighting"];

const ADJECTIVES = [
  "Oakview",
  "Harbor",
  "Linden",
  "Bramble",
  "Meadow",
  "Alder",
  "Coastal",
  "Willow",
];
const NOUNS = {
  Sofas: ["Sofa", "Loveseat", "Sectional", "Daybed"],
  Chairs: ["Armchair", "Accent Chair", "Dining Chair", "Recliner"],
  Tables: ["Coffee Table", "Dining Table", "Console Table", "Side Table"],
  Beds: ["Bed Frame", "Headboard", "Platform Bed", "Bunk Bed"],
  Storage: ["Bookshelf", "Sideboard", "Wardrobe", "Console"],
  Lighting: ["Floor Lamp", "Pendant Light", "Table Lamp", "Sconce"],
};
const MATERIALS = ["Oak", "Walnut", "Linen", "Bouclé", "Rattan", "Ash"];

let nextProductId = 1;
const PRODUCTS = [];
CATEGORIES.forEach((category) => {
  NOUNS[category].forEach((noun, i) => {
    const adjective = ADJECTIVES[(nextProductId + i) % ADJECTIVES.length];
    const material = MATERIALS[(nextProductId * 2 + i) % MATERIALS.length];
    const price = Math.round((150 + ((nextProductId * 37) % 950)) * 100) / 100;
    // Vary stock so the UI's out-of-stock / low-stock states are all visible.
    const stockCycle = [0, 2, 4, 12, 30, 8];
    const stock = stockCycle[nextProductId % stockCycle.length];

    PRODUCTS.push({
      id: nextProductId,
      name: `${adjective} ${material} ${noun}`,
      category,
      price,
      description: `The ${adjective} ${noun.toLowerCase()} brings ${material.toLowerCase()} craftsmanship into everyday use — built to hold up to real life, not just showrooms.`,
      stock,
      // Themed to the category (so sofas look like sofas, chairs like
      // chairs) but locked to a unique seed per product id, so items in
      // the same category don't all render the same picture.
      image: `https://loremflickr.com/600/450/${encodeURIComponent(
        category.toLowerCase(),
      )},furniture?lock=${nextProductId}`,
    });
    nextProductId += 1;
  });
});

const USERS = [
  {
    id: 1,
    name: "Demo Shopper",
    email: "demo@oakhaven.test",
    password: "password123",
  },
];
let nextUserId = 2;

/** token -> userId */
const SESSIONS = new Map();

let nextOrderId = 1001;
const ORDERS = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sendJson = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });

const paginate = (items, page = 0, size = 12) => {
  const start = page * size;
  const content = items.slice(start, start + size);
  return {
    content,
    number: page,
    size,
    totalElements: items.length,
    totalPages: Math.max(Math.ceil(items.length / size), 1),
    first: page === 0,
    last: start + size >= items.length,
  };
};

const sortProducts = (items, sortParam) => {
  if (!sortParam) return items;
  const [field, direction] = sortParam.split(",");
  const sorted = [...items].sort((a, b) => {
    if (typeof a[field] === "string") {
      return a[field].localeCompare(b[field]);
    }
    return a[field] - b[field];
  });
  return direction === "desc" ? sorted.reverse() : sorted;
};

const getAuthedUser = (req) => {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !SESSIONS.has(token)) return null;
  const userId = SESSIONS.get(token);
  return USERS.find((u) => u.id === userId) || null;
};

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
});

const issueSession = (user) => {
  const token = crypto.randomBytes(20).toString("hex");
  SESSIONS.set(token, user.id);
  return token;
};

/**
 * Simulates the real backend's async settlement (inventory check, Kafka
 * event, payment simulation): a fresh order starts PENDING, moves to
 * CONFIRMED, then resolves to PAID (or occasionally FAILED, to exercise
 * that UI state too).
 */
const scheduleSettlement = (order) => {
  setTimeout(() => {
    order.status = "CONFIRMED";
  }, 2500);

  setTimeout(() => {
    order.status = Math.random() < 0.12 ? "FAILED" : "PAID";
  }, 5500);
};

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const params = url.searchParams;

  try {
    // ---- Users --------------------------------------------------------
    if (path === "/api/users/register" && req.method === "POST") {
      const body = await readBody(req);
      if (!body.email || !body.password || !body.name) {
        return sendJson(res, 400, {
          message: "name, email and password are required.",
        });
      }
      if (USERS.some((u) => u.email === body.email)) {
        return sendJson(res, 409, {
          message: "An account with that email already exists.",
        });
      }
      const user = {
        id: nextUserId++,
        name: body.name,
        email: body.email,
        password: body.password,
      };
      USERS.push(user);
      const token = issueSession(user);
      return sendJson(res, 201, { token, user: publicUser(user) });
    }

    if (path === "/api/users/login" && req.method === "POST") {
      const body = await readBody(req);
      const user = USERS.find(
        (u) => u.email === body.email && u.password === body.password,
      );
      if (!user) {
        return sendJson(res, 401, { message: "Invalid email or password." });
      }
      const token = issueSession(user);
      return sendJson(res, 200, { token, user: publicUser(user) });
    }

    if (path === "/api/users/me" && req.method === "GET") {
      const user = getAuthedUser(req);
      if (!user) return sendJson(res, 401, { message: "Not authenticated." });
      return sendJson(res, 200, publicUser(user));
    }

    // ---- Products -------------------------------------------------------
    if (path === "/api/products/categories" && req.method === "GET") {
      return sendJson(res, 200, CATEGORIES);
    }

    if (
      path.match(/^\/api\/products\/category\/[^/]+$/) &&
      req.method === "GET"
    ) {
      const category = decodeURIComponent(path.split("/").pop());
      const page = Number(params.get("page") || 0);
      const size = Number(params.get("size") || 12);
      const filtered = sortProducts(
        PRODUCTS.filter(
          (p) => p.category.toLowerCase() === category.toLowerCase(),
        ),
        params.get("sort"),
      );
      return sendJson(res, 200, paginate(filtered, page, size));
    }

    if (path === "/api/products" && req.method === "GET") {
      const page = Number(params.get("page") || 0);
      const size = Number(params.get("size") || 12);
      const sorted = sortProducts(PRODUCTS, params.get("sort"));
      return sendJson(res, 200, paginate(sorted, page, size));
    }

    if (path.match(/^\/api\/products\/\d+$/) && req.method === "GET") {
      const id = Number(path.split("/").pop());
      const product = PRODUCTS.find((p) => p.id === id);
      if (!product)
        return sendJson(res, 404, { message: "Product not found." });
      return sendJson(res, 200, product);
    }

    // ---- Orders -----------------------------------------------------------
    if (path === "/api/orders" && req.method === "POST") {
      const body = await readBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) {
        return sendJson(res, 400, {
          message: "Order must include at least one item.",
        });
      }

      const lineItems = items.map((item) => {
        const product = PRODUCTS.find((p) => p.id === Number(item.productId));
        return {
          productId: item.productId,
          name: product?.name || "Unknown product",
          price: product?.price || 0,
          quantity: item.quantity,
        };
      });
      const total = lineItems.reduce(
        (sum, li) => sum + li.price * li.quantity,
        0,
      );
      const shipping = total >= 500 ? 0 : 15;

      const order = {
        id: nextOrderId++,
        userId: body.userId,
        items: lineItems,
        total: Math.round((total + shipping) * 100) / 100,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      };
      ORDERS.push(order);
      scheduleSettlement(order);
      return sendJson(res, 201, order);
    }

    if (path.match(/^\/api\/orders\/user\/.+$/) && req.method === "GET") {
      const userId = decodeURIComponent(path.split("/").pop());
      const list = ORDERS.filter((o) => String(o.userId) === userId);
      return sendJson(res, 200, list);
    }

    if (path.match(/^\/api\/orders\/[^/]+$/) && req.method === "GET") {
      const id = Number(path.split("/").pop());
      const order = ORDERS.find((o) => o.id === id);
      if (!order) return sendJson(res, 404, { message: "Order not found." });
      return sendJson(res, 200, order);
    }

    return sendJson(res, 404, {
      message: `No mock route for ${req.method} ${path}`,
    });
  } catch (err) {
    return sendJson(res, 500, {
      message: "Mock server error",
      detail: err.message,
    });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Oakhaven mock API listening on http://localhost:${PORT}/api`);
  // eslint-disable-next-line no-console
  console.log(`Demo login: demo@oakhaven.test / password123`);
});
