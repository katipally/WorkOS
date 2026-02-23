import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Github, Loader2, GitPullRequest, AlertCircle, Star, RefreshCw,
  ExternalLink, GitCommit, Workflow, Plus,
  Circle, CheckCircle2, XCircle, Clock, Filter,
  GitBranch, Merge, MessageSquare, Shield, ShieldOff,
  Tag, Users, Milestone, Search, FileText, BookOpen,
  FolderIcon, FileIcon, ArrowLeft, Code, ChevronRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { githubApi } from "@/api/client";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const LANG_COLORS: Record<string, string> = {
  TypeScript: "bg-blue-500", JavaScript: "bg-yellow-400", Python: "bg-green-500",
  Go: "bg-cyan-500", Rust: "bg-orange-500", Java: "bg-red-500", "C++": "bg-pink-500",
  Ruby: "bg-red-400", Swift: "bg-orange-400", Kotlin: "bg-purple-500",
};

const CI_ICON: Record<string, React.ReactNode> = {
  success: <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
  failure: <XCircle className="w-3.5 h-3.5 text-destructive" />,
  in_progress: <Clock className="w-3.5 h-3.5 text-blue-500 animate-spin" />,
  cancelled: <Circle className="w-3.5 h-3.5 text-muted-foreground" />,
  skipped: <Circle className="w-3.5 h-3.5 text-muted-foreground" />,
};

interface Repo { id: number; full_name: string; name: string; description?: string; language?: string; stars: number; forks: number; open_issues: number; is_private: boolean; html_url?: string; default_branch?: string; }
interface Issue { number: number; title: string; state: string; assignee?: string; labels: string[]; created_at: string; updated_at: string; url: string; body?: string; }
interface PR { number: number; title: string; state: string; author: string; base: string; head: string; draft: boolean; updated_at: string; url: string; requested_reviewers: string[]; }
interface Commit { sha: string; message: string; author: string; date: string; url: string; }
interface Run { id: number; name: string; status: string; conclusion?: string; branch: string; created_at: string; url: string; }
interface Branch { name: string; sha: string; protected: boolean; }
interface PRDetail { number: number; title: string; state: string; body: string; author: string; base: string; head: string; draft: boolean; mergeable?: boolean; url: string; reviews: {reviewer: string; state: string; body: string}[]; changed_files: {filename: string; status: string; additions: number; deletions: number}[]; }
interface Release { id: number; tag_name: string; name: string; body: string; draft: boolean; prerelease: boolean; created_at: string; published_at: string; html_url: string; author: string; }
interface Contributor { login: string; avatar_url: string; contributions: number; html_url: string; }
interface GHMilestone { number: number; title: string; state: string; description: string; open_issues: number; closed_issues: number; due_on: string; html_url: string; }
interface CodeSearchResult { path: string; repo: string; sha: string; score: number; html_url: string; text_matches: string[]; }
interface IssueDetail { number: number; title: string; state: string; body: string; author: string; assignee?: string; labels: string[]; created_at: string; updated_at: string; url: string; milestone?: string; comments: { author: string; body: string; created_at: string }[]; }
interface FileContent { path: string; name: string; type: string; content: string; size: number; sha: string; html_url: string; encoding: string; }
interface DirEntry { name: string; path: string; type: string; size: number; sha: string; html_url: string; }

function relTime(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Sidebar tab definitions matching GitHub's real navigation order ── */
type GHTab = "code" | "issues" | "prs" | "actions" | "commits" | "branches" | "releases" | "contributors" | "milestones" | "search";

const GH_SIDEBAR_TABS: { id: GHTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "code",         label: "Code",           icon: Code },
  { id: "issues",       label: "Issues",         icon: AlertCircle },
  { id: "prs",          label: "Pull Requests",  icon: GitPullRequest },
  { id: "commits",      label: "Commits",        icon: GitCommit },
  { id: "actions",      label: "Actions",        icon: Workflow },
  { id: "branches",     label: "Branches",       icon: GitBranch },
  { id: "releases",     label: "Releases",       icon: Tag },
  { id: "contributors", label: "Contributors",   icon: Users },
  { id: "milestones",   label: "Milestones",     icon: Milestone },
  { id: "search",       label: "Code Search",    icon: Search },
];

/** Time-frame filter options (in days). 0 = all time / no limit */
const TIME_FRAME_OPTIONS = [
  { value: "0",   label: "All time" },
  { value: "1",   label: "Last 24h" },
  { value: "7",   label: "Last 7 days" },
  { value: "30",  label: "Last 30 days" },
  { value: "90",  label: "Last 90 days" },
  { value: "365", label: "Last year" },
];

export default function GitHubView() {
  const qc = useQueryClient();
  const { selectedRepo, setSelectedRepo } = useAppStore();
  const [activeGHTab, setActiveGHTab] = useState<GHTab>("code");
  const [issueState, setIssueState] = useState("open");
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", body: "", labels: "", assignee: "" });
  const [showBranchCreate, setShowBranchCreate] = useState(false);
  const [branchForm, setBranchForm] = useState({ branch: "", from_branch: "" });
  const [selectedPR, setSelectedPR] = useState<PR | null>(null);
  const [reviewForm, setReviewForm] = useState({ event: "COMMENT", body: "" });
  const [showMerge, setShowMerge] = useState(false);
  const [mergeMethod, setMergeMethod] = useState("merge");
  const [codeSearchQ, setCodeSearchQ] = useState("");
  // Time-frame filter state (days)
  const [issueDays, setIssueDays] = useState(0);
  const [prDays, setPrDays] = useState(0);
  const [commitDays, setCommitDays] = useState(0);
  // File browser state
  const [browsePath, setBrowsePath] = useState("");
  const [viewingFile, setViewingFile] = useState("");

  const activeRepo = selectedRepo === "__none__" ? "" : selectedRepo;
  const owner = activeRepo.split("/")[0] ?? "";
  const repoName = activeRepo.split("/")[1] ?? "";

  const syncReposMut = useMutation({
    mutationFn: githubApi.syncRepos,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gh-repos"] }); toast.success("Repos synced"); },
    onError: () => toast.error("Failed to sync repos"),
  });

  const { data: repos = [], isLoading: reposLoading } = useQuery<Repo[]>({
    queryKey: ["gh-repos"], queryFn: githubApi.listRepos, retry: false,
  });

  useEffect(() => {
    if (repos.length > 0 && selectedRepo === "__none__") setSelectedRepo(repos[0].full_name);
  }, [repos, selectedRepo]);

  // Reset browsing state when repo changes
  useEffect(() => {
    setBrowsePath("");
    setViewingFile("");
  }, [activeRepo]);

  const { data: issues = [], isLoading: issuesLoading, isError: issuesError, refetch: refetchIssues } = useQuery<Issue[]>({
    queryKey: ["gh-issues", activeRepo, issueState, issueDays],
    queryFn: () => githubApi.listIssues(activeRepo, issueState, undefined, undefined, issueDays),
    enabled: !!activeRepo,
  });
  const { data: prs = [], isLoading: prsLoading, isError: prsError } = useQuery<PR[]>({
    queryKey: ["gh-prs", activeRepo, prDays],
    queryFn: () => githubApi.listPRs(activeRepo, undefined, prDays),
    enabled: !!activeRepo,
  });
  const { data: commits = [], isLoading: commitsLoading, isError: commitsError } = useQuery<Commit[]>({
    queryKey: ["gh-commits", activeRepo, commitDays],
    queryFn: () => githubApi.listCommits(activeRepo, commitDays),
    enabled: !!activeRepo,
  });

  const { data: runs = [], isLoading: runsLoading, isError: runsError } = useQuery<Run[]>({
    queryKey: ["gh-actions", activeRepo],
    queryFn: () => githubApi.getActions(activeRepo),
    enabled: !!activeRepo,
  });

  const { data: branches = [], isLoading: branchesLoading, isError: branchesError } = useQuery<Branch[]>({
    queryKey: ["gh-branches", activeRepo],
    queryFn: () => githubApi.listBranches(activeRepo),
    enabled: !!activeRepo,
  });
  const { data: prDetail } = useQuery<PRDetail>({
    queryKey: ["gh-pr-detail", activeRepo, selectedPR?.number],
    queryFn: () => githubApi.getPRDetail(owner, repoName, selectedPR!.number),
    enabled: !!activeRepo && !!selectedPR,
  });

  const { data: releases = [], isLoading: releasesLoading, isError: releasesError } = useQuery<Release[]>({
    queryKey: ["gh-releases", activeRepo],
    queryFn: () => githubApi.listReleases(activeRepo),
    enabled: !!activeRepo,
  });
  const { data: contributors = [], isLoading: contribLoading, isError: contribError } = useQuery<Contributor[]>({
    queryKey: ["gh-contributors", activeRepo],
    queryFn: () => githubApi.listContributors(activeRepo),
    enabled: !!activeRepo,
  });
  const { data: milestones = [], isLoading: milestonesLoading, isError: milestonesError } = useQuery<GHMilestone[]>({
    queryKey: ["gh-milestones", activeRepo],
    queryFn: () => githubApi.listMilestones(activeRepo),
    enabled: !!activeRepo,
  });
  const { data: readme } = useQuery<{ name: string; content: string; html_url: string }>({
    queryKey: ["gh-readme", activeRepo],
    queryFn: () => githubApi.getReadme(activeRepo),
    enabled: !!activeRepo, retry: false,
  });
  const { data: issueDetail } = useQuery<IssueDetail>({
    queryKey: ["gh-issue-detail", activeRepo, selectedIssue?.number],
    queryFn: () => githubApi.getIssueDetail(owner, repoName, selectedIssue!.number),
    enabled: !!activeRepo && !!selectedIssue,
  });
  const { data: fileContent, isLoading: fileLoading, isError: fileError } = useQuery<FileContent>({
    queryKey: ["gh-file", activeRepo, viewingFile],
    queryFn: () => githubApi.getFileContent(activeRepo, viewingFile),
    enabled: !!activeRepo && viewingFile.length > 0, retry: false,
  });

  // Directory listing for file browser
  const { data: dirEntries = [], isLoading: dirLoading, isError: dirError } = useQuery<DirEntry[]>({
    queryKey: ["gh-dir", activeRepo, browsePath],
    queryFn: () => githubApi.listRepoContents(activeRepo, browsePath),
    enabled: !!activeRepo && activeGHTab === "code" && !viewingFile,
    retry: false,
  });
  const { data: rateLimit } = useQuery<{ limit: number; remaining: number; reset: number; used: number }>({
    queryKey: ["gh-rate-limit"],
    queryFn: githubApi.getRateLimit,
    refetchInterval: 60000,
  });
  const { data: codeResults = [], isLoading: codeSearchLoading, isError: codeSearchError } = useQuery<CodeSearchResult[]>({
    queryKey: ["gh-code-search", codeSearchQ, activeRepo],
    queryFn: () => githubApi.searchCode(codeSearchQ, activeRepo || undefined),
    enabled: codeSearchQ.length > 2,
    retry: false,
  });

  const createBranchMut = useMutation({
    mutationFn: () => githubApi.createBranch({ repo: activeRepo, ...branchForm }),
    onSuccess: (d) => { toast.success(`Branch '${d.branch}' created from '${d.from}'`); setShowBranchCreate(false); setBranchForm({ branch: "", from_branch: "" }); qc.invalidateQueries({ queryKey: ["gh-branches", activeRepo] }); },
    onError: () => toast.error("Failed to create branch"),
  });
  const reviewMut = useMutation({
    mutationFn: () => githubApi.submitPRReview({ repo: activeRepo, number: selectedPR!.number, event: reviewForm.event, body: reviewForm.body }),
    onSuccess: () => { toast.success("Review submitted"); setReviewForm({ event: "COMMENT", body: "" }); qc.invalidateQueries({ queryKey: ["gh-pr-detail", activeRepo, selectedPR?.number] }); },
    onError: () => toast.error("Failed to submit review"),
  });
  const mergeMut = useMutation({
    mutationFn: () => githubApi.mergePR({ repo: activeRepo, number: selectedPR!.number, merge_method: mergeMethod }),
    onSuccess: (d) => { toast.success(d.merged ? "PR merged!" : d.message); setShowMerge(false); setSelectedPR(null); qc.invalidateQueries({ queryKey: ["gh-prs", activeRepo] }); },
    onError: () => toast.error("Failed to merge PR"),
  });

  const createMut = useMutation({
    mutationFn: () => githubApi.createIssue({ repo: activeRepo, ...createForm }),
    onSuccess: () => { toast.success("Issue created"); setShowCreate(false); setCreateForm({ title: "", body: "", labels: "", assignee: "" }); qc.invalidateQueries({ queryKey: ["gh-issues", activeRepo] }); },
    onError: () => toast.error("Failed to create issue"),
  });

  const currentRepo = repos.find(r => r.full_name === activeRepo);

  /** Breadcrumb segments for file browser */
  const breadcrumbs = useMemo(() => {
    if (!browsePath && !viewingFile) return [];
    const p = viewingFile || browsePath;
    const parts = p.split("/").filter(Boolean);
    const segs: { label: string; path: string }[] = [];
    for (let i = 0; i < parts.length; i++) {
      segs.push({ label: parts[i], path: parts.slice(0, i + 1).join("/") });
    }
    return segs;
  }, [browsePath, viewingFile]);

  const navigateToDir = (path: string) => { setBrowsePath(path); setViewingFile(""); };
  const navigateToFile = (path: string) => { setViewingFile(path); };

  return (
    <>
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar */}
      <div className="w-56 shrink-0 flex flex-col bg-sidebar border-r overflow-hidden">
        <div className="px-3 py-2.5 border-b flex items-center gap-2 shrink-0">
          <Github className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">GitHub</span>
        </div>
        {/* Repo selector */}
        <div className="p-2 border-b shrink-0 flex items-center gap-1.5">
          {reposLoading ? <Skeleton className="h-8 w-full rounded" /> : (
            <>
              <Select value={selectedRepo} onValueChange={setSelectedRepo}>
                <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Select repository..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">Select a repository…</SelectItem>
                  {repos.map(r => <SelectItem key={r.full_name} value={r.full_name} className="text-xs">{r.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
              <button onClick={() => syncReposMut.mutate()} disabled={syncReposMut.isPending}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-1" title="Sync repos" aria-label="Sync repos">
                <RefreshCw className={cn("w-3.5 h-3.5", syncReposMut.isPending && "animate-spin")} />
              </button>
            </>
          )}
        </div>
        {/* Navigation tabs - sidebar style */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 py-1">Navigation</p>
            {GH_SIDEBAR_TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => { setActiveGHTab(id); if (id === "code") setViewingFile(""); }}
                className={cn("w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors flex items-center gap-2",
                  activeGHTab === id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground")}>
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 truncate">{label}</span>
                {id === "issues" && issues.length > 0 && <Badge variant="secondary" className="text-[9px] h-4 px-1">{issues.length}</Badge>}
                {id === "prs" && prs.length > 0 && <Badge variant="secondary" className="text-[9px] h-4 px-1">{prs.length}</Badge>}
                {id === "commits" && commits.length > 0 && <Badge variant="secondary" className="text-[9px] h-4 px-1">{commits.length}</Badge>}
              </button>
            ))}

            {/* Quick actions */}
            {activeRepo && (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 pt-3 pb-1">Actions</p>
                <button onClick={() => setShowCreate(true)}
                  className="w-full text-left px-2.5 py-1.5 rounded-md text-xs hover:bg-accent transition-colors flex items-center gap-2 text-muted-foreground hover:text-foreground">
                  <Plus className="w-3.5 h-3.5" /> New Issue
                </button>
                <button onClick={() => setShowBranchCreate(true)}
                  className="w-full text-left px-2.5 py-1.5 rounded-md text-xs hover:bg-accent transition-colors flex items-center gap-2 text-muted-foreground hover:text-foreground">
                  <GitBranch className="w-3.5 h-3.5" /> New Branch
                </button>
                {currentRepo?.html_url && (
                  <a href={currentRepo.html_url} target="_blank" rel="noopener noreferrer"
                    className="w-full text-left px-2.5 py-1.5 rounded-md text-xs hover:bg-accent transition-colors flex items-center gap-2 text-muted-foreground hover:text-foreground">
                    <ExternalLink className="w-3.5 h-3.5" /> Open on GitHub
                  </a>
                )}
              </>
            )}

            {/* Rate limit */}
            {rateLimit && (
              <div className="mt-3 px-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">API Rate Limit</p>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((rateLimit.limit - rateLimit.remaining) / rateLimit.limit) * 100}%` }} />
                  </div>
                  <span className="text-muted-foreground shrink-0">{rateLimit.remaining}/{rateLimit.limit}</span>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="px-4 py-2.5 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Github className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-semibold truncate">{activeRepo || "No repository selected"}</span>
            {currentRepo?.language && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                <span className={cn("w-2 h-2 rounded-full", LANG_COLORS[currentRepo.language] ?? "bg-muted-foreground")} />
                {currentRepo.language}
              </span>
            )}
            {currentRepo && <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0"><Star className="w-3 h-3" />{currentRepo.stars}</span>}
          </div>
          {activeRepo && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 shrink-0" onClick={() => setShowCreate(true)}>
              <Plus className="w-3.5 h-3.5" /> New Issue
            </Button>
          )}
        </div>

        {!activeRepo ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground overflow-auto">
            <Github className="w-12 h-12 opacity-30 mb-3" />
            <p className="text-sm font-medium">No repository selected</p>
            <p className="text-xs mt-1">Connect GitHub in Settings &rarr; Integrations</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* ══ CODE TAB ══ */}
            {activeGHTab === "code" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Breadcrumb */}
                <div className="flex items-center gap-1 px-4 py-2 border-b shrink-0 text-xs overflow-x-auto">
                  <button onClick={() => navigateToDir("")} className="hover:text-primary transition-colors font-medium shrink-0">
                    <FolderIcon className="w-3.5 h-3.5 inline mr-1" />{repoName || "root"}
                  </button>
                  {breadcrumbs.map((seg, i) => (
                    <span key={seg.path} className="flex items-center gap-1 shrink-0">
                      <ChevronRight className="w-3 h-3 text-muted-foreground" />
                      {i < breadcrumbs.length - 1 ? (
                        <button onClick={() => navigateToDir(seg.path)} className="hover:text-primary transition-colors">{seg.label}</button>
                      ) : (
                        <span className="font-medium text-foreground">{seg.label}</span>
                      )}
                    </span>
                  ))}
                  <span className="ml-auto text-muted-foreground shrink-0">{currentRepo?.default_branch ?? "main"}</span>
                </div>

                {viewingFile ? (
                  /* ── File viewer ── */
                  <ScrollArea className="flex-1 min-h-0">
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => {
                          const parts = viewingFile.split("/"); parts.pop();
                          navigateToDir(parts.join("/"));
                        }}>
                          <ArrowLeft className="w-3 h-3" /> Back
                        </Button>
                        <span className="text-xs font-mono text-muted-foreground flex-1 truncate">{viewingFile}</span>
                        {fileContent?.html_url && (
                          <a href={fileContent.html_url} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"><ExternalLink className="w-3 h-3" />GitHub</Button>
                          </a>
                        )}
                      </div>
                      {fileLoading ? (
                        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-4 rounded" />)}</div>
                      ) : fileError ? (
                        <div className="flex flex-col items-center py-16 text-destructive">
                          <AlertCircle className="w-10 h-10 opacity-50 mb-2" />
                          <p className="text-sm font-medium">Failed to load file</p>
                          <p className="text-xs text-muted-foreground mt-1">The file may be too large or binary</p>
                        </div>
                      ) : fileContent ? (
                        <>
                          <div className="flex items-center gap-3 mb-3 text-[11px] text-muted-foreground">
                            <span>{formatBytes(fileContent.size)}</span>
                            <code className="font-mono">{fileContent.sha?.slice(0, 7)}</code>
                          </div>
                          {(viewingFile.endsWith(".md") || viewingFile.endsWith(".mdx")) ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg border p-6 bg-card">
                              <ReactMarkdown>{fileContent.content}</ReactMarkdown>
                            </div>
                          ) : (
                            <div className="rounded-lg border overflow-hidden bg-muted/20">
                              <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30 text-[11px] text-muted-foreground">
                                <FileIcon className="w-3 h-3" />
                                <span className="font-mono">{fileContent.name || viewingFile.split("/").pop()}</span>
                                <span className="ml-auto">{fileContent.content?.split("\n").length ?? 0} lines</span>
                              </div>
                              <pre className="text-[12px] font-mono p-4 overflow-x-auto whitespace-pre leading-relaxed max-h-[70vh] overflow-y-auto">
                                <code>{fileContent.content}</code>
                              </pre>
                            </div>
                          )}
                        </>
                      ) : null}
                    </div>
                  </ScrollArea>
                ) : (
                  /* ── Directory listing ── */
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <ScrollArea className="flex-1 min-h-0">
                      {dirLoading ? (
                        <div className="p-4 space-y-1">{[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-9 rounded" />)}</div>
                      ) : dirError ? (
                        <div className="flex flex-col items-center py-16 text-destructive">
                          <AlertCircle className="w-10 h-10 opacity-50 mb-2" />
                          <p className="text-sm font-medium">Failed to load directory</p>
                          <p className="text-xs text-muted-foreground mt-1">Check your GitHub connection</p>
                        </div>
                      ) : dirEntries.length === 0 ? (
                        <div className="flex flex-col items-center py-16 text-muted-foreground">
                          <FolderIcon className="w-10 h-10 opacity-30 mb-2" />
                          <p className="text-sm">Empty directory</p>
                        </div>
                      ) : (
                        <div className="divide-y">
                          {browsePath && (
                            <button onClick={() => { const parts = browsePath.split("/"); parts.pop(); navigateToDir(parts.join("/")); }}
                              className="w-full text-left flex items-center gap-3 px-4 py-2 hover:bg-muted/30 transition-colors text-xs text-muted-foreground">
                              <ArrowLeft className="w-3.5 h-3.5" /> <span>..</span>
                            </button>
                          )}
                          {dirEntries.map(entry => (
                            <button key={entry.path}
                              onClick={() => entry.type === "dir" ? navigateToDir(entry.path) : navigateToFile(entry.path)}
                              className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group">
                              {entry.type === "dir"
                                ? <FolderIcon className="w-4 h-4 text-blue-500 shrink-0" />
                                : <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />}
                              <span className="text-xs font-mono flex-1 truncate">{entry.name}</span>
                              {entry.type === "file" && entry.size > 0 && (
                                <span className="text-[10px] text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">{formatBytes(entry.size)}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* README inline below file tree at root */}
                      {!browsePath && readme?.content && (
                        <div className="border-t">
                          <div className="px-4 py-3 border-b bg-muted/20 flex items-center gap-2">
                            <BookOpen className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs font-semibold">README.md</span>
                          </div>
                          <div className="prose prose-sm dark:prose-invert max-w-none px-6 py-4">
                            <ReactMarkdown>{readme.content}</ReactMarkdown>
                          </div>
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                )}
              </div>
            )}

            {/* ══ ISSUES TAB ══ */}
            {activeGHTab === "issues" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
                  <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                  <Select value={issueState} onValueChange={v => { setIssueState(v); void refetchIssues(); }}>
                    <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open" className="text-xs">Open</SelectItem>
                      <SelectItem value="closed" className="text-xs">Closed</SelectItem>
                      <SelectItem value="all" className="text-xs">All</SelectItem>
                    </SelectContent>
                  </Select>
                  <Clock className="w-3.5 h-3.5 text-muted-foreground ml-1" />
                  <Select value={String(issueDays)} onValueChange={v => setIssueDays(Number(v))}>
                    <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIME_FRAME_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <ScrollArea className="flex-1 min-h-0">
                  <div className="divide-y">
                    {issuesLoading ? [1,2,3,4].map(i => <Skeleton key={i} className="h-14 mx-4 my-2 rounded" />) :
                     issuesError ? (
                      <div className="flex flex-col items-center py-16 text-destructive">
                        <AlertCircle className="w-10 h-10 opacity-50 mb-2" />
                        <p className="text-sm font-medium">Failed to load issues</p>
                        <p className="text-xs text-muted-foreground mt-1">Check your GitHub connection in Settings</p>
                        <Button size="sm" variant="outline" className="mt-3 text-xs gap-1.5" onClick={() => void refetchIssues()}>
                          <RefreshCw className="w-3 h-3" /> Retry
                        </Button>
                      </div>
                    ) :
                     issues.length === 0 ? (
                      <div className="flex flex-col items-center py-16 text-muted-foreground">
                        <AlertCircle className="w-10 h-10 opacity-30 mb-2" />
                        <p className="text-sm">No {issueState} issues</p>
                      </div>
                    ) : issues.map(issue => (
                      <button key={issue.number} onClick={() => setSelectedIssue(issue)}
                        className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            <AlertCircle className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", issue.state === "open" ? "text-green-500" : "text-purple-500")} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium leading-snug line-clamp-1">{issue.title}</p>
                              <p className="text-[11px] text-muted-foreground">#{issue.number} &middot; {issue.assignee ? `@${issue.assignee}` : "unassigned"} &middot; {relTime(issue.updated_at)}</p>
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                            {issue.labels.slice(0,2).map(l => <Badge key={l} variant="outline" className="text-[10px] px-1 h-4">{l}</Badge>)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* ══ PRS TAB ══ */}
            {activeGHTab === "prs" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  <Select value={String(prDays)} onValueChange={v => setPrDays(Number(v))}>
                    <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIME_FRAME_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-[11px] text-muted-foreground ml-auto">{prs.length} PR{prs.length !== 1 ? "s" : ""}</span>
                </div>
                <ScrollArea className="flex-1 min-h-0">
                <div className="divide-y">
                  {prsLoading ? [1,2,3].map(i => <Skeleton key={i} className="h-14 mx-4 my-2 rounded" />) :
                   prsError ? (
                    <div className="flex flex-col items-center py-16 text-destructive">
                      <AlertCircle className="w-10 h-10 opacity-50 mb-2" />
                      <p className="text-sm font-medium">Failed to load pull requests</p>
                    </div>
                  ) :
                   prs.length === 0 ? (
                    <div className="flex flex-col items-center py-16 text-muted-foreground">
                      <GitPullRequest className="w-10 h-10 opacity-30 mb-2" />
                      <p className="text-sm">No pull requests found</p>
                    </div>
                  ) : prs.map(pr => (
                    <button key={pr.number} onClick={() => setSelectedPR(pr)}
                      className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                      <GitPullRequest className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", pr.draft ? "text-muted-foreground" : "text-green-500")} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium line-clamp-1">{pr.title} {pr.draft && <Badge variant="secondary" className="text-[10px] ml-1">draft</Badge>}</p>
                        <p className="text-[11px] text-muted-foreground">#{pr.number} by @{pr.author} &middot; {pr.head} &rarr; {pr.base} &middot; {relTime(pr.updated_at)}</p>
                      </div>
                      {pr.requested_reviewers.length > 0 && <Badge variant="outline" className="text-[10px] shrink-0">{pr.requested_reviewers.length} reviewer{pr.requested_reviewers.length > 1 ? "s" : ""}</Badge>}
                    </button>
                  ))}
                </div>
                </ScrollArea>
              </div>
            )}

            {/* ══ ACTIONS TAB ══ */}
            {activeGHTab === "actions" && (
              <ScrollArea className="flex-1 min-h-0">
                <div className="divide-y">
                  {runsLoading ? [1,2,3].map(i => <Skeleton key={i} className="h-12 mx-4 my-2 rounded" />) :
                   runsError ? (
                    <div className="flex flex-col items-center py-16 text-destructive">
                      <AlertCircle className="w-10 h-10 opacity-50 mb-2" />
                      <p className="text-sm font-medium">Failed to load workflow runs</p>
                    </div>
                  ) :
                   runs.length === 0 ? (
                    <div className="flex flex-col items-center py-16 text-muted-foreground">
                      <Workflow className="w-10 h-10 opacity-30 mb-2" />
                      <p className="text-sm">No recent workflow runs</p>
                    </div>
                  ) : runs.map(r => (
                    <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                      <span className="shrink-0">{CI_ICON[r.conclusion ?? r.status] ?? <Circle className="w-3.5 h-3.5" />}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{r.name}</p>
                        <p className="text-[11px] text-muted-foreground">{r.branch} &middot; {relTime(r.created_at)}</p>
                      </div>
                      <Badge variant={r.conclusion === "success" ? "default" : r.conclusion === "failure" ? "destructive" : "secondary"}
                        className="text-[10px] shrink-0">{r.conclusion ?? r.status}</Badge>
                    </a>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* ══ COMMITS TAB ══ */}
            {activeGHTab === "commits" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  <Select value={String(commitDays)} onValueChange={v => setCommitDays(Number(v))}>
                    <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIME_FRAME_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-[11px] text-muted-foreground ml-auto">{commits.length} commit{commits.length !== 1 ? "s" : ""}</span>
                </div>
                <ScrollArea className="flex-1 min-h-0">
                  <div className="divide-y">
                    {commitsLoading ? [1,2,3,4].map(i => <Skeleton key={i} className="h-12 mx-4 my-2 rounded" />) :
                     commitsError ? (
                      <div className="flex flex-col items-center py-16 text-destructive">
                        <AlertCircle className="w-10 h-10 opacity-50 mb-2" />
                        <p className="text-sm font-medium">Failed to load commits</p>
                      </div>
                    ) :
                     commits.length === 0 ? (
                      <div className="flex flex-col items-center py-16 text-muted-foreground">
                        <GitCommit className="w-10 h-10 opacity-30 mb-2" />
                        <p className="text-sm">No commits found</p>
                      </div>
                    ) : commits.map(c => (
                      <a key={c.sha} href={c.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                        <GitCommit className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium line-clamp-1">{c.message}</p>
                          <p className="text-[11px] text-muted-foreground">
                            <code className="font-mono">{c.sha}</code> &middot; @{c.author} &middot; {c.date ? relTime(c.date) : ""}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* ══ BRANCHES TAB ══ */}
            {activeGHTab === "branches" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
                  <span className="text-xs text-muted-foreground">{branches.length} branch{branches.length !== 1 ? "es" : ""}</span>
                  <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={() => setShowBranchCreate(true)}>
                    <Plus className="w-3 h-3" /> New Branch
                  </Button>
                </div>
                <ScrollArea className="flex-1 min-h-0">
                  <div className="divide-y">
                    {branchesLoading ? [1,2,3].map(i => <Skeleton key={i} className="h-10 mx-4 my-1.5 rounded" />) :
                     branchesError ? (
                      <div className="flex flex-col items-center py-16 text-destructive">
                        <AlertCircle className="w-10 h-10 opacity-50 mb-2" />
                        <p className="text-sm font-medium">Failed to load branches</p>
                      </div>
                    ) :
                     branches.length === 0 ? (
                      <div className="flex flex-col items-center py-16 text-muted-foreground">
                        <GitBranch className="w-10 h-10 opacity-30 mb-2" />
                        <p className="text-sm">No branches found</p>
                      </div>
                    ) : branches.map(b => (
                      <div key={b.name} className="flex items-center gap-3 px-4 py-2.5">
                        <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs font-mono flex-1 truncate">{b.name}</span>
                        <code className="text-[10px] text-muted-foreground font-mono">{b.sha}</code>
                        {b.protected ? <Shield className="w-3 h-3 text-amber-500" /> : <ShieldOff className="w-3 h-3 text-muted-foreground/40" />}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* ══ RELEASES TAB ══ */}
            {activeGHTab === "releases" && (
              <ScrollArea className="flex-1 min-h-0">
                <div className="divide-y">
                  {releasesLoading ? [1,2,3].map(i => <Skeleton key={i} className="h-14 mx-4 my-2 rounded" />) :
                   releasesError ? (
                    <div className="flex flex-col items-center py-16 text-destructive">
                      <AlertCircle className="w-10 h-10 opacity-50 mb-2" />
                      <p className="text-sm font-medium">Failed to load releases</p>
                    </div>
                  ) :
                   releases.length === 0 ? (
                    <div className="flex flex-col items-center py-16 text-muted-foreground">
                      <Tag className="w-10 h-10 opacity-30 mb-2" />
                      <p className="text-sm">No releases</p>
                    </div>
                  ) : releases.map(r => (
                    <a key={r.id} href={r.html_url} target="_blank" rel="noopener noreferrer"
                      className="block px-4 py-3 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium">{r.name || r.tag_name}</span>
                        <code className="text-[10px] text-muted-foreground font-mono">{r.tag_name}</code>
                        {r.prerelease && <Badge variant="secondary" className="text-[10px]">pre</Badge>}
                        {r.draft && <Badge variant="outline" className="text-[10px]">draft</Badge>}
                      </div>
                      <p className="text-[11px] text-muted-foreground">by @{r.author} &middot; {relTime(r.published_at || r.created_at)}</p>
                      {r.body && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.body}</p>}
                    </a>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* ══ CONTRIBUTORS TAB ══ */}
            {activeGHTab === "contributors" && (
              <ScrollArea className="flex-1 min-h-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-4">
                  {contribLoading ? [1,2,3,4].map(i => <Skeleton key={i} className="h-14 rounded" />) :
                   contribError ? (
                    <div className="col-span-2 flex flex-col items-center py-16 text-destructive">
                      <AlertCircle className="w-10 h-10 opacity-50 mb-2" />
                      <p className="text-sm font-medium">Failed to load contributors</p>
                    </div>
                  ) :
                   contributors.length === 0 ? (
                    <div className="col-span-2 flex flex-col items-center py-16 text-muted-foreground">
                      <Users className="w-10 h-10 opacity-30 mb-2" />
                      <p className="text-sm">No contributors</p>
                    </div>
                  ) : contributors.map(c => (
                    <a key={c.login} href={c.html_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                      <img src={c.avatar_url} alt={c.login} className="w-8 h-8 rounded-full shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">@{c.login}</p>
                        <p className="text-[11px] text-muted-foreground">{c.contributions} commits</p>
                      </div>
                    </a>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* ══ MILESTONES TAB ══ */}
            {activeGHTab === "milestones" && (
              <ScrollArea className="flex-1 min-h-0">
                <div className="divide-y">
                  {milestonesLoading ? [1,2,3].map(i => <Skeleton key={i} className="h-14 mx-4 my-2 rounded" />) :
                   milestonesError ? (
                    <div className="flex flex-col items-center py-16 text-destructive">
                      <AlertCircle className="w-10 h-10 opacity-50 mb-2" />
                      <p className="text-sm font-medium">Failed to load milestones</p>
                    </div>
                  ) :
                   milestones.length === 0 ? (
                    <div className="flex flex-col items-center py-16 text-muted-foreground">
                      <Milestone className="w-10 h-10 opacity-30 mb-2" />
                      <p className="text-sm">No milestones</p>
                    </div>
                  ) : milestones.map(m => (
                    <a key={m.number} href={m.html_url} target="_blank" rel="noopener noreferrer"
                      className="block px-4 py-3 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Milestone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium">{m.title}</span>
                        <Badge variant={m.state === "open" ? "default" : "secondary"} className="text-[10px]">{m.state}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                        <span>{m.open_issues} open · {m.closed_issues} closed</span>
                        {m.due_on && <span>Due {new Date(m.due_on).toLocaleDateString()}</span>}
                      </div>
                      {m.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{m.description}</p>}
                    </a>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* ══ CODE SEARCH TAB ══ */}
            {activeGHTab === "search" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
                  <Search className="w-3.5 h-3.5 text-muted-foreground" />
                  <Input value={codeSearchQ} onChange={e => setCodeSearchQ(e.target.value)}
                    placeholder="Search code..." className="h-7 text-xs flex-1" />
                </div>
                <ScrollArea className="flex-1 min-h-0">
                  <div className="divide-y">
                    {codeSearchLoading ? [1,2,3].map(i => <Skeleton key={i} className="h-12 mx-4 my-2 rounded" />) :
                     codeSearchError ? (
                      <div className="flex flex-col items-center py-16 text-destructive">
                        <AlertCircle className="w-10 h-10 opacity-50 mb-2" />
                        <p className="text-sm font-medium">Code search failed</p>
                      </div>
                    ) :
                     codeResults.length === 0 ? (
                      <div className="flex flex-col items-center py-16 text-muted-foreground">
                        <Search className="w-10 h-10 opacity-30 mb-2" />
                        <p className="text-sm">{codeSearchQ.length > 2 ? "No results" : "Search across code"}</p>
                      </div>
                    ) : codeResults.map((r, i) => (
                      <a key={`${r.sha}-${i}`} href={r.html_url} target="_blank" rel="noopener noreferrer"
                        className="block px-4 py-3 hover:bg-muted/30 transition-colors">
                        <div className="flex items-center gap-2 mb-0.5">
                          <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="text-xs font-mono font-medium truncate">{r.path}</span>
                          <code className="text-[10px] text-muted-foreground">{r.repo}</code>
                        </div>
                        {r.text_matches?.[0] && (
                          <p className="text-[11px] text-muted-foreground mt-1 font-mono line-clamp-2">{r.text_matches[0]}</p>
                        )}
                      </a>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

          </div>
        )}
      </div>
    </div>

    {/* Issue detail dialog */}
    <Dialog open={!!selectedIssue} onOpenChange={o => !o && setSelectedIssue(null)}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm leading-snug">{selectedIssue?.title}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-3 text-xs pr-1">
            <div className="flex items-center gap-2 text-muted-foreground flex-wrap">
              <Badge variant={selectedIssue?.state === "open" ? "default" : "secondary"} className="text-[10px]">{selectedIssue?.state}</Badge>
              <span>#{selectedIssue?.number}</span>
              {(issueDetail?.author || selectedIssue?.assignee) && <span>@{issueDetail?.author || selectedIssue?.assignee}</span>}
              {selectedIssue?.created_at && <span>{relTime(selectedIssue.created_at)}</span>}
            </div>
            {selectedIssue?.labels && selectedIssue.labels.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {selectedIssue.labels.map(l => <Badge key={l} variant="outline" className="text-[10px]">{l}</Badge>)}
              </div>
            )}
            {(issueDetail?.body || selectedIssue?.body) && (
              <div className="rounded border p-3 bg-muted/20">
                <div className="prose prose-xs dark:prose-invert max-w-none"><ReactMarkdown>{issueDetail?.body ?? selectedIssue?.body ?? ""}</ReactMarkdown></div>
              </div>
            )}
            {issueDetail?.comments && issueDetail.comments.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">{issueDetail.comments.length} comment{issueDetail.comments.length !== 1 ? "s" : ""}</p>
                <div className="space-y-2">
                  {issueDetail.comments.map((c, i) => (
                    <div key={i} className="rounded border p-2.5 bg-muted/10">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="font-semibold text-xs">@{c.author}</span>
                        <span className="text-[10px] text-muted-foreground">{relTime(c.created_at)}</span>
                      </div>
                      <div className="prose prose-xs dark:prose-invert max-w-none"><ReactMarkdown>{c.body}</ReactMarkdown></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <a href={selectedIssue?.url} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="text-xs gap-1.5"><ExternalLink className="w-3 h-3" />Open on GitHub</Button>
          </a>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* PR detail / review / merge dialog */}
    <Dialog open={!!selectedPR} onOpenChange={o => !o && setSelectedPR(null)}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm leading-snug pr-6">{selectedPR?.title}</DialogTitle>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={selectedPR?.draft ? "secondary" : "default"} className="text-[10px]">{selectedPR?.draft ? "Draft" : "Open"}</Badge>
            <span className="text-xs text-muted-foreground">#{selectedPR?.number} &middot; @{selectedPR?.author} &middot; {selectedPR?.head} &rarr; {selectedPR?.base}</span>
          </div>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-4 pr-1">
            {prDetail?.body && (
              <div className="rounded border p-3 bg-muted/20 text-xs">
                <ReactMarkdown>{prDetail.body}</ReactMarkdown>
              </div>
            )}
            {prDetail?.changed_files && prDetail.changed_files.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{prDetail.changed_files.length} changed files</p>
                <div className="space-y-1">
                  {prDetail.changed_files.map(f => (
                    <div key={f.filename} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className={cn("text-[9px] shrink-0", f.status === "added" ? "border-green-500 text-green-600" : f.status === "removed" ? "border-red-500 text-red-600" : "border-blue-500 text-blue-600")}>{f.status}</Badge>
                      <code className="flex-1 truncate text-[11px]">{f.filename}</code>
                      <span className="text-green-600 shrink-0">+{f.additions}</span>
                      <span className="text-red-600 shrink-0">-{f.deletions}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {prDetail?.reviews && prDetail.reviews.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Reviews</p>
                <div className="space-y-1.5">
                  {prDetail.reviews.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs p-2 rounded border bg-muted/20">
                      <Badge variant={r.state === "APPROVED" ? "default" : r.state === "CHANGES_REQUESTED" ? "destructive" : "secondary"} className="text-[9px] shrink-0">{r.state}</Badge>
                      <span className="font-medium shrink-0">@{r.reviewer}</span>
                      {r.body && <span className="text-muted-foreground line-clamp-1">{r.body}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Submit Review</p>
              <Select value={reviewForm.event} onValueChange={v => setReviewForm(f => ({ ...f, event: v }))}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMMENT" className="text-xs">Comment</SelectItem>
                  <SelectItem value="APPROVE" className="text-xs">Approve</SelectItem>
                  <SelectItem value="REQUEST_CHANGES" className="text-xs">Request Changes</SelectItem>
                </SelectContent>
              </Select>
              <Textarea value={reviewForm.body} onChange={e => setReviewForm(f => ({ ...f, body: e.target.value }))} placeholder="Review comment (optional)" rows={3} className="text-xs resize-none" />
            </div>
          </div>
        </ScrollArea>
        <DialogFooter className="gap-2 flex-wrap">
          <a href={selectedPR?.url} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="text-xs gap-1"><ExternalLink className="w-3 h-3" />GitHub</Button>
          </a>
          <Button size="sm" variant="outline" className="text-xs gap-1" disabled={reviewMut.isPending} onClick={() => reviewMut.mutate()}>
            {reviewMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />} Submit Review
          </Button>
          <Button size="sm" className="text-xs gap-1" disabled={prDetail?.mergeable === false} onClick={() => setShowMerge(true)}>
            <Merge className="w-3 h-3" /> Merge PR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Merge confirmation dialog */}
    <Dialog open={showMerge} onOpenChange={setShowMerge}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-sm">Merge PR #{selectedPR?.number}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">Merge method</Label>
          <Select value={mergeMethod} onValueChange={setMergeMethod}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="merge" className="text-xs">Merge commit</SelectItem>
              <SelectItem value="squash" className="text-xs">Squash and merge</SelectItem>
              <SelectItem value="rebase" className="text-xs">Rebase and merge</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowMerge(false)}>Cancel</Button>
          <Button size="sm" className="text-xs gap-1" disabled={mergeMut.isPending} onClick={() => mergeMut.mutate()}>
            {mergeMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Merge className="w-3 h-3" />} Confirm Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Create branch dialog */}
    <Dialog open={showBranchCreate} onOpenChange={setShowBranchCreate}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-sm">New Branch &middot; {activeRepo}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Branch name *</Label>
            <Input value={branchForm.branch} onChange={e => setBranchForm(f => ({ ...f, branch: e.target.value }))} placeholder="feature/my-feature" className="text-sm h-8 font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From branch (leave blank for default)</Label>
            <Input value={branchForm.from_branch} onChange={e => setBranchForm(f => ({ ...f, from_branch: e.target.value }))} placeholder={currentRepo?.default_branch ?? "main"} className="text-sm h-8 font-mono" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowBranchCreate(false)}>Cancel</Button>
          <Button size="sm" className="text-xs gap-1" disabled={!branchForm.branch.trim() || createBranchMut.isPending} onClick={() => createBranchMut.mutate()}>
            {createBranchMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Create issue dialog */}
    <Dialog open={showCreate} onOpenChange={setShowCreate}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader><DialogTitle className="text-sm">New Issue &middot; {activeRepo}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Title *</Label>
            <Input value={createForm.title} onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))} placeholder="Issue title" className="text-sm h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Body</Label>
            <Textarea value={createForm.body} onChange={e => setCreateForm(f => ({ ...f, body: e.target.value }))} placeholder="Describe the issue..." rows={4} className="text-sm resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Assignee</Label>
              <Input value={createForm.assignee} onChange={e => setCreateForm(f => ({ ...f, assignee: e.target.value }))} placeholder="username" className="text-sm h-8" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Labels (comma-sep)</Label>
              <Input value={createForm.labels} onChange={e => setCreateForm(f => ({ ...f, labels: e.target.value }))} placeholder="bug, help wanted" className="text-sm h-8" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowCreate(false)}>Cancel</Button>
          {activeRepo && (
            <Button size="sm" disabled={!createForm.title.trim() || createMut.isPending}
            onClick={() => createMut.mutate()}>
            {createMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            Create Issue
          </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    </>
  );
}
