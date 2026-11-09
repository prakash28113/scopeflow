import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GOOGLE_HINT, WRONG_PASSWORD, resendError, signInError, signUpOutcome } from "@/lib/auth-flow";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
/** Words a person can read on the sign-in screens: string literals and JSX text, not code or comments. */
function visibleText(code: string) {
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const strings = [...noComments.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2]);
  const jsx = [...noComments.matchAll(/>([^<>{}\n]+)</g)].map((m) => m[1]);
  return [...strings, ...jsx].filter((t) => /[a-z] [a-z]/i.test(t));
}

describe("T2-04 Google-only accounts", () => {
  it("a wrong password keeps the generic error and adds the Google line for everyone", () => {
    expect(signInError({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" })).toBe(WRONG_PASSWORD);
    expect(WRONG_PASSWORD).toBe("Incorrect email or password.");
    expect(GOOGLE_HINT).toBe("Signed up with Google? Use 'Continue with Google' above.");
    const login = src("src/routes/auth.tsx");
    // Shown on the error itself, not on anything the server said about the address.
    expect(login).toContain("{f.error === WRONG_PASSWORD && googleSignInAvailable ? (");
    expect(login).toContain("{GOOGLE_HINT}");
  });
  it("the same answer whether or not the address has an account (password or Google)", () => {
    const answers = [
      { status: 400, code: "invalid_credentials", message: "Invalid login credentials" }, // wrong password, unknown address or Google-only: Supabase says the same
      { status: 400, message: "Invalid login credentials" },
    ].map(signInError);
    expect(new Set(answers).size).toBe(1);
    // Sign-up: an existing address gets the same screen as a new one.
    expect(signUpOutcome({ user: null, session: null }, { status: 422, code: "user_already_exists", message: "User already registered" }, "help@scopeflow.in")).toEqual({ kind: "check-inbox" });
    expect(resendError({ status: 400, message: "User not found" })).toBeNull();
  });
  it("no message on the sign-in screens says whether an email exists", () => {
    const reveal = /already (exists|registered|has an account|in use|taken)|(no|not an?) (account|user)|(account|user|email) (was )?not found|doesn.t exist|isn.t registered|not registered|unknown (email|user)|we (couldn.t|could not) find/i;
    for (const file of ["src/routes/auth.tsx", "src/lib/auth-flow.ts", "src/components/google-signin.tsx", "src/lib/recovery.ts"]) {
      const bad = visibleText(src(file)).filter((t) => reveal.test(t) && !/already registered\|already exists/.test(t));
      expect(bad, file).toEqual([]);
    }
    // Forgot password keeps its single neutral message.
    expect(src("src/routes/auth.tsx")).toMatch(/If (an|there.s an) account/i);
  });
});
