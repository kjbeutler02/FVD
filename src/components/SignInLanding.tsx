import { signIn } from "@/lib/auth";
import Wordmark from "@/components/Wordmark";
import { Button, Eyebrow } from "@/components/ui";

/** Official Microsoft four-square logo, on a white tile so it reads on navy. */
function MicrosoftLogo() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-white">
      <svg width="14" height="14" viewBox="0 0 21 21" aria-hidden="true">
        <rect x="0" y="0" width="10" height="10" fill="#F25022" />
        <rect x="11" y="0" width="10" height="10" fill="#7FBA00" />
        <rect x="0" y="11" width="10" height="10" fill="#00A4EF" />
        <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
      </svg>
    </span>
  );
}

export default function SignInLanding() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-workspace px-3 py-6 sm:px-6">
      <div className="grid w-full max-w-[1040px] gap-4 lg:grid-cols-[1.05fr_1fr] lg:gap-5">
        {/* Navy anchor: the firm */}
        <section className="sh-anchor-surface flex flex-col justify-between p-8 sm:p-10 lg:min-h-[520px] lg:p-12">
          <Wordmark variant="on-blue" size="lg" />

          <div className="mt-12 max-w-sm lg:mt-0">
            <p className="font-serif text-2xl italic leading-snug text-white sm:text-3xl">
              Noticed. Believed. Remembered.
            </p>
            <span className="mt-6 block h-px w-16 bg-line-on-navy" />
            <p className="mt-6 text-sm leading-relaxed text-on-navy-soft">
              Secure access to firm matter documents. Browse a project&rsquo;s
              folders and download its files as an organized archive.
            </p>
          </div>

          <Eyebrow className="mt-10 lg:mt-0">Authorized firm personnel only</Eyebrow>
        </section>

        {/* Content surface: sign in */}
        <section className="sh-content-surface flex items-center p-8 sm:p-10 lg:p-12">
          <div className="w-full max-w-sm">
            <Eyebrow>Project Documents</Eyebrow>
            <h1 className="mt-2 text-3xl text-ink">Sign in</h1>
            <p className="mt-3 text-base text-secondary">
              Use your firm Microsoft 365 account to continue.
            </p>

            <form
              className="mt-8"
              action={async () => {
                "use server";
                await signIn("microsoft-entra-id", { redirectTo: "/" });
              }}
            >
              <Button type="submit" size="lg" fullWidth icon={<MicrosoftLogo />}>
                Sign in with Microsoft
              </Button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
