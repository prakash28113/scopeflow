import { Link } from "react-router";
import { Logo, buttonClass } from "@/components/ui";

const steps = [
  ["Define the scope", "Deliverables, revision limits, budget and payment milestones in one place."],
  ["Get it approved", "Your client approves from a private link — no account. The approved version is locked and fingerprinted."],
  ["Catch scope creep", "Every request is checked against what was approved. Extra rounds and new work are flagged automatically."],
  ["Price the extras", "Send a change order with cost and extra days. Budget, timeline and milestones update when the client approves."],
];

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo className="text-[15px]" />
        <nav className="flex items-center gap-2">
          <Link to="/login" className={buttonClass("ghost", "sm")}>
            Sign in
          </Link>
          <Link to="/signup" className={buttonClass("primary", "sm")}>
            Get started
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="max-w-3xl pb-16 pt-16 sm:pt-28">
          <p className="mb-4 text-[13px] font-medium text-accent">For freelance designers, editors and small studios</p>
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] text-balance sm:text-[56px]">
            Agree on the work. Get paid for the extra work.
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-muted">
            ScopeFlow keeps an approved, unchangeable record of every project scope — so revisions, change orders and payments never
            turn into an argument.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to="/signup" className={buttonClass("primary")}>
              Join the private beta
            </Link>
            <Link to="/login" className={buttonClass("secondary")}>
              Sign in
            </Link>
          </div>
        </section>
        <section className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(([title, body], i) => (
            <div key={title} className="bg-surface p-6">
              <p className="num text-[13px] text-subtle">{String(i + 1).padStart(2, "0")}</p>
              <h2 className="mt-6 text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="mx-auto mt-24 max-w-6xl border-t border-line px-4 py-8 text-[12px] text-muted sm:px-6">
        ScopeFlow tracks payments you record; it doesn't process payments.
      </footer>
    </div>
  );
}
