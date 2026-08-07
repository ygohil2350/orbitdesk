import { useState } from "react";
import { Building2, UserPlus } from "lucide-react";
import { api } from "../lib/api";
import type { Session } from "../lib/types";

export default function AdminPanel({ session, onDone }: { session: Session; onDone: () => void }) {
  const superuser = session.user.role === "superuser";
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const change = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues({ ...values, [key]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (superuser)
        await api("/admin/organizations", {
          method: "POST",
          body: JSON.stringify({
            name: values.name,
            slug: values.slug,
            admin_email: values.email,
            admin_name: values.full_name,
            admin_password: values.password,
          }),
        });
      else
        await api("/members", {
          method: "POST",
          body: JSON.stringify({
            email: values.email,
            full_name: values.full_name,
            password: values.password,
            role: "member",
          }),
        });
      setMessage(superuser ? "Organization and admin created." : "Team member created.");
      setValues({});
    } catch (x) {
      setError(x instanceof Error ? x.message : "Request failed");
    }
  }
  return (
    <div className="admin-page">
      <div className="admin-intro">
        <span className="admin-icon">{superuser ? <Building2 /> : <UserPlus />}</span>
        <p className="eyebrow ink">{superuser ? "SYSTEM CONTROL" : "TEAM SETTINGS"}</p>
        <h1>{superuser ? "Provision an organization" : "Invite a team member"}</h1>
        <p>
          {superuser
            ? "Create an isolated workspace and its first organization administrator."
            : "Only organization admins can add people to this workspace."}
        </p>
      </div>
      <form className="admin-form" onSubmit={submit}>
        {superuser && (
          <>
            <label>
              Organization name
              <input
                value={values.name || ""}
                onChange={change("name")}
                minLength={2}
                maxLength={100}
                required
              />
            </label>
            <label>
              Workspace slug
              <input
                value={values.slug || ""}
                onChange={change("slug")}
                pattern="[a-z0-9-]+"
                placeholder="acme-studio"
                required
              />
            </label>
          </>
        )}
        <label>
          {superuser ? "Admin name" : "Full name"}
          <input
            value={values.full_name || ""}
            onChange={change("full_name")}
            minLength={2}
            maxLength={100}
            required
          />
        </label>
        <label>
          Email
          <input type="email" value={values.email || ""} onChange={change("email")} required />
        </label>
        <label>
          Temporary password
          <input
            type="password"
            value={values.password || ""}
            onChange={change("password")}
            minLength={12}
            maxLength={128}
            required
          />
          <small>At least 12 characters</small>
        </label>
        {message && <p className="success-note">{message}</p>}
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button type="button" className="secondary" onClick={onDone}>
            Back
          </button>
          <button className="primary">{superuser ? "Create organization" : "Create member"}</button>
        </footer>
      </form>
    </div>
  );
}
