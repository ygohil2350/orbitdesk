import { useCallback, useEffect, useState } from "react";
import { Bell, ChevronDown, Layers3, LayoutDashboard, LogOut, Settings, Users } from "lucide-react";
import AdminPanel from "./components/AdminPanel";
import Board from "./components/Board";
import Login from "./components/Login";
import TaskDetails from "./components/TaskDetails";
import ThemeToggle from "./components/ThemeToggle";
import { api, setToken } from "./lib/api";
import type { Project, Session, Task, TaskPage, User } from "./lib/types";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "admin">("board");
  const [loading, setLoading] = useState(true);
  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const me = await api<Session>("/auth/me");
      setSession(me);
      if (me.user.role !== "superuser") {
        const [projectData, memberData] = await Promise.all([
          api<Project[]>("/projects"),
          api<User[]>("/members"),
        ]);
        setProjects(projectData);
        setMembers(memberData);
        if (projectData[0]) {
          const page = await api<TaskPage>(`/tasks?project_id=${projectData[0].id}&page_size=100`);
          setTasks(page.items);
        }
      } else setView("admin");
    } catch {
      setToken(null);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  const refresh = useCallback(async () => {
    if (projects[0]) {
      const page = await api<TaskPage>(`/tasks?project_id=${projects[0].id}&page_size=100`);
      setTasks(page.items);
    }
  }, [projects]);
  function logout() {
    setToken(null);
    setSession(null);
    setTasks([]);
    setProjects([]);
  }
  if (loading)
    return (
      <div className="splash">
        <span className="brand-mark">
          <Layers3 />
        </span>
        <p>Preparing your workspace…</p>
      </div>
    );
  if (!session) return <Login onLogin={() => void bootstrap()} />;
  const project = projects[0];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              setView("board");
            }}
          >
            <span className="brand-mark">
              <Layers3 size={18} />
            </span>
            OrbitDesk
          </a>
          {session.organization_name && (
            <div className="workspace-switch">
              <span>{session.organization_name[0]}</span>
              <div>
                <b>{session.organization_name}</b>
                <small>Workspace</small>
              </div>
              <ChevronDown size={14} />
            </div>
          )}
          <nav>
            {session.user.role !== "superuser" && (
              <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>
                <LayoutDashboard />
                Board
              </button>
            )}
            {session.user.role === "org_admin" && (
              <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>
                <Users />
                Team
              </button>
            )}
            {session.user.role === "superuser" && (
              <button className="active">
                <Settings />
                Provisioning
              </button>
            )}
          </nav>
        </div>
        <div className="sidebar-user">
          <span className="avatar">{initials(session.user.full_name)}</span>
          <div>
            <b>{session.user.full_name}</b>
            <small>{roleLabel(session.user.role)}</small>
          </div>
          <button onClick={logout} title="Sign out">
            <LogOut />
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <button className="mobile-logo">
            <Layers3 />
          </button>
          <div className="breadcrumbs">
            <span>{session.organization_name || "System"}</span>
            <b>/</b>
            <span>{view === "board" ? project?.name || "Board" : "Administration"}</span>
          </div>
          <div className="top-actions">
            <ThemeToggle className="theme-toggle" />
            <button aria-label="Notifications">
              <Bell />
            </button>
            <span className="avatar">{initials(session.user.full_name)}</span>
          </div>
        </header>
        <div className="content">
          {view === "admin" ? (
            <AdminPanel
              session={session}
              onDone={() => (session.user.role === "superuser" ? undefined : setView("board"))}
            />
          ) : project ? (
            <Board
              tasks={tasks}
              project={project}
              members={members}
              onOpen={setSelected}
              onRefresh={() => void refresh()}
            />
          ) : (
            <div className="empty-state">
              <h1>No projects yet</h1>
              <p>Ask your organization administrator to create the first project.</p>
            </div>
          )}
        </div>
      </main>
      {selected && project && (
        <TaskDetails
          taskId={selected}
          projectKey={project.key}
          members={members}
          onClose={() => setSelected(null)}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  );
}
function initials(name: string) {
  return name
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
}
function roleLabel(role: string) {
  return role === "superuser"
    ? "Super user"
    : role === "org_admin"
      ? "Organization admin"
      : "Member";
}
