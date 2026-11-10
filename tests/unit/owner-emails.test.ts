import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { handleNotify, notifyConfigFromEnv, renderOwnerEmail, type NotifyConfig, type QueuedEmail } from "../../supabase/functions/notify/handler";
import { NOTIFY_TYPES, flushOwnerEmails, notifyOn } from "@/lib/notify";
import { flushOwnerEmails as cronFlush } from "../../worker/index";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const cfg: NotifyConfig = { supabaseUrl: "https://db.example", serviceKey: "service-key", brevoKey: "xkeysib-test-key-1234567890", siteUrl: "https://scopeflow.in", fromEmail: "no-reply@scopeflow.in", fromName: "ScopeFlow" };
const item = (o: Partial<QueuedEmail> = {}): QueuedEmail => ({
  id: "e1", kind: "scope_approved", event: "scope.approved", actor_name: "Dana Whitfield", summary: "Scope v2 approved by Dana Whitfield",
  project_id: "11111111-2222-3333-4444-555555555555", project_title: "Brand refresh", to_email: "priya@studio.in", to_name: "Priya Raman", ...o,
});

function world(queue: QueuedEmail[], o: { brevo?: number; claimFails?: boolean } = {}) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")), headers: init?.headers as Record<string, string> });
    if (url.endsWith("/rpc/notify_claim")) return o.claimFails ? new Response("no", { status: 500 }) : new Response(JSON.stringify(queue), { status: 200 });
    if (url.endsWith("/rpc/notify_mark")) return new Response("", { status: 204 });
    if (url.startsWith("https://api.brevo.com/")) return new Response("{}", { status: o.brevo ?? 201 });
    throw new Error(`unexpected ${url}`);
  };
  const flush = () => handleNotify(new Request("https://db.example/functions/v1/notify/flush", { method: "POST" }), cfg, f);
  return { calls, flush, sends: () => calls.filter((c) => c.url.startsWith("https://api.brevo.com/")), marks: () => calls.filter((c) => c.url.endsWith("notify_mark")).map((c) => c.body) };
}

describe("T2-12 what each email says", () => {
  it("has a subject and a plain-text body for every client action", () => {
    const cases: [string, string, RegExp][] = [
      ["scope.approved", "Dana Whitfield approved the scope: Brand refresh", /approved the scope\.\nProject: Brand refresh/],
      ["scope.rejected", "Dana Whitfield asked for changes to the scope: Brand refresh", /asked for changes to the scope before approving/],
      ["revision.requested", "Dana Whitfield requested a revision: Brand refresh", /inside the agreed scope or an extra/],
      ["change_order.approved", "Dana Whitfield approved a change order: Brand refresh", /The extra work is agreed/],
      ["change_order.rejected", "Dana Whitfield declined a change order: Brand refresh", /original scope still stands/],
    ];
    for (const [event, subject, body] of cases) {
      const m = renderOwnerEmail(item({ event }), cfg.siteUrl)!;
      expect(m.subject).toBe(subject);
      expect(m.text).toMatch(body);
      expect(m.text).toContain("Hi Priya Raman,");
      expect(m.text).toContain("Open the project: https://scopeflow.in/projects/11111111-2222-3333-4444-555555555555");
      expect(m.text).toContain("Turn these emails off in Settings → Notifications: https://scopeflow.in/settings");
      expect(m.text).not.toMatch(/\/p[#?/]/); // never the client's private link
    }
    expect(renderOwnerEmail(item({ event: "payment.recorded" }), cfg.siteUrl)).toBeNull();
  });
  it("a client's name can't add lines or headers, and a missing name still reads well", () => {
    const m = renderOwnerEmail(item({ actor_name: "Dana\r\nBcc: x@evil.test", project_title: "A\nB" }), cfg.siteUrl)!;
    expect(m.subject).toBe("Dana Bcc: x@evil.test approved the scope: A B");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(renderOwnerEmail(item({ actor_name: null, to_name: null }), cfg.siteUrl)!.text).toMatch(/^Hi,\n\nYour client approved the scope\./);
  });
});

describe("T2-12 sending", () => {
  it("sends exactly one email per queued event, to the owner only, as plain text", async () => {
    const w = world([item(), item({ id: "e2", event: "change_order.approved", kind: "change_order_decided" })]);
    expect(await (await w.flush()).json()).toEqual({ configured: true, sent: 2, failed: 0 });
    expect(w.sends()).toHaveLength(2);
    const [first] = w.sends();
    expect(first.headers["api-key"]).toBe(cfg.brevoKey);
    expect(first.body).toEqual({
      sender: { name: "ScopeFlow", email: "no-reply@scopeflow.in" },
      to: [{ email: "priya@studio.in", name: "Priya Raman" }],
      subject: "Dana Whitfield approved the scope: Brand refresh",
      textContent: renderOwnerEmail(item(), cfg.siteUrl)!.text,
      tags: ["owner-notification"],
    });
    expect(first.body).not.toHaveProperty("htmlContent"); // no HTML, so no tracking pixel
    expect(first.body).not.toHaveProperty("cc");
    expect(first.body).not.toHaveProperty("bcc");
    expect(w.marks()).toEqual([{ p_id: "e1", p_ok: true, p_error: null }, { p_id: "e2", p_ok: true, p_error: null }]);
    expect(w.calls[0]).toMatchObject({ url: "https://db.example/rest/v1/rpc/notify_claim", body: { p_limit: 10 } });
  });
  it("nothing queued (a switched-off type never reaches the queue): nothing sent", async () => {
    const w = world([]);
    expect(await (await w.flush()).json()).toEqual({ configured: true, sent: 0, failed: 0 });
    expect(w.sends()).toEqual([]);
  });
  it("a failing email provider is recorded for a retry and never throws", async () => {
    const w = world([item()], { brevo: 500 });
    const r = await w.flush();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ configured: true, sent: 0, failed: 1 });
    expect(w.marks()).toEqual([{ p_id: "e1", p_ok: false, p_error: "Brevo answered 500" }]);
    const down = world([], { claimFails: true });
    expect(await (await down.flush()).json()).toEqual({ configured: true, sent: 0, failed: 0, error: "queue" });
  });
  it("without a key it claims nothing and sends nothing; other paths are 404", async () => {
    const w = world([item()]);
    const r = await handleNotify(new Request("https://db.example/functions/v1/notify/flush", { method: "POST" }), { ...cfg, brevoKey: "" }, async () => { throw new Error("no calls expected"); });
    expect(await r.json()).toEqual({ configured: false, sent: 0, failed: 0 });
    expect((await handleNotify(new Request("https://db.example/functions/v1/notify/flush"), cfg, async () => new Response("{}"))).status).toBe(404);
    expect((await handleNotify(new Request("https://db.example/functions/v1/notify/queue", { method: "POST" }), cfg, async () => new Response("{}"))).status).toBe(404);
    expect(w.calls).toEqual([]);
    expect(notifyConfigFromEnv((n) => ({ SUPABASE_URL: "https://x.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "s", BREVO_API_KEY: " k " })[n])).toEqual({ supabaseUrl: "https://x.supabase.co", serviceKey: "s", brevoKey: "k", siteUrl: "https://scopeflow.in", fromEmail: "no-reply@scopeflow.in", fromName: "ScopeFlow" });
  });
});

describe("T2-12 the app side", () => {
  it("the client's page nudges the sender without waiting, and survives any failure", async () => {
    const seen: [string, RequestInit][] = [];
    flushOwnerEmails("https://x.supabase.co/", (async (u: string, i: RequestInit) => { seen.push([u, i]); throw new Error("offline"); }) as never);
    expect(seen).toEqual([["https://x.supabase.co/functions/v1/notify/flush", { method: "POST", mode: "no-cors", keepalive: true }]]);
    expect(() => flushOwnerEmails(undefined, (() => { throw new Error("x"); }) as never)).not.toThrow();
    expect(() => flushOwnerEmails("https://x.supabase.co", (() => { throw new Error("sync"); }) as never)).not.toThrow();
    const forms = src("src/routes/portal-forms.tsx");
    expect(forms).toMatch(/const done = async \(message\?: string\) => \{\s+flushOwnerEmails\(\);/);
  });
  it("the scheduled job retries what's left", async () => {
    const urls: string[] = [];
    expect(await cronFlush({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon" }, (async (u: string) => { urls.push(u); return new Response("{}"); }) as never)).toBe(true);
    expect(urls).toEqual(["https://x.supabase.co/functions/v1/notify/flush"]);
    expect(await cronFlush({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon" }, (async () => { throw new Error("down"); }) as never)).toBe(false);
  });
  it("Settings has one switch per email, default on, shown only when emails can be sent", () => {
    expect(NOTIFY_TYPES.map((t) => t.key)).toEqual(["scope_approved", "changes_requested", "change_order_decided"]);
    expect(notifyOn({}, "scope_approved")).toBe(true);
    expect(notifyOn(null, "changes_requested")).toBe(true);
    expect(notifyOn({ scope_approved: false }, "scope_approved")).toBe(false);
    const settings = src("src/routes/settings.tsx");
    expect(settings).toContain('{OWNER_EMAILS_ENABLED ? (\n          <SettingsSection title="Notifications"');
    expect(settings).toContain('supabase.rpc("set_notification_prefs", { p: { [key]: on } })');
    expect(settings).toContain("Nothing is ever sent to your client.");
  });
  it("the release switches it on only with a Brevo key, and never prints the key", () => {
    const release = src("scripts/ci/release.mjs");
    expect(release).toContain('VITE_OWNER_EMAILS: ownerEmailsOn ? "on" : ""');
    expect(release).toContain('{ name: "BREVO_API_KEY", value: key }');
    expect(release).not.toMatch(/log\([^)]*\$\{key\}/);
    expect(src(".github/workflows/release.yml")).toContain("BREVO_API_KEY: ${{ secrets.BREVO_API_KEY }}");
  });
});
