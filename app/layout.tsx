import "@fontsource-variable/inter";
import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: { default: "ScopeFlow", template: "%s · ScopeFlow" },
  description: "Scope, approvals, change orders and payments for freelancers and studios.",
};

export const viewport: Viewport = { themeColor: "#f7f7f5" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
