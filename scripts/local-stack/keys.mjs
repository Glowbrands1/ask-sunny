// Prints the local stack's anon and service_role keys: HS256 JWTs signed with
// the throwaway LOCAL secret. Nothing here is a real credential.
import { createHmac } from "node:crypto";

const secret = process.env.LOCAL_STACK_JWT_SECRET;
if (!secret) throw new Error("LOCAL_STACK_JWT_SECRET is not set");
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const sign = (role) => {
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "supabase-local", role, iat: 1700000000, exp: 4100000000 })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
};
console.log(`LOCAL_ANON_KEY=${sign("anon")}`);
console.log(`LOCAL_SERVICE_ROLE_KEY=${sign("service_role")}`);
