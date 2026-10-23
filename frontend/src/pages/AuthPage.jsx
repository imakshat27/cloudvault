import { api } from "../services/api";
import { useState, useEffect } from "react";
import {
  Cloud,
  ArrowUpRight,
  ArrowRight,
  FileText,
  Sparkles,
  Quote,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../context/auth";
export function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [registrationMode, setRegistrationMode] = useState("invite");
  useEffect(() => {
    api
      .authOptions()
      .then((r) => setRegistrationMode(r.registrationMode))
      .catch(() => {});
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { login, register } = useAuth();
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await (isLogin ? login : register)(email, password, inviteCode);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Cloud size={24} />
          </span>
          CloudVault<span className="brand-dot">.</span>
        </a>
        <div className="auth-story-content">
          <span className="eyebrow">YOUR KNOWLEDGE, CONNECTED</span>
          <h1>
            A little less searching.
            <br />
            <span>A lot more knowing.</span>
          </h1>
          <p>
            Give your files a place to live.
            <br />
            And your ideas room to grow.
          </p>
          <div className="auth-illustration">
            <div className="mini-file">
              <span className="file-icon pdf">
                <FileText />
              </span>
              <div>
                <strong>Project research.pdf</strong>
                <small>Ready to explore</small>
              </div>
              <ShieldCheck size={18} />
            </div>
            <div className="mini-question">
              <Sparkles size={18} /> What are the key takeaways?
              <ArrowUpRight size={18} />
            </div>
            <div className="mini-answer">
              <Quote size={20} />
              <p>
                Your next idea is already in your files.
                <br />
                <strong>Let’s find it together.</strong>
              </p>
              <span className="source-pill">1 source</span>
            </div>
          </div>
        </div>
        <span className="auth-footer">A smarter home for your documents.</span>
      </section>
      <section className="auth-form-section">
        <div className="auth-form-wrap">
          <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
          <h2>
            {isLogin ? "Good to have you back." : "Make room for your ideas."}
          </h2>
          <p className="muted">
            {isLogin
              ? "Sign in to pick up where you left off."
              : "Create your account and start connecting the dots."}
          </p>
          <form onSubmit={submit}>
            {!isLogin && registrationMode === "invite" && (
              <>
                <label htmlFor="invite-code">Review invitation code</label>
                <input
                  id="invite-code"
                  type="password"
                  autoComplete="off"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.trim())}
                  minLength={32}
                  maxLength={32}
                  required
                  placeholder="Provided by your workspace host"
                />
                <small className="muted">
                  Sign-up is limited to invited reviewers.
                </small>
              </>
            )}
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              minLength={isLogin ? 1 : 10}
              maxLength={72}
              placeholder={
                isLogin ? "Enter your password" : "At least 10 characters"
              }
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {!isLogin && (
              <small className="muted">
                Use a unique password of 10–72 characters.
              </small>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary auth-submit" disabled={busy}>
              {busy ? "One moment…" : isLogin ? "Sign in" : "Create account"}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="switch-auth">
            {isLogin ? "New around here?" : "Already have an account?"}{" "}
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setError("");
              }}
            >
              {isLogin ? "Create an account" : "Sign in"}
            </button>
          </p>
          <div className="privacy-note">
            <ShieldCheck size={17} />
            <span>Your files are private. You choose who gets access.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
