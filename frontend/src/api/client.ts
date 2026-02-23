import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

export const githubApi = {
  listRepos: () => api.get("/github/repos").then((r) => r.data),
  syncRepos: () => api.post("/github/repos/sync").then((r) => r.data),
  getRepoOverview: (owner: string, repo: string) =>
    api.get(`/github/repos/${owner}/${repo}/overview`).then((r) => r.data),
  listIssues: (repo: string, state?: string, assignee?: string, label?: string, days?: number) =>
    api.get("/github/issues", { params: { repo, state, assignee, label, days: days ?? 0 } }).then((r) => r.data),
  createIssue: (data: { repo: string; title: string; body?: string; labels?: string; assignee?: string }) =>
    api.post("/github/issues", data).then((r) => r.data),
  listPRs: (repo: string, state?: string, days?: number) =>
    api.get("/github/prs", { params: { repo, state, days: days ?? 0 } }).then((r) => r.data),
  listCommits: (repo: string, days?: number, author?: string) =>
    api.get("/github/commits", { params: { repo, days: days ?? 0, author } }).then((r) => r.data),
  getActions: (repo: string) =>
    api.get("/github/actions", { params: { repo } }).then((r) => r.data),
  listBranches: (repo: string) => api.get("/github/branches", { params: { repo } }).then((r) => r.data),
  createBranch: (data: { repo: string; branch: string; from_branch?: string }) => api.post("/github/branches", data).then((r) => r.data),
  getPRDetail: (owner: string, repo: string, number: number) => api.get(`/github/prs/${owner}/${repo}/${number}`).then((r) => r.data),
  submitPRReview: (data: { repo: string; number: number; event: string; body?: string }) => api.post("/github/prs/review", data).then((r) => r.data),
  mergePR: (data: { repo: string; number: number; merge_method?: string; commit_title?: string }) => api.post("/github/prs/merge", data).then((r) => r.data),
  searchCode: (q: string, repo?: string) =>
    api.get("/github/search/code", { params: { q, repo } }).then((r) => r.data),
  listReleases: (repo: string) =>
    api.get("/github/releases", { params: { repo } }).then((r) => r.data),
  listContributors: (repo: string) =>
    api.get("/github/contributors", { params: { repo } }).then((r) => r.data),
  listMilestones: (repo: string, state?: string) =>
    api.get("/github/milestones", { params: { repo, state } }).then((r) => r.data),
  getReadme: (repo: string) =>
    api.get("/github/readme", { params: { repo } }).then((r) => r.data),
  getRateLimit: () => api.get("/github/rate-limit").then((r) => r.data),
  getIssueDetail: (owner: string, repo: string, number: number) =>
    api.get(`/github/issues/${owner}/${repo}/${number}`).then((r) => r.data),
  getFileContent: (repo: string, path: string, ref?: string) =>
    api.get("/github/files", { params: { repo, path, ref } }).then((r) => r.data),
  listRepoContents: (repo: string, path: string, ref?: string) =>
    api.get("/github/contents", { params: { repo, path, ref } }).then((r) => r.data),
  listLabels: (repo: string) =>
    api.get("/github/labels", { params: { repo } }).then((r) => r.data),
  listNotifications: () => api.get("/github/notifications").then((r) => r.data),
  compareCommits: (repo: string, base: string, head: string) =>
    api.get("/github/compare", { params: { repo, base, head } }).then((r) => r.data),
  listDeployments: (repo: string) =>
    api.get("/github/deployments", { params: { repo } }).then((r) => r.data),
  listGists: () => api.get("/github/gists").then((r) => r.data),
  createRelease: (data: { repo: string; tag_name: string; name?: string; body?: string; draft?: boolean; prerelease?: boolean }) =>
    api.post("/github/releases", data).then((r) => r.data),
  createMilestone: (data: { repo: string; title: string; description?: string; due_on?: string }) =>
    api.post("/github/milestones", data).then((r) => r.data),
  createGist: (data: { description?: string; public?: boolean; filename?: string; content?: string }) =>
    api.post("/github/gists", data).then((r) => r.data),
};

export const slackApi = {
  listChannels: () => api.get("/slack/channels").then((r) => r.data),
  syncChannels: () => api.post("/slack/channels/sync").then((r) => r.data),
  getChannelMessages: (channelId: string, hours?: number, limit?: number) =>
    api.get(`/slack/channels/${channelId}/messages`, { params: { hours: hours ?? 0, limit: limit ?? 200 } }).then((r) => r.data),
  getThread: (channelId: string, threadTs: string) =>
    api.get(`/slack/thread/${channelId}/${threadTs}`).then((r) => r.data),
  searchMessages: (q: string, channel?: string) =>
    api.get("/slack/search", { params: { q, channel } }).then((r) => r.data),
  postMessage: (channel_id: string, text: string, thread_ts?: string) =>
    api.post("/slack/messages", { channel_id, text, thread_ts }).then((r) => r.data),
  listUsers: () => api.get("/slack/users").then((r) => r.data),
  sendDM: (user_id: string, text: string) => api.post("/slack/dm", { user_id, text }).then((r) => r.data),
  addReaction: (channel_id: string, timestamp: string, emoji: string) => api.post("/slack/reactions", { channel_id, timestamp, emoji }).then((r) => r.data),
  pinMessage: (channel_id: string, timestamp: string) => api.post("/slack/pins", { channel_id, timestamp }).then((r) => r.data),
  listPins: (channelId: string) => api.get(`/slack/channels/${channelId}/pins`).then((r) => r.data),
  listFiles: (channelId?: string, count?: number) =>
    api.get("/slack/files", { params: { channel_id: channelId, count } }).then((r) => r.data),
  listReminders: () => api.get("/slack/reminders").then((r) => r.data),
  listBookmarks: (channelId: string) =>
    api.get(`/slack/channels/${channelId}/bookmarks`).then((r) => r.data),
  listChannelMembers: (channelId: string) =>
    api.get(`/slack/channels/${channelId}/members`).then((r) => r.data),
  deleteMessage: (channel_id: string, ts: string) =>
    api.delete("/slack/messages", { params: { channel_id, ts } }).then((r) => r.data),
};

export type OAuthProvider = "github" | "slack";

export interface OAuthProviderStatus {
  connected: boolean;
  scope?: string;
  meta?: Record<string, string>;
  updated_at?: string;
}

export const oauthApi = {
  status: () =>
    api.get<Record<OAuthProvider, OAuthProviderStatus>>("/oauth/status").then((r) => r.data),
  authorize: (provider: OAuthProvider) =>
    api.get(`/oauth/${provider}/authorize`).then((r) => r.data as { url: string }),
  disconnect: (provider: OAuthProvider) =>
    api.delete(`/oauth/${provider}/disconnect`).then((r) => r.data),
};

// ─── AI API ──────────────────────────────────────────────────────────────────

import type { ChatSession, ChatSessionDetail, AISettings, ModelInfo, TestConnectionResult, Meeting } from "@/types";

export const aiApi = {
  listSessions: () =>
    api.get<ChatSession[]>("/ai/sessions").then((r) => r.data),
  createSession: (data: { title?: string; focused_tab?: string; scope?: string }) =>
    api.post<ChatSession>("/ai/sessions", data).then((r) => r.data),
  getSession: (id: string) =>
    api.get<ChatSessionDetail>(`/ai/sessions/${id}`).then((r) => r.data),
  updateSession: (id: string, data: { title?: string; scope?: string; branch_id?: number }) =>
    api.patch(`/ai/sessions/${id}`, data).then((r) => r.data),
  deleteSession: (id: string) =>
    api.delete(`/ai/sessions/${id}`).then((r) => r.data),
  togglePin: (sessionId: string, messageId: string) =>
    api.post<{ pinned: boolean }>(`/ai/sessions/${sessionId}/pin/${messageId}`).then((r) => r.data),
  createBranch: (sessionId: string, fromMessageId: string) => {
    const formData = new FormData();
    formData.append("from_message_id", fromMessageId);
    return api.post(`/ai/sessions/${sessionId}/branch`, formData).then((r) => r.data);
  },
  uploadFile: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post("/ai/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
  stopGeneration: (sessionId: string) =>
    api.post("/ai/stop", { session_id: sessionId }).then((r) => r.data),
  approve: (sessionId: string, approved: boolean) =>
    api.post("/ai/approve", { session_id: sessionId, approved }).then((r) => r.data),
};

// ─── Meetings API ────────────────────────────────────────────────────────────

export const meetingsApi = {
  list: () =>
    api.get<{ meetings: Meeting[] }>("/meetings/").then((r) => r.data.meetings),
  create: (data: { title?: string; description?: string; meeting_date?: string }) =>
    api.post<Meeting>("/meetings/", data).then((r) => r.data),
  get: (id: string) =>
    api.get<Meeting>(`/meetings/${id}`).then((r) => r.data),
  delete: (id: string) =>
    api.delete(`/meetings/${id}`).then((r) => r.data),
  uploadFile: (meetingId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post(`/meetings/${meetingId}/upload`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
  deleteFile: (meetingId: string, fileId: string) =>
    api.delete(`/meetings/${meetingId}/files/${fileId}`).then((r) => r.data),
  process: (id: string) =>
    api.post(`/meetings/${id}/process`).then((r) => r.data),
  getSummary: (id: string) =>
    api.get(`/meetings/${id}/summary`).then((r) => r.data),
  getActions: (id: string) =>
    api.get(`/meetings/${id}/actions`).then((r) => r.data),
};

// ─── Settings API ────────────────────────────────────────────────────────────

export const settingsApi = {
  getAI: () =>
    api.get<AISettings>("/settings/ai").then((r) => r.data),
  updateAI: (data: Partial<AISettings>) =>
    api.put<AISettings>("/settings/ai", data).then((r) => r.data),
  listModels: (provider: string, modelType: string = "chat") =>
    api.get<{ models: ModelInfo[] }>("/settings/ai/models", { params: { provider, model_type: modelType } }).then((r) => r.data.models),
  testConnection: (provider: string) =>
    api.post<TestConnectionResult>("/settings/ai/test", null, { params: { provider } }).then((r) => r.data),
};
