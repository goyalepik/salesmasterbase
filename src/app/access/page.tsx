import { TextButton, fieldClassName } from "@/components/ui";

export default async function AccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const failed = params.error === "1";
  const removed = params.error === "removed";
  return (
    <section>
      <p className="font-serif text-[28px] leading-none tracking-[-0.03em]">EPIK</p>
      <h1 className="mt-6 text-[20px] font-semibold tracking-tight">Live workspace</h1>
      <p className="mt-2 text-[13px] leading-5 text-muted">Enter your sign-in code (your admin gives it to you from Settings → Team roles), or the main access code.</p>
      <form className="mt-6 grid gap-3" action="/api/access" method="post">
        <input type="hidden" name="next" value={next} />
        <label className="text-[12px] text-muted">
          Your code
          <input className={`mt-1 ${fieldClassName()}`} type="password" name="code" autoComplete="current-password" required />
        </label>
        {failed ? <p className="text-[13px] text-bad">That code was not accepted.</p> : null}
        {removed ? <p className="text-[13px] text-warn">You are no longer on the team list. Ask your admin for a new code.</p> : null}
        <div><TextButton>Continue</TextButton></div>
      </form>
    </section>
  );
}
