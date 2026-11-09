import {
  Bold,
  Download,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Save,
  Send,
  UploadCloud,
  X,
} from "lucide-react";
import {
  Avatar as MuiAvatar,
  Box,
  LinearProgress,
  ListItemAvatar,
  ListItemText,
  MenuItem,
  Select,
  Tooltip,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { API_URL, api, getToken, wsUrl } from "../lib/api";
import type { Attachment, Comment, Status, Task, User } from "../lib/types";

type Props = {
  taskId: string;
  projectKey: string;
  members: User[];
  onClose: () => void;
  onChanged: () => void;
};

type PendingFile = { file: File; previewUrl?: string };
type SystemEvent = {
  id: string;
  actor: string;
  from: Status;
  to: Status;
  createdAt: string;
};

const statusLabels: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

const statusStyles: Record<Status, string> = {
  todo: "border-slate-200 bg-slate-100 text-slate-700",
  in_progress: "border-amber-200 bg-amber-50 text-amber-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const priorityStyles: Record<Task["priority"], string> = {
  low: "border-sky-200 bg-sky-50 text-sky-700",
  medium: "border-slate-200 bg-slate-100 text-slate-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  urgent: "border-rose-200 bg-rose-50 text-rose-700",
};

const allowedTransitions: Record<Status, Status[]> = {
  todo: ["todo", "in_progress"],
  in_progress: ["todo", "in_progress", "done"],
  done: ["in_progress", "done"],
};

const acceptedFiles =
  "image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,application/zip";

export default function TaskDetails({ taskId, projectKey, members, onClose, onChanged }: Props) {
  const [task, setTask] = useState<Task | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  const [connectionState, setConnectionState] = useState<"connecting" | "live" | "reconnecting">(
    "connecting",
  );
  const [saving, setSaving] = useState(false);
  const [updatingField, setUpdatingField] = useState<"assignee" | "priority" | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const socketRef = useRef<WebSocket | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const pendingFilesRef = useRef<PendingFile[]>([]);

  const loadTask = useCallback(async () => {
    try {
      const loaded = await api<Task>(`/tasks/${taskId}`);
      setTask(loaded);
      setTitle(loaded.title);
      setDescription(loaded.description ?? "");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Task unavailable");
    }
  }, [taskId]);

  useEffect(() => {
    void loadTask();
  }, [loadTask]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (expandedImage) setExpandedImage(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expandedImage, onClose]);

  useEffect(() => {
    let stopped = false;
    let reconnectTimer: number | undefined;
    let attempt = 0;

    const connect = () => {
      if (stopped) return;
      setConnectionState(attempt ? "reconnecting" : "connecting");
      const socket = new WebSocket(wsUrl(`/ws/tasks/${taskId}`));
      socketRef.current = socket;

      socket.onopen = () => socket.send(JSON.stringify({ type: "auth", token: getToken() }));
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as {
          type: string;
          message?: string;
          comment?: Comment;
          comment_id?: string;
          attachment?: Attachment;
          actor?: { full_name: string };
          from?: Status;
          to?: Status;
        };

        if (message.type === "ready") {
          attempt = 0;
          setConnectionState("live");
        }
        if (message.type === "error" && message.message) setError(message.message);
        if (message.type === "comment.created" && message.comment) {
          setTask((current) =>
            current
              ? {
                  ...current,
                  comments: [
                    ...(current.comments ?? []).filter((item) => item.id !== message.comment!.id),
                    { ...message.comment!, attachments: message.comment!.attachments ?? [] },
                  ],
                }
              : current,
          );
        }
        if (
          message.type === "comment.attachment.created" &&
          message.comment_id &&
          message.attachment
        ) {
          setTask((current) =>
            current
              ? {
                  ...current,
                  comments: (current.comments ?? []).map((item) =>
                    item.id === message.comment_id
                      ? {
                          ...item,
                          attachments: [
                            ...(item.attachments ?? []).filter(
                              (file) => file.id !== message.attachment!.id,
                            ),
                            message.attachment!,
                          ],
                        }
                      : item,
                  ),
                }
              : current,
          );
        }
        if (message.type === "task.status.changed" && message.actor && message.from && message.to) {
          setTask((current) => (current ? { ...current, status: message.to! } : current));
          setSystemEvents((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              actor: message.actor!.full_name,
              from: message.from!,
              to: message.to!,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      };
      socket.onclose = () => {
        if (!stopped) {
          setConnectionState("reconnecting");
          reconnectTimer = window.setTimeout(connect, Math.min(1000 * 2 ** attempt++, 8000));
        }
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [taskId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [task?.comments?.length, systemEvents.length]);

  useEffect(() => {
    const textarea = commentRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [comment]);

  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  useEffect(
    () => () =>
      pendingFilesRef.current.forEach(
        (item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl),
      ),
    [],
  );

  const isDirty = task
    ? title.trim() !== task.title || description.trim() !== (task.description ?? "")
    : false;

  const comments = useMemo(() => task?.comments ?? [], [task?.comments]);

  async function saveTask() {
    if (!task || !isDirty || title.trim().length < 3) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api<Task>(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });
      setTask(updated);
      setTitle(updated.title);
      setDescription(updated.description ?? "");
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save task");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(next: Status) {
    if (!task || next === task.status) return;
    const previous = task.status;
    setTask({ ...task, status: next });
    try {
      const updated = await api<Task>(`/tasks/${task.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      setTask(updated);
      onChanged();
    } catch (caught) {
      setTask((current) => (current ? { ...current, status: previous } : current));
      setError(caught instanceof Error ? caught.message : "Could not change status");
    }
  }

  async function changeAssignee(assigneeId: string) {
    if (!task || assigneeId === task.assignee.id) return;
    const previous = task.assignee;
    const nextAssignee = members.find((member) => member.id === assigneeId);
    if (!nextAssignee) {
      setError("That person is no longer an active workspace member");
      return;
    }

    setError("");
    setUpdatingField("assignee");
    setTask({ ...task, assignee: nextAssignee });
    try {
      const updated = await api<Task>(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ assignee_id: assigneeId }),
      });
      setTask(updated);
      onChanged();
    } catch (caught) {
      setTask((current) => (current ? { ...current, assignee: previous } : current));
      setError(caught instanceof Error ? caught.message : "Could not change assignee");
    } finally {
      setUpdatingField(null);
    }
  }

  async function changePriority(priority: Task["priority"]) {
    if (!task || priority === task.priority) return;
    const previous = task.priority;
    setError("");
    setUpdatingField("priority");
    setTask({ ...task, priority });
    try {
      const updated = await api<Task>(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ priority }),
      });
      setTask(updated);
      onChanged();
    } catch (caught) {
      setTask((current) => (current ? { ...current, priority: previous } : current));
      setError(caught instanceof Error ? caught.message : "Could not change priority");
    } finally {
      setUpdatingField(null);
    }
  }

  function insertMarkdown(before: string, after = before) {
    const textarea = descriptionRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = description.slice(start, end);
    const next = `${description.slice(0, start)}${before}${selected}${after}${description.slice(end)}`;
    setDescription(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    });
  }

  function queueCommentFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files ?? []);
    setPendingFiles((current) => [
      ...current,
      ...incoming.map((file) => ({
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      })),
    ]);
    event.target.value = "";
  }

  function removePendingFile(index: number) {
    setPendingFiles((current) => {
      const target = current[index];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  async function sendComment(event?: React.FormEvent) {
    event?.preventDefault();
    const body = comment.trim();
    if ((!body && !pendingFiles.length) || uploadProgress !== null) return;
    setError("");

    if (!pendingFiles.length && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "comment.create", body }));
      setComment("");
      return;
    }

    const files = [...pendingFiles];
    const fallbackBody =
      body || `Shared ${files.length} attachment${files.length === 1 ? "" : "s"}`;
    setComment("");
    setUploadProgress(0);
    try {
      const saved = await api<Comment>(`/tasks/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: fallbackBody }),
      });
      setTask((current) =>
        current
          ? {
              ...current,
              comments: [
                ...(current.comments ?? []).filter((item) => item.id !== saved.id),
                { ...saved, attachments: saved.attachments ?? [] },
              ],
            }
          : current,
      );

      for (let index = 0; index < files.length; index += 1) {
        const attachment = await uploadAttachment(
          `/comments/${saved.id}/attachments`,
          files[index].file,
          (progress) =>
            setUploadProgress(Math.round(((index + progress / 100) / files.length) * 100)),
        );
        setTask((current) =>
          current
            ? {
                ...current,
                comments: (current.comments ?? []).map((item) =>
                  item.id === saved.id
                    ? {
                        ...item,
                        attachments: [
                          ...(item.attachments ?? []).filter((file) => file.id !== attachment.id),
                          attachment,
                        ],
                      }
                    : item,
                ),
              }
            : current,
        );
      }
      files.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
      setPendingFiles([]);
    } catch (caught) {
      setComment(body);
      setError(caught instanceof Error ? caught.message : "Could not send comment");
    } finally {
      setUploadProgress(null);
    }
  }

  async function uploadTaskFiles(event: React.ChangeEvent<HTMLInputElement>) {
    if (!task || !event.target.files?.length) return;
    const files = Array.from(event.target.files);
    event.target.value = "";
    setUploadProgress(0);
    try {
      for (let index = 0; index < files.length; index += 1) {
        const attachment = await uploadAttachment(
          `/tasks/${task.id}/attachments`,
          files[index],
          (progress) =>
            setUploadProgress(Math.round(((index + progress / 100) / files.length) * 100)),
        );
        setTask((current) =>
          current
            ? {
                ...current,
                attachments: [
                  ...(current.attachments ?? []).filter((file) => file.id !== attachment.id),
                  attachment,
                ],
              }
            : current,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed");
    } finally {
      setUploadProgress(null);
    }
  }

  if (!task) {
    return (
      <ModalBackdrop onClose={onClose}>
        <div className="flex min-h-64 w-full max-w-xl items-center justify-center rounded-2xl bg-white text-slate-500 shadow-2xl">
          {error || <LoaderCircle className="animate-spin" aria-label="Loading task" />}
        </div>
      </ModalBackdrop>
    );
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <section
        data-task-detail
        aria-label="Task details"
        aria-modal="true"
        role="dialog"
        className="grid h-dvh w-full grid-cols-1 overflow-y-auto bg-white shadow-2xl lg:h-[min(94vh,900px)] lg:w-[min(96vw,1380px)] lg:grid-cols-[minmax(0,1.12fr)_minmax(380px,.88fr)] lg:overflow-hidden lg:rounded-2xl"
      >
        <div className="min-w-0 border-b border-slate-200 bg-white lg:overflow-y-auto lg:border-r lg:border-b-0">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur sm:px-7">
            <div className="flex min-w-0 items-center gap-3">
              <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold tracking-wide text-slate-600">
                {projectKey}-{task.sequence}
              </span>
              <span className="hidden truncate text-xs text-slate-400 sm:inline">Task details</span>
            </div>
            <div className="flex items-center gap-2">
              {isDirty && (
                <button
                  type="button"
                  onClick={() => void saveTask()}
                  disabled={saving || title.trim().length < 3}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3.5 text-xs font-semibold text-white transition hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? (
                    <LoaderCircle size={15} className="animate-spin" />
                  ) : (
                    <Save size={15} />
                  )}
                  Save changes
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close task details"
                className="grid size-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-900"
              >
                <X size={19} />
              </button>
            </div>
          </header>

          <div className="space-y-8 px-5 py-7 sm:px-8 sm:py-9">
            <div>
              <label htmlFor="task-title" className="sr-only">
                Task title
              </label>
              <input
                id="task-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={160}
                className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-2xl font-bold tracking-tight text-slate-950 transition outline-none hover:border-slate-200 hover:bg-slate-50 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-100 sm:text-3xl"
              />
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FieldShell label="Status">
                  <Select
                    aria-label="Task status"
                    size="small"
                    fullWidth
                    value={task.status}
                    onChange={(event) => void changeStatus(event.target.value as Status)}
                    sx={{ height: 40, fontSize: 14, fontWeight: 600 }}
                  >
                    {allowedTransitions[task.status].map((status) => (
                      <MenuItem key={status} value={status}>
                        <span
                          className={`mr-2 size-2 rounded-full border ${statusStyles[status]}`}
                        />
                        {statusLabels[status]}
                      </MenuItem>
                    ))}
                  </Select>
                </FieldShell>
                <FieldShell
                  label={updatingField === "priority" ? "Priority · Saving…" : "Priority"}
                >
                  <Select
                    aria-label="Task priority"
                    size="small"
                    fullWidth
                    value={task.priority}
                    disabled={updatingField !== null}
                    onChange={(event) =>
                      void changePriority(event.target.value as Task["priority"])
                    }
                    renderValue={(priority) => (
                      <span className="flex items-center gap-2 text-sm font-semibold capitalize">
                        <span
                          className={`size-2 rounded-full border ${priorityStyles[priority]}`}
                        />
                        {priority}
                      </span>
                    )}
                    sx={{ height: 40 }}
                  >
                    {(["low", "medium", "high", "urgent"] as Task["priority"][]).map((priority) => (
                      <MenuItem key={priority} value={priority}>
                        <span
                          className={`mr-2 size-2 rounded-full border ${priorityStyles[priority]}`}
                        />
                        <span className="capitalize">{priority}</span>
                      </MenuItem>
                    ))}
                  </Select>
                </FieldShell>
                <FieldShell
                  label={
                    updatingField === "assignee"
                      ? "Assignee · Saving…"
                      : `Assignee · ${members.length} available`
                  }
                >
                  <Select
                    aria-label="Task assignee"
                    size="small"
                    fullWidth
                    value={task.assignee.id}
                    disabled={updatingField !== null || members.length === 0}
                    onChange={(event) => void changeAssignee(event.target.value)}
                    renderValue={(assigneeId) => {
                      const person =
                        members.find((member) => member.id === assigneeId) ?? task.assignee;
                      return (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                          <MuiAvatar sx={{ width: 24, height: 24, fontSize: 10, fontWeight: 700 }}>
                            {initials(person.full_name)}
                          </MuiAvatar>
                          <span className="truncate text-sm font-medium">{person.full_name}</span>
                        </Box>
                      );
                    }}
                    sx={{ height: 40 }}
                  >
                    {members.map((member) => (
                      <MenuItem key={member.id} value={member.id}>
                        <ListItemAvatar sx={{ minWidth: 38 }}>
                          <MuiAvatar sx={{ width: 28, height: 28, fontSize: 10, fontWeight: 700 }}>
                            {initials(member.full_name)}
                          </MuiAvatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={member.full_name}
                          secondary={`${member.email} · ${roleLabel(member.role)}`}
                          slotProps={{
                            primary: { noWrap: true, sx: { fontSize: 14, fontWeight: 600 } },
                            secondary: { noWrap: true, sx: { fontSize: 11 } },
                          }}
                        />
                      </MenuItem>
                    ))}
                  </Select>
                </FieldShell>
              </div>
            </div>

            <section aria-labelledby="description-heading">
              <div className="mb-2 flex items-end justify-between">
                <div>
                  <h2 id="description-heading" className="text-sm font-semibold text-slate-900">
                    Description
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">Markdown formatting is supported.</p>
                </div>
                <span className="text-[11px] text-slate-400">
                  {description.length.toLocaleString()} / 20,000
                </span>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-100">
                <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
                  <FormatButton label="Bold" onClick={() => insertMarkdown("**")}>
                    <Bold size={15} />
                  </FormatButton>
                  <FormatButton label="Italic" onClick={() => insertMarkdown("_")}>
                    <Italic size={15} />
                  </FormatButton>
                  <FormatButton label="Link" onClick={() => insertMarkdown("[", "](https://)")}>
                    <Link2 size={15} />
                  </FormatButton>
                  <span className="mx-1 h-5 w-px bg-slate-200" />
                  <FormatButton label="Bulleted list" onClick={() => insertMarkdown("- ", "")}>
                    <List size={16} />
                  </FormatButton>
                </div>
                <textarea
                  ref={descriptionRef}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={8}
                  maxLength={20_000}
                  className="block min-h-48 w-full resize-y border-0 px-4 py-3 text-sm leading-7 text-slate-700 outline-none placeholder:text-slate-400"
                  placeholder="Add context, acceptance criteria, or implementation notes…"
                />
              </div>
            </section>

            <section aria-labelledby="attachments-heading">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 id="attachments-heading" className="text-sm font-semibold text-slate-900">
                    Attachments
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Images, PDFs, text, CSV, or ZIP up to 10 MB.
                  </p>
                </div>
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition focus-within:ring-2 focus-within:ring-indigo-500 hover:border-slate-300 hover:bg-slate-50">
                  <input
                    type="file"
                    multiple
                    accept={acceptedFiles}
                    onChange={(event) => void uploadTaskFiles(event)}
                    className="sr-only"
                  />
                  <UploadCloud size={15} /> Add files
                </label>
              </div>
              {(task.attachments ?? []).length ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(task.attachments ?? []).map((attachment) => (
                    <TaskAttachmentCard
                      key={attachment.id}
                      attachment={attachment}
                      onExpand={setExpandedImage}
                    />
                  ))}
                </div>
              ) : (
                <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 text-center transition focus-within:ring-2 focus-within:ring-indigo-500 hover:border-indigo-300 hover:bg-indigo-50/40">
                  <input
                    type="file"
                    multiple
                    accept={acceptedFiles}
                    onChange={(event) => void uploadTaskFiles(event)}
                    className="sr-only"
                  />
                  <UploadCloud className="mb-2 text-slate-400" size={24} />
                  <span className="text-sm font-medium text-slate-700">Upload task files</span>
                  <span className="mt-1 text-xs text-slate-400">Select one or more files</span>
                </label>
              )}
            </section>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
              <span>
                Reported by{" "}
                <strong className="font-medium text-slate-700">
                  {task.reporter?.full_name ?? "Unknown"}
                </strong>
              </span>
              <span>Updated {relativeTime(task.updated_at, now)}</span>
            </div>
          </div>
        </div>

        <aside className="flex min-h-[640px] min-w-0 flex-col bg-slate-50 lg:min-h-0 lg:overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 sm:px-6">
            <div className="flex items-center gap-2.5">
              <MessageCircle size={18} className="text-slate-600" />
              <h2 className="text-sm font-semibold text-slate-900">Activity & comments</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                {comments.length}
              </span>
            </div>
            <span className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
              <span
                className={`size-2 rounded-full ${connectionState === "live" ? "bg-emerald-500 shadow-[0_0_0_3px_rgb(16_185_129_/_0.14)]" : "animate-pulse bg-amber-400"}`}
              />
              {connectionState === "live"
                ? "Live"
                : connectionState === "reconnecting"
                  ? "Reconnecting"
                  : "Connecting"}
            </span>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6">
            <SystemMessage>
              <strong>{task.reporter?.full_name ?? "A teammate"}</strong> created this task ·{" "}
              {relativeTime(task.created_at ?? task.updated_at, now)}
            </SystemMessage>

            {comments.map((item, index) => {
              const previous = comments[index - 1];
              const grouped = Boolean(
                previous &&
                previous.author.id === item.author.id &&
                new Date(item.created_at).getTime() - new Date(previous.created_at).getTime() <
                  5 * 60_000,
              );
              return (
                <CommentBubble
                  key={item.id}
                  comment={item}
                  grouped={grouped}
                  now={now}
                  onExpand={setExpandedImage}
                />
              );
            })}

            {!comments.length && (
              <div className="mx-auto flex max-w-xs flex-col items-center py-14 text-center">
                <span className="mb-3 grid size-11 place-items-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
                  <MessageCircle size={20} />
                </span>
                <p className="text-sm font-semibold text-slate-700">Start the conversation</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Comments and attachments appear instantly for everyone viewing this task.
                </p>
              </div>
            )}

            {systemEvents.map((event) => (
              <SystemMessage key={event.id}>
                <strong>{event.actor}</strong> changed status from {statusLabels[event.from]} to{" "}
                {statusLabels[event.to]} · {relativeTime(event.createdAt, now)}
              </SystemMessage>
            ))}
            <div ref={messageEndRef} />
          </div>

          <form
            onSubmit={(event) => void sendComment(event)}
            className="shrink-0 border-t border-slate-200 bg-white p-4 sm:p-5"
          >
            {pendingFiles.length > 0 && (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {pendingFiles.map((item, index) => (
                  <div
                    key={`${item.file.name}-${index}`}
                    className="group relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                  >
                    {item.previewUrl ? (
                      <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center px-2 text-slate-500">
                        <FileIcon size={18} />
                        <span className="mt-1 w-full truncate text-center text-[9px]">
                          {item.file.name}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removePendingFile(index)}
                      aria-label={`Remove ${item.file.name}`}
                      className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-slate-950/80 text-white opacity-100 transition hover:bg-rose-600 sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {uploadProgress !== null && (
              <div className="mb-3">
                <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <LoaderCircle size={12} className="animate-spin" /> Uploading attachments…
                  </span>
                  <span>{uploadProgress}%</span>
                </div>
                <LinearProgress
                  aria-label="Attachment upload progress"
                  variant="determinate"
                  value={uploadProgress}
                  sx={{ height: 4, borderRadius: 999 }}
                />
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm transition focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-100">
              <textarea
                ref={commentRef}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void sendComment();
                  }
                }}
                rows={1}
                maxLength={4000}
                placeholder="Write a comment…"
                aria-label="Comment"
                className="block max-h-36 min-h-12 w-full resize-none border-0 bg-transparent px-3.5 pt-3 pb-2 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400"
              />
              <div className="flex items-center justify-between border-t border-slate-100 px-2 py-2">
                <div className="flex items-center gap-1">
                  <label
                    className="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition focus-within:ring-2 focus-within:ring-indigo-500 hover:bg-slate-100 hover:text-slate-900"
                    title="Attach files"
                  >
                    <input
                      type="file"
                      multiple
                      accept={acceptedFiles}
                      onChange={queueCommentFiles}
                      className="sr-only"
                    />
                    <Paperclip size={17} />
                  </label>
                  <span className="hidden text-[10px] text-slate-400 sm:inline">
                    ⌘/Ctrl + Enter to send
                  </span>
                </div>
                <button
                  type="submit"
                  disabled={(!comment.trim() && !pendingFiles.length) || uploadProgress !== null}
                  className="inline-flex h-8 items-center gap-2 rounded-lg bg-indigo-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  Send <Send size={14} />
                </button>
              </div>
            </div>
          </form>
        </aside>

        {error && (
          <div
            role="alert"
            className="fixed right-4 bottom-4 z-[80] flex max-w-sm items-center gap-3 rounded-xl bg-rose-600 px-4 py-3 text-sm font-medium text-white shadow-xl"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
              className="rounded-md p-1 hover:bg-white/15"
            >
              <X size={15} />
            </button>
          </div>
        )}
      </section>

      {expandedImage && (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/90 p-4"
          role="dialog"
          aria-label="Image preview"
          onMouseDown={(event) => event.target === event.currentTarget && setExpandedImage(null)}
        >
          <img
            src={expandedImage}
            alt="Expanded attachment"
            className="max-h-[90vh] max-w-[94vw] rounded-lg object-contain shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setExpandedImage(null)}
            className="absolute top-5 right-5 grid size-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            aria-label="Close image preview"
          >
            <X />
          </button>
        </div>
      )}
    </ModalBackdrop>
  );
}

function ModalBackdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-0 backdrop-blur-[2px] lg:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      {children}
    </div>
  );
}

function FieldShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function FormatButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip title={label} arrow>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="grid size-8 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-900 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-100 to-violet-100 font-bold text-indigo-700 ring-1 ring-indigo-200 ${size === "sm" ? "size-6 text-[9px]" : "size-9 text-[11px]"}`}
    >
      {initials(name)}
    </span>
  );
}

function SystemMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-center text-[11px] leading-5 text-slate-400 before:h-px before:flex-1 before:bg-slate-200 after:h-px after:flex-1 after:bg-slate-200">
      <span className="max-w-[80%]">{children}</span>
    </div>
  );
}

function CommentBubble({
  comment,
  grouped,
  now,
  onExpand,
}: {
  comment: Comment;
  grouped: boolean;
  now: number;
  onExpand: (url: string) => void;
}) {
  return (
    <article className={`flex gap-3 ${grouped ? "-mt-3" : ""}`}>
      <div className="w-9 shrink-0">{!grouped && <Avatar name={comment.author.full_name} />}</div>
      <div className="max-w-[88%] min-w-0">
        {!grouped && (
          <div className="mb-1.5 flex items-baseline gap-2">
            <strong className="text-xs font-semibold text-slate-800">
              {comment.author.full_name}
            </strong>
            <time className="text-[10px] text-slate-400" dateTime={comment.created_at}>
              {relativeTime(comment.created_at, now)}
            </time>
          </div>
        )}
        <div
          className={`overflow-hidden border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-6 text-slate-700 shadow-sm ${grouped ? "rounded-xl" : "rounded-2xl rounded-tl-md"}`}
        >
          <p className="m-0 break-words whitespace-pre-wrap">{comment.body}</p>
          {(comment.attachments ?? []).length > 0 && (
            <div className="mt-2.5 grid grid-cols-1 gap-2">
              {(comment.attachments ?? []).map((attachment) =>
                attachment.mime_type.startsWith("image/") ? (
                  <SecureImage key={attachment.id} attachment={attachment} onExpand={onExpand} />
                ) : (
                  <button
                    key={attachment.id}
                    type="button"
                    onClick={() => void downloadAttachment(attachment)}
                    className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-left text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    <FileText size={16} />
                    <span className="min-w-0 flex-1 truncate">{attachment.original_name}</span>
                    <Download size={14} />
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function TaskAttachmentCard({
  attachment,
  onExpand,
}: {
  attachment: Attachment;
  onExpand: (url: string) => void;
}) {
  const image = attachment.mime_type.startsWith("image/");
  return (
    <div className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      {image ? (
        <SecureImage attachment={attachment} onExpand={onExpand} taskGrid />
      ) : (
        <div className="flex h-28 items-center justify-center bg-slate-50 text-slate-300">
          <FileText size={34} />
        </div>
      )}
      <div className="flex items-center gap-2.5 p-3">
        <span className="grid size-8 place-items-center rounded-lg bg-slate-100 text-slate-500">
          {image ? <ImageIcon size={16} /> : <FileIcon size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-xs font-semibold text-slate-700">
            {attachment.original_name}
          </strong>
          <small className="text-[10px] text-slate-400">{formatBytes(attachment.size_bytes)}</small>
        </span>
        <button
          type="button"
          onClick={() => void downloadAttachment(attachment)}
          aria-label={`Download ${attachment.original_name}`}
          className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
        >
          <Download size={15} />
        </button>
      </div>
    </div>
  );
}

function SecureImage({
  attachment,
  onExpand,
  taskGrid = false,
}: {
  attachment: Attachment;
  onExpand: (url: string) => void;
  taskGrid?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void fetchAttachment(attachment.id)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id]);
  if (!url)
    return (
      <div
        className={`grid animate-pulse place-items-center bg-slate-100 text-slate-300 ${taskGrid ? "h-28" : "h-36 rounded-lg"}`}
      >
        <ImageIcon size={24} />
      </div>
    );
  return (
    <button
      type="button"
      onClick={() => onExpand(url)}
      className={`block w-full overflow-hidden bg-slate-100 text-left focus-visible:ring-2 focus-visible:ring-indigo-500 ${taskGrid ? "h-28" : "max-h-64 rounded-lg"}`}
    >
      <img
        src={url}
        alt={attachment.original_name}
        className={`w-full object-cover transition duration-300 hover:scale-[1.02] ${taskGrid ? "h-28" : "max-h-64"}`}
      />
    </button>
  );
}

function uploadAttachment(path: string, file: File, onProgress: (progress: number) => void) {
  return new Promise<Attachment>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_URL}${path}`);
    const token = getToken();
    if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.upload.onprogress = (event) =>
      event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    request.onerror = () => reject(new Error("Upload connection failed"));
    request.onload = () => {
      const payload = JSON.parse(request.responseText || "{}") as Attachment & {
        error?: { message?: string };
      };
      if (request.status >= 200 && request.status < 300) resolve(payload);
      else reject(new Error(payload.error?.message || "Upload failed"));
    };
    const data = new FormData();
    data.append("file", file);
    request.send(data);
  });
}

async function fetchAttachment(id: string) {
  const response = await fetch(`${API_URL}/attachments/${id}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!response.ok) throw new Error("Could not load attachment");
  return response.blob();
}

async function downloadAttachment(attachment: Attachment) {
  const blob = await fetchAttachment(attachment.id);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.original_name;
  link.click();
  URL.revokeObjectURL(url);
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function roleLabel(role: User["role"]) {
  if (role === "superuser") return "Super user";
  if (role === "org_admin") return "Organization admin";
  return "Member";
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1_048_576) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}

function relativeTime(value: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
