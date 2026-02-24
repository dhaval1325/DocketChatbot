import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("logistics.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS dockets (
    id TEXT PRIMARY KEY,
    customer_name TEXT,
    delivery_address TEXT,
    status TEXT DEFAULT 'Pending',
    pod_verified BOOLEAN DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Seed some data if empty
const rowCount = db.prepare("SELECT count(*) as count FROM dockets").get() as { count: number };
if (rowCount.count === 0) {
  const insert = db.prepare("INSERT INTO dockets (id, customer_name, delivery_address) VALUES (?, ?, ?)");
  insert.run("DKT-1001", "John Doe", "123 Maple St, Springfield");
  insert.run("DKT-1002", "Jane Smith", "456 Oak Ave, Metropolis");
  insert.run("DKT-1003", "Acme Corp", "789 Industrial Way, Gotham");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.get("/api/dockets/:id", (req, res) => {
    const docket = db.prepare("SELECT * FROM dockets WHERE id = ?").get(req.params.id);
    if (docket) {
      res.json(docket);
    } else {
      res.status(404).json({ error: "Docket not found" });
    }
  });

  app.post("/api/dockets/:id/update", (req, res) => {
    const { status, pod_verified } = req.body;
    const result = db.prepare(
      "UPDATE dockets SET status = ?, pod_verified = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(status, pod_verified ? 1 : 0, req.params.id);

    if (result.changes > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Docket not found" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
