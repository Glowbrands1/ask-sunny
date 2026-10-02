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

http
  .createServer((req, res) => {
    const route = routes.find(([prefix]) => req.url === prefix || req.url.startsWith(`${prefix}/`) || req.url.startsWith(`${prefix}?`));
    if (!route) {
      res.writeHead(404).end("no route");
      return;
    }
    const upstream = http.request(
      { host: "127.0.0.1", port: route[1], method: req.method, path: req.url.slice(route[0].length) || "/", headers: req.headers },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", () => res.writeHead(502).end("upstream down"));
    req.pipe(upstream);
  })
  .listen(port, "127.0.0.1", () => console.log(`gateway on ${port}`));
