import type { Metadata } from "next";
import { Newsreader, Source_Sans_3 } from "next/font/google";
import { headers } from "next/headers";
import { Shell } from "@/components/shell";
import { loadWorkspace } from "@/lib/workspace";
import "./globals.css";

const source = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-source",
});

const mark = Newsreader({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-mark",
});

export const metadata: Metadata = {
  title: "EPIK Sales Intelligence",
  description: "Internal sales operations, Slack message intake, and review.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const path = (await headers()).get("x-epik-path") ?? "/";
  const workspace = await loadWorkspace();
  const mode = workspace.kind === "ready" ? workspace.mode : "blocked";
  return (
    <html lang="en" className={`${source.variable} ${mark.variable}`}>
      <body>
        <div className="app-background" aria-hidden="true" />
        <div className="app-background-overlay" aria-hidden="true" />
        {path === "/access" ? (
          <div className="min-h-screen px-4 py-10">
            <div className="mx-auto w-full max-w-md">{children}</div>
          </div>
        ) : (
          <Shell path={path} mode={mode} health={workspace.health}>{children}</Shell>
        )}
      </body>
    </html>
  );
}
