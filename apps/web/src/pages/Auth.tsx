import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Page } from "../app/Shell";
import { errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Field, Input, Notice, useToast } from "../ui";
import "./Auth.css";

type Tab = "sign-in" | "create";

export default function Auth() {
  const session = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guestFlights = session.guestState?.history.length ?? 0;

  const switchTab = (next: Tab) => {
    setTab(next);
    setError(null);
  };

  const onSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await session.signIn(email.trim(), password);
      toast.show("Welcome back.", "signal");
      navigate("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const res = await session.register(email.trim(), password, displayName.trim() || null);
      if (res.imported > 0 || res.rejected > 0) {
        const rejected = res.rejected > 0 ? ` ${res.rejected} could not be verified.` : "";
        toast.show(`Account created. Imported ${res.imported} ${res.imported === 1 ? "flight" : "flights"}.${rejected}`, "signal");
      } else {
        toast.show("Welcome aboard.", "signal");
      }
      navigate("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (session.mode === "user") {
    return (
      <Page title="You are signed in">
        <p>
          Signed in as {session.user?.displayName || session.user?.email}.
        </p>
        <div>
          <Button variant="primary" to="/account/profile">
            Go to profile
          </Button>
        </div>
      </Page>
    );
  }

  return (
    <Page title={tab === "sign-in" ? "Sign in" : "Create account"}>
      <div className="auth">
        <div className="auth-tabs" role="group" aria-label="Sign in or create account">
          <button type="button" className={`auth-tab ${tab === "sign-in" ? "is-active" : ""}`} aria-pressed={tab === "sign-in"} onClick={() => switchTab("sign-in")}>
            Sign in
          </button>
          <button type="button" className={`auth-tab ${tab === "create" ? "is-active" : ""}`} aria-pressed={tab === "create"} onClick={() => switchTab("create")}>
            Create account
          </button>
        </div>

        {error && <Notice tone="danger">{error}</Notice>}

        {tab === "sign-in" ? (
          <form className="auth-form" onSubmit={(e) => void onSignIn(e)}>
            <Field label="Email">
              {(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <Field label="Password">
              {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <div className="auth-actions">
              <Button type="submit" variant="primary" size="lg" busy={busy}>
                Sign in
              </Button>
            </div>
            <p className="small muted">
              Signing in on this device keeps any guest flights stored here as they are. Create an account to import them.
            </p>
          </form>
        ) : (
          <form className="auth-form" onSubmit={(e) => void onCreate(e)}>
            <Notice>
              {guestFlights > 0
                ? `Your ${guestFlights} guest ${guestFlights === 1 ? "flight" : "flights"} on this device will be checked and imported.`
                : "Your guest flights on this device will be checked and imported."}
            </Notice>
            <Field label="Email">
              {(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              {(id, describedBy) => <Input id={id} aria-describedby={describedBy} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <Field label="Display name" hint="Optional. Shown on your profile.">
              {(id, describedBy) => <Input id={id} aria-describedby={describedBy} type="text" autoComplete="nickname" maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}
            </Field>
            <div className="auth-actions">
              <Button type="submit" variant="primary" size="lg" busy={busy}>
                Create account
              </Button>
            </div>
          </form>
        )}
      </div>
    </Page>
  );
}
