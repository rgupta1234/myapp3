const http = require("http");
const fs = require("fs");
const { Pool } = require("pg");

// Connection: PG* env vars, or DATABASE_* from "oc set env --from=secret/postgresql"
const pool = new Pool({
  host: process.env.PGHOST || "postgresql",
  user: process.env.PGUSER || process.env.DATABASE_USER,
  password: process.env.PGPASSWORD || process.env.DATABASE_PASSWORD,
  database: process.env.PGDATABASE || process.env.DATABASE_NAME,
  max: 5,
});
const msg = process.env.BUILD_MESSAGE || "Hola";
const build = process.env.OPENSHIFT_BUILD_NAME || "local";
const builtAt = fs.readFileSync("build-time.txt", "utf8").trim();
const baseVersion = fs.existsSync("/etc/base-image-version")
  ? fs.readFileSync("/etc/base-image-version", "utf8").trim()
  : "unknown";
let ready = false;

async function init() {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS visits (id SERIAL PRIMARY KEY, build TEXT NOT NULL, visited_at TIMESTAMPTZ NOT NULL DEFAULT now())"
  );
  ready = true;
  console.log(">>> myapp started: " + msg + " build=" + build + " base=" + baseVersion + " db=connected");
}
(function connect() {
  init().catch((e) => {
    console.log(">>> waiting for database: " + e.message);
    setTimeout(connect, 3000);
  });
})();

http.createServer(async (req, res) => {
  if (req.url === "/healthz") {
    try {
      await pool.query("SELECT 1");
      res.writeHead(ready ? 200 : 503);
      res.end(ready ? "ok" : "initializing");
    } catch (e) {
      res.writeHead(503);
      res.end("database unavailable");
    }
    return;
  }
  if (req.url !== "/") { res.writeHead(404); res.end(); return; }
  try {
    await pool.query("INSERT INTO visits (build) VALUES ($1)", [build]);
    const count = await pool.query("SELECT count(*)::int AS n FROM visits");
    const ver = await pool.query("SHOW server_version");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      '<div style="background:#EE0000;color:#fff;padding:32px;font:60px sans-serif">' + msg +
      "<br><small>Built " + builtAt + " (" + build + ")</small>" +
      "<br><small>Base image: " + baseVersion + "</small></div>" +
      '<div style="padding:16px 32px;font:20px sans-serif">Visits stored in PostgreSQL ' +
      ver.rows[0].server_version + ": <b>" + count.rows[0].n + "</b></div>"
    );
  } catch (e) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("Database unavailable: " + e.message);
  }
}).listen(8080);
