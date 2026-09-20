const input = await new Promise((resolve, reject) => {
  process.stdin.setEncoding("utf8");
  process.stdin.once("data", (chunk) => {
    try { resolve(JSON.parse(chunk)); } catch { reject(new Error("Expected JSON input.")); }
  });
  process.stdin.once("error", reject);
});

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("Supabase environment configuration is unavailable in this validation session.");

async function signIn(email, password) {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token || !body.user?.id) {
    return { ok: false, error: typeof body.error_description === "string" ? body.error_description : "Sign-in rejected." };
  }
  return { ok: true, accessToken: body.access_token, userId: body.user.id };
}

async function directoryCheck(accessToken, userId) {
  const response = await fetch(`${url}/rest/v1/rpc/search_mtu_students`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_query: "" }),
  });
  const body = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(body)) return { ok: false, error: typeof body.message === "string" ? body.message : "Directory query failed." };
  const self = body.find((profile) => profile?.id === userId || profile?.is_self === true);
  return { ok: true, profileCount: body.length, selfFound: Boolean(self), studentId: typeof self?.student_id === "string" ? self.student_id : "" };
}

const mtu = await signIn(input.mtuEmail, input.mtuPassword);
const gmail = await signIn(input.gmailEmail, input.gmailPassword);
const result = {
  mtuLogin: mtu.ok,
  gmailLogin: gmail.ok,
  mtuError: mtu.ok ? "" : mtu.error,
  gmailError: gmail.ok ? "" : gmail.error,
  mtuDirectory: mtu.ok ? await directoryCheck(mtu.accessToken, mtu.userId) : null,
  gmailDirectory: gmail.ok ? await directoryCheck(gmail.accessToken, gmail.userId) : null,
};

console.log(JSON.stringify(result));
