// The local stack's one URL, standing in for Supabase's API gateway:
//   /auth/v1/*  → Supabase Auth (GoTrue)
//   /rest/v1/*  → PostgREST
// Local only; binds 127.0.0.1.
import http from "node:http";

const port = Number(process.env.GATEWAY_PORT ?? 54321);
const routes = [
  ["/auth/v1", Number(process.env.AUTH_PORT ?? 59999)],
  ["/rest/v1", Number(process.env.REST_PORT ?? 53001)],
];

/* Real Supabase answers browser (cross-origin) calls with CORS headers; the Playwright run needs the same from the stand-in. Local only. */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile, prefer",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "x-total-count, content-range",
};

http
  .createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS).end();
      return;
    }
    const route = routes.find(([prefix]) => req.url === prefix || req.url.startsWith(`${prefix}/`) || req.url.startsWith(`${prefix}?`));
    if (!route) {
      res.writeHead(404).end("no route");
      return;
    }
    const upstream = http.request(
      { host: "127.0.0.1", port: route[1], method: req.method, path: req.url.slice(route[0].length) || "/", headers: req.headers },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, { ...reply.headers, ...CORS });
        reply.pipe(res);
      },
    );
    upstream.on("error", () => res.writeHead(502).end("upstream down"));
    req.pipe(upstream);
  })
  .listen(port, "127.0.0.1", () => console.log(`gateway on ${port}`));
