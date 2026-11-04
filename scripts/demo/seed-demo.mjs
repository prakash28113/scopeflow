/**
 * DEMO WORKSPACE (sample data only). Seeds a fictional freelancer, "Raman Studio", with fictional
 * Indian clients, projects in every state and rupee amounts, against the LOCAL Supabase stand-in
 * (tests/e2e/stack.mjs). Used only to capture real ScopeFlow screens for marketing; every visual made
 * from it is labelled "Sample data". Never run against production.
 *
 *   POSTGREST_BIN=… node tests/e2e/stack.mjs &   then   node scripts/demo/seed-demo.mjs
 */
import { readFileSync } from "node:fs";

const API = process.env.DEMO_API ?? "http://127.0.0.1:54321";
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(API)) throw new Error("The demo seed only runs against a local stand-in.");
const { anon: ANON } = JSON.parse(readFileSync(new URL("../../tests/e2e/keys.json", import.meta.url), "utf8"));
export const DEMO = { email: "demo@raman.studio.test", password: "demo-workspace-2026", name: "Priya Raman", business: "Raman Studio" };

async function call(path, body, token) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const rpc = (fn, args, token) => call(`/rest/v1/rpc/${fn}`, args, token);
async function rows(path, token) {
  const res = await fetch(`${API}/rest/v1/${path}`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}
const milestonesOf = (project, token) => rows(`milestones?project_id=eq.${project}&select=id,title,amount_cents&order=position`, token);

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
};

const session = await call("/auth/v1/signup", { email: DEMO.email, password: DEMO.password, data: { full_name: DEMO.name } });
const T = session.access_token;
// The demo shows every feature, so it runs on Studio (the local stand-in's plan switch, like admin_set_plan).
await fetch(`${API}/auth/v1/__test/plan?email=${encodeURIComponent(DEMO.email)}&plan=studio`);
await rpc("complete_onboarding", { p_full_name: DEMO.name, p_business_name: DEMO.business, p_currency: "INR" }, T);
await rpc("set_invoice_details", { p: { business_address: "4th floor, Road No. 12\nBanjara Hills, Hyderabad 500034", gstin: "36ABCPR1234K1Z5", invoice_prefix: "RS", state_code: "36", sac_code: "998391" } }, T);
await rpc("set_payment_details", { p_upi_id: "ramanstudio@okaxis" }, T);

/** Approves the latest sent version as the client, like the client page does. */
async function clientApproves(token, name) {
  const view = await rpc("portal_view", { p_token: token });
  await rpc("portal_decide_scope", { p_token: token, p_snapshot_id: view.snapshot.id, p_decision: "approved", p_client_name: name, p_comment: null });
  return rpc("portal_view", { p_token: token });
}

// ---------------------------------------------------------------- 1. Chai & Co.: in progress, change order, part payment
const chai = await rpc("save_project", {
  p_project_id: null,
  p: {
    title: "Brand kit for Chai & Co.",
    summary: "A complete identity for the new tea bar in Jubilee Hills: logo, colours, menu typography and a one-page brand guide.",
    currency: "INR", budget_cents: 0, start_date: day(-14), due_date: day(16),
    exclusions: "Printing and delivery\nPhotography\nWebsite design",
    terms: "50% advance before work starts; balance on delivery. Final files are released after full payment.",
    extra_revision_cents: 150000, discount_bps: 0, tax_bps: 1800, tax_label: "GST", valid_until: day(10),
    client: { name: "Meera Nair", email: "meera@chaiandco.test", company: "Chai & Co." },
    deliverables: [
      { title: "Primary logo", description: "Three concepts, one refined", revisions_included: 2, pricing_type: "fixed", amount_cents: 2000000, due_date: day(2) },
      { title: "Colour and type system", revisions_included: 1, pricing_type: "fixed", amount_cents: 800000, due_date: day(9) },
      { title: "Menu board layouts", revisions_included: 1, pricing_type: "unit", quantity: 3, unit_label: "boards", rate_cents: 300000, due_date: day(14) },
      { title: "Brand guide", revisions_included: 1, pricing_type: "hourly", hours: 6, rate_cents: 150000, due_date: day(16) },
    ],
    milestones: [
      { title: "Advance", amount_cents: 2242000, due_date: day(-12) },
      { title: "On delivery", amount_cents: 2242000, due_date: day(16) },
    ],
  },
}, T);
const chaiLink = await rpc("send_scope", { p_project_id: chai, p_link_days: 30 }, T);
const chaiView = await clientApproves(chaiLink.link.token, "Meera Nair");
const logo = chaiView.deliverables.find((d) => d.title === "Primary logo");
for (const text of ["Can we try the logo in a deeper teal?", "Slightly rounder letters, please."]) {
  await rpc("portal_request_revision", { p_token: chaiLink.link.token, p_kind: "revision", p_deliverable_id: logo.id, p_description: text, p_client_name: "Meera Nair", p_request_id: null });
}
await rpc("portal_request_revision", { p_token: chaiLink.link.token, p_kind: "revision", p_deliverable_id: logo.id, p_description: "One more round with a cup icon next to the name?", p_client_name: "Meera Nair", p_request_id: null });
await rpc("log_client_request", { p_project_id: chai, p: { kind: "new_work", description: "Could you also design a takeaway cup sleeve?", source: "whatsapp", received_on: day(0) } }, T);
const co = await rpc("create_change_order", { p_project_id: chai, p: { title: "Takeaway cup sleeve", description: "One sleeve design in two sizes, print-ready files.", pricing_type: "fixed", amount_cents: 600000, additional_days: 2 } }, T);
const chaiView2 = await rpc("portal_view", { p_token: chaiLink.link.token });
const pendingCo = chaiView2.change_orders.find((c) => c.status === "pending") ?? chaiView2.change_orders[0];
await rpc("portal_decide_change_order", { p_token: chaiLink.link.token, p_change_order_id: pendingCo.id ?? co, p_decision: "approved", p_client_name: "Meera Nair", p_comment: "Approved, thank you!" });
const chaiMilestones = await milestonesOf(chai, T);
const advance = chaiMilestones.find((m) => m.title === "Advance");
await rpc("record_payment", { p_milestone_id: advance.id, p: { amount_cents: 2242000, paid_on: day(-11), method: "upi", reference: "UTR 4471 0938" } }, T);
await rpc("create_invoice", { p_milestone_id: advance.id, p: { due_date: day(7), tax_split: true, sac_code: "998391", notes: "Thank you, Meera!" } }, T);
const sleeve = chaiMilestones.find((m) => /sleeve/i.test(m.title));
if (sleeve) {
  await rpc("create_invoice", { p_milestone_id: sleeve.id, p: { due_date: day(5), tax_split: true, sac_code: "998391" } }, T);
  await rpc("record_payment", { p_milestone_id: sleeve.id, p: { amount_cents: 300000, paid_on: day(-1), method: "bank_transfer", reference: "NEFT 88213" } }, T);
}

// ---------------------------------------------------------------- 2. Tiffin Room: waiting for approval
const tiffin = await rpc("save_project", {
  p_project_id: null,
  p: {
    title: "Menu card and packaging",
    summary: "Menu card, takeaway box label and a WhatsApp catalogue cover for the new Indiranagar outlet.",
    currency: "INR", budget_cents: 0, start_date: day(2), due_date: day(30),
    exclusions: "Food photography\nPrinting", terms: "40% advance, 60% on delivery.",
    extra_revision_cents: 120000, tax_bps: 1800, tax_label: "GST", valid_until: day(12),
    client: { name: "Arjun Mehta", email: "arjun@tiffinroom.test", company: "Tiffin Room" },
    deliverables: [
      { title: "Menu card (2 sides)", revisions_included: 2, pricing_type: "fixed", amount_cents: 1200000, due_date: day(14) },
      { title: "Box label", revisions_included: 2, pricing_type: "fixed", amount_cents: 450000, due_date: day(20) },
      { title: "Catalogue cover", revisions_included: 1, pricing_type: "fixed", amount_cents: 300000, due_date: day(24) },
    ],
    milestones: [
      { title: "Advance", amount_cents: 920400, due_date: day(3) },
      { title: "On delivery", amount_cents: 1380600, due_date: day(30) },
    ],
  },
}, T);
await rpc("send_scope", { p_project_id: tiffin, p_link_days: 30 }, T);

// ---------------------------------------------------------------- 3. Kora Studio: completed, paid in full
const kora = await rpc("save_project", {
  p_project_id: null,
  p: {
    title: "Launch reel for Kora Studio",
    summary: "A 30-second launch reel and three cut-downs for Instagram.",
    currency: "INR", budget_cents: 0, start_date: day(-40), due_date: day(-8),
    terms: "Full payment on delivery.", extra_revision_cents: 200000, tax_bps: 1800, tax_label: "GST",
    client: { name: "Sana Qureshi", email: "sana@korastudio.test", company: "Kora Studio" },
    deliverables: [
      { title: "Launch reel (30 s)", revisions_included: 2, pricing_type: "fixed", amount_cents: 1500000 },
      { title: "Cut-downs", revisions_included: 1, pricing_type: "unit", quantity: 3, unit_label: "cuts", rate_cents: 100000 },
    ],
    milestones: [{ title: "On delivery", amount_cents: 2124000, due_date: day(-8) }],
  },
}, T);
const koraLink = await rpc("send_scope", { p_project_id: kora, p_link_days: 30 }, T);
const koraView = await clientApproves(koraLink.link.token, "Sana Qureshi");
const [koraM] = await milestonesOf(kora, T);
await rpc("create_invoice", { p_milestone_id: koraM.id, p: { due_date: day(0), tax_split: false, sac_code: "998391" } }, T);
await rpc("record_payment", { p_milestone_id: koraM.id, p: { amount_cents: 2124000, paid_on: day(-6), method: "upi", reference: "UTR 5521 7710" } }, T);
await rpc("complete_project", { p_project_id: kora }, T);

// ---------------------------------------------------------------- 4. Anokhi Textiles: in progress, request outside scope
const anokhi = await rpc("save_project", {
  p_project_id: null,
  p: {
    title: "Festive campaign creatives",
    summary: "Diwali campaign: 10 social posts and 2 email banners for the new handloom collection.",
    currency: "INR", budget_cents: 0, start_date: day(-6), due_date: day(9),
    exclusions: "Paid ads management\nCopywriting in Tamil", terms: "50% advance, 50% on delivery.",
    extra_revision_cents: 100000, tax_bps: 1800, tax_label: "GST",
    client: { name: "Ravi Iyer", email: "ravi@anokhi.test", company: "Anokhi Textiles" },
    deliverables: [
      { title: "Social posts", revisions_included: 2, pricing_type: "unit", quantity: 10, unit_label: "posts", rate_cents: 250000, due_date: day(7) },
      { title: "Email banners", revisions_included: 1, pricing_type: "unit", quantity: 2, unit_label: "banners", rate_cents: 400000, due_date: day(9) },
    ],
    milestones: [
      { title: "Advance", amount_cents: 1947000, due_date: day(-5) },
      { title: "On delivery", amount_cents: 1947000, due_date: day(9) },
    ],
  },
}, T);
const anokhiLink = await rpc("send_scope", { p_project_id: anokhi, p_link_days: 30 }, T);
const anokhiView = await clientApproves(anokhiLink.link.token, "Ravi Iyer");
await rpc("record_payment", { p_milestone_id: (await milestonesOf(anokhi, T))[0].id, p: { amount_cents: 1947000, paid_on: day(-5), method: "bank_transfer", reference: "NEFT 66120" } }, T);
await rpc("portal_request_revision", { p_token: anokhiLink.link.token, p_kind: "new_work", p_deliverable_id: null, p_description: "Can you also make a 15-second video ad from the posts?", p_client_name: "Ravi Iyer", p_request_id: null });

// ---------------------------------------------------------------- 5. A draft
await rpc("save_project", {
  p_project_id: null,
  p: {
    title: "Website refresh", currency: "INR", budget_cents: 0, tax_bps: 1800, tax_label: "GST",
    client: { name: "Kabir Shah", email: "kabir@lumen.test", company: "Lumen Architects" },
    deliverables: [{ title: "Home page design", revisions_included: 2, pricing_type: "fixed", amount_cents: 3500000 }],
    milestones: [],
  },
}, T);

console.log(JSON.stringify({ ok: true, ...DEMO, projects: { chai, tiffin, kora, anokhi }, portal: { chai: chaiLink.link.token, tiffin: null, anokhi: anokhiLink.link.token } }));
