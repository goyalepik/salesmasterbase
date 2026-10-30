import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import { cookies, headers } from "next/headers";
import { Shell } from "@/components/shell";
import { assistantStatus } from "@/lib/ai/runtime";
import { actorName } from "@/lib/ops-ui/actor";
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
  const [workspace, actor] = await Promise.all([loadWorkspace(), actorName()]);
  const mode = workspace.kind === "ready" ? workspace.mode : "blocked";
  const space = spaceForPath(path) ?? spaceById((await cookies()).get(SPACE_COOKIE)?.value).id;
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
          <Shell path={path} mode={mode} health={workspace.health} actorName={actor} initialSpace={space} assistant={assistantStatus()}>{children}</Shell>
        )}
      </body>
    </html>
  );
}
