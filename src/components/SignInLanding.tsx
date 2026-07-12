import { signIn } from "@/lib/auth";
import Wordmark from "@/components/Wordmark";

/** Official Microsoft four-square logo. */
function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="0" y="0" width="10" height="10" fill="#F25022" />
      <rect x="11" y="0" width="10" height="10" fill="#7FBA00" />
      <rect x="0" y="11" width="10" height="10" fill="#00A4EF" />
      <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

export default function SignInLanding() {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Brand panel */}
      <div className="flex flex-col justify-between bg-brand px-8 py-10 text-white lg:w-[44%] lg:px-14 lg:py-16">
        <Wordmark variant="on-blue" size="lg" />

        <div className="mt-10 hidden max-w-sm lg:block">
          <p className="text-2xl font-light leading-snug text-white/90">
            Noticed. Believed. Remembered.
          </p>
          <span className="mt-6 block h-px w-16 bg-white/30" />
          <p className="mt-6 text-sm font-light leading-relaxed text-white/70">
            Secure access to firm matter documents. Browse a project&rsquo;s
            folders and download its files as an organized archive.
          </p>
        </div>

        <p className="mt-8 text-[0.7rem] font-medium uppercase tracking-[0.18em] text-white/60 lg:mt-0">
          Authorized firm personnel only
        </p>
      </div>

      {/* Sign-in panel */}
      <div className="flex flex-1 items-center justify-center bg-surface px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold text-ink">Sign In</h1>
          <p className="mt-1.5 text-sm font-light text-muted">
            Use your firm Microsoft 365 account to continue.
          </p>

          <form
            className="mt-8"
            action={async () => {
              "use server";
              await signIn("microsoft-entra-id", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-sm border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink transition-colors hover:bg-canvas"
            >
              <MicrosoftLogo />
              Sign in with Microsoft
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
