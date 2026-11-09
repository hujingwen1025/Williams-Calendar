import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole, Eye, EyeOff } from "lucide-react";
import { post, setCsrf } from "../api";
import { Dialog } from "./Dialog";
export function Login({
  owner,
  onClose,
  onLogin,
}: {
  owner: boolean;
  onClose: () => void;
  onLogin: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await post<{ csrfToken: string }>("/api/auth/login", {
        role: owner ? "owner" : "viewer",
        password,
      });
      setCsrf(result.csrfToken);
      setPassword("");
      await onLogin();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Dialog title={owner ? "Owner sign-in" : "A closer look"} onClose={onClose}>
      <div className="dialog-body">
        <LockKeyhole className="large-icon" size={28} strokeWidth={1.4} />
        <p className="dialog-intro">
          {owner
            ? "Sign in to manage calendar sources, access, and preferences."
            : "Enter the shared password to see event names, places, and details. Private events stay private."}
        </p>
        <form onSubmit={submit} className="form-stack">
          <label htmlFor="login-password">
            {owner ? "Owner password" : "Calendar password"}
          </label>
          <div className="password-input">
            <input
              id="login-password"
              autoFocus
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              maxLength={256}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
              aria-invalid={Boolean(error)}
              aria-describedby="login-message"
            />
            <button
              type="button"
              className="icon-button"
              aria-label={show ? "Hide password" : "Show password"}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <p
            id="login-message"
            className="form-message error"
            role={error ? "alert" : undefined}
          >
            {error || "\u00a0"}
          </p>
          <button
            className="button primary full-width"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? "Opening…" : owner ? "Sign in" : "View details"}
            <ArrowRight size={17} />
          </button>
        </form>
        {!owner && (
          <p className="fine-print">
            Read-only access. This session lasts up to 12 hours.
          </p>
        )}
      </div>
    </Dialog>
  );
}
