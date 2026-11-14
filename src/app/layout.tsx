import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import { cookies, headers } from "next/headers";
import { Shell } from "@/components/shell";
import { assistantStatus } from "@/lib/ai/runtime";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/ops-ui/actor";
import { SPACE_COOKIE, spaceById, spaceForPath } from "@/lib/spaces";
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
  // A person who opens another team's page (an old link) lands on their own area instead.
  const pathSpace = spaceForPath(path);
  if (session.kind === "person" && pathSpace && !session.spaces.includes(pathSpace)) redirect(spaceById(session.spaces.find((s) => s !== "command") ?? "command").home);
  const mode = workspace.kind === "ready" ? workspace.mode : "blocked";
  const space = spaceForPath(path) ?? spaceById((await cookies()).get(SPACE_COOKIE)?.value).id;
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
              <Shell
                path={path}
                mode={mode}
                health={workspace.health}
                actorName={actor}
                initialSpace={session.spaces.includes(space) ? space : session.spaces[0] ?? space}
                assistant={assistantStatus()}
                signedIn={session.kind === "person" ? "person" : "admin"}
                allowedSpaces={session.spaces}
                canSettings={session.kind !== "person" || session.person.roles.includes("admin")}
              >
                {children}
              </Shell>
            )}
          </>
        )}
      </body>
    </html>
  );
}
