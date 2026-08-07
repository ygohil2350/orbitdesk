import { useState } from "react";
import { ArrowUpRight, Circle, CircleCheck, CircleDot, Plus } from "lucide-react";
import { api } from "../lib/api";
import type { Project, Status, Task, User } from "../lib/types";

const columns: { id: Status; label: string; icon: typeof Circle }[] = [
  { id: "todo", label: "To do", icon: Circle },
  { id: "in_progress", label: "In progress", icon: CircleDot },
  { id: "done", label: "Done", icon: CircleCheck },
];

export default function Board({
  tasks,
  project,
  members,
  onOpen,
  onRefresh,
}: {
  tasks: Task[];
  project: Project;
  members: User[];
  onOpen: (id: string) => void;
  onRefresh: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  async function drop(event: React.DragEvent, status: Status) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/task-id");
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    const valid =
      (task.status === "todo" && status === "in_progress") ||
      (task.status === "in_progress" && (status === "todo" || status === "done")) ||
      (task.status === "done" && status === "in_progress");
    if (!valid) {
      setError("That move skips a workflow step.");
      return;
    }
    try {
      await api(`/tasks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Move failed");
    }
  }
  return (
    <>
      <div className="board-head">
        <div>
          <p className="eyebrow ink">PROJECT / {project.key}</p>
          <h1>{project.name}</h1>
          <p>{project.description}</p>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>
          <Plus size={17} />
          New task
        </button>
      </div>
      {error && (
        <button className="toast" onClick={() => setError("")}>
          {error}
        </button>
      )}
      <div className="board">
        {columns.map((column) => (
          <section
            className={`board-column ${column.id}`}
            key={column.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => void drop(e, column.id)}
          >
            <header>
              <span>
                <column.icon size={17} />
                {column.label}
              </span>
              <b>{tasks.filter((t) => t.status === column.id).length}</b>
            </header>
            <div className="task-stack">
              {tasks
                .filter((t) => t.status === column.id)
                .map((task) => (
                  <article
                    className="task-card"
                    key={task.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/task-id", task.id)}
                    onClick={() => onOpen(task.id)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && onOpen(task.id)}
                  >
                    <div className="card-top">
                      <span>
                        {project.key}-{task.sequence}
                      </span>
                      <ArrowUpRight size={15} />
                    </div>
                    <h3>{task.title}</h3>
                    <div className="card-foot">
                      <span
                        className={`priority-dot ${task.priority}`}
                        title={`${task.priority} priority`}
                      ></span>
                      <span className="avatar">{initials(task.assignee.full_name)}</span>
                      <span>{task.assignee.full_name}</span>
                    </div>
                  </article>
                ))}
            </div>
          </section>
        ))}
      </div>
      {creating && (
        <CreateTask
          project={project}
          members={members}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            onRefresh();
          }}
        />
      )}
    </>
  );
}

function CreateTask({
  project,
  members,
  onClose,
  onCreated,
}: {
  project: Project;
  members: User[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState(members[0]?.id || "");
  const [priority, setPriority] = useState("medium");
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/tasks", {
        method: "POST",
        body: JSON.stringify({
          project_id: project.id,
          title,
          description,
          assignee_id: assignee,
          priority,
        }),
      });
      onCreated();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not create task");
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <p className="eyebrow ink">NEW WORK ITEM</p>
        <h2>Create a task</h2>
        <label>
          Title
          <input
            autoFocus
            minLength={3}
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to happen?"
            required
          />
        </label>
        <label>
          Description
          <textarea
            maxLength={20000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add context, requirements, or a definition of done."
          />
        </label>
        <div className="form-grid">
          <label>
            Assignee
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              {members.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Create task</button>
        </footer>
      </form>
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
