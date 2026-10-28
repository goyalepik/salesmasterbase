import { TextButton, fieldClassName } from "@/components/ui";

export default async function AccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const failed = params.error === "1";
  return (
    <section>
      <p className="font-serif text-[28px] leading-none tracking-[-0.03em]">EPIK</p>
      <h1 className="mt-6 text-[20px] font-semibold tracking-tight">Live workspace</h1>
      <p className="mt-2 text-[13px] leading-5 text-muted">Enter the access code to open message data. The code is checked on the server and is not stored in the page.</p>
      <form className="mt-6 grid gap-3" action="/api/access" method="post">
        <input type="hidden" name="next" value={next} />
        <label className="text-[12px] text-muted">
          Access code
          <input className={`mt-1 ${fieldClassName()}`} type="password" name="code" autoComplete="current-password" required />
        </label>
        {failed ? <p className="text-[13px] text-bad">That code was not accepted.</p> : null}
        <div><TextButton>Continue</TextButton></div>
      </form>
    </section>
  );
}
