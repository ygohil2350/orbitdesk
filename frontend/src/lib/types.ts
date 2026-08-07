export type Role = "superuser" | "org_admin" | "member";
export type Status = "todo" | "in_progress" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";
export interface User {
  id: string;
  full_name: string;
  email: string;
  role: Role;
}
export interface Session {
  user: User;
  organization_id: string | null;
  organization_name: string | null;
}
export interface Project {
  id: string;
  name: string;
  key: string;
  description: string;
}
export interface Comment {
  id: string;
  body: string;
  author: User;
  attachments?: Attachment[];
  created_at: string;
}
export interface Attachment {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}
export interface Task {
  id: string;
  project_id: string;
  sequence: number;
  title: string;
  description?: string;
  status: Status;
  priority: Priority;
  assignee: User;
  reporter?: User;
  comments?: Comment[];
  attachments?: Attachment[];
  created_at?: string;
  updated_at: string;
}
export interface TaskPage {
  items: Task[];
  total: number;
  page: number;
  page_size: number;
}
