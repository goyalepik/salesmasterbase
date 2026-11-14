import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import { headers } from "next/headers";
import { SimpleShell } from "@/components/simple-shell";
import { APP_ROLE_HOME, pathAllowed } from "@/lib/app-roles";
import { publicStatusPath } from "@/lib/public-status";
import { assistantStatus } from "@/lib/ai/runtime";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/ops-ui/actor";
import { loadWorkspace } from "@/lib/workspace";
import "./globals.css";

const source = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-source",
});

const mark = Newsreader({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-mark",
});

export const metadata: Metadata = {
  title: "EPIK Operations",
  description: "Orders from sale to installation: payments, stock, dispatch and delivery.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const path = (await headers()).get("x-epik-path") ?? "/";
  const [workspace, session] = await Promise.all([loadWorkspace(), currentSession()]);
  // A personal sign-in for someone taken off the Team roles list: back to the sign-in page.
  if (session.kind === "removed" && path !== "/access" && !path.startsWith("/status/")) redirect("/access?error=removed");
  const actor = session.name;
  const ownLook = path === "/" || path.startsWith("/status/") || path.startsWith("/tracker") || path.startsWith("/cx") || path.startsWith("/insights") || path.startsWith("/mis");
  // Sales and Inventory see only their own pages; an old link to another page lands on their start page.
  if (!ownLook && session.kind !== "removed" && !pathAllowed(session.role, path)) redirect(APP_ROLE_HOME[session.role]);
  const mode = workspace.kind === "ready" ? workspace.mode : "blocked";
  return (
    <html lang="en" className={`${source.variable} ${mark.variable}`}>
      <body>
        {path.startsWith("/status/") ? (
          // The salespeople's no-login order status page: no shell, no menus.
          <>
            <div className="app-background" aria-hidden="true" />
            <div className="app-background-overlay" aria-hidden="true" />
            {children}
          </>
        ) : path === "/" || path.startsWith("/tracker") || path.startsWith("/cx") || path.startsWith("/insights") || path.startsWith("/mis") ? (
          // The EPIK home and the Team Tracker have their own light look, without the operations shell.
          children
        ) : (
          <>
            <div className="app-background" aria-hidden="true" />
            <div className="app-background-overlay" aria-hidden="true" />
            {path === "/access" ? (
              <div className="min-h-screen px-4 py-10">
                <div className="mx-auto w-full max-w-md">{children}</div>
              </div>
            ) : (
              <SimpleShell
                path={path}
                mode={mode}
                health={workspace.health}
                actorName={actor}
                role={session.role}
                canSwitchRole={session.kind === "admin"}
                signedIn={session.kind === "person" ? "person" : "admin"}
                assistant={assistantStatus()}
                statusLink={publicStatusPath()}
              >
                {children}
              </SimpleShell>
            )}
          </>
        )}
      </body>
    </html>
  );
}
