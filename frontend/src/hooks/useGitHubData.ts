/**
 * useGitHubData — encapsulates all GitHub data fetching and mutations.
 * Extracted from GitHubView.tsx to separate data concerns from rendering.
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { githubApi } from "@/api/client";
import { useAppStore } from "@/store/useAppStore";
import type {
    Repo, Issue, PR, Commit, Run, Branch,
    PRDetail, Release, Contributor, GHMilestone,
    CodeSearchResult, IssueDetail, FileContent, DirEntry, GHTab,
} from "@/types/github";

export function useGitHubData() {
    const qc = useQueryClient();
    const { selectedRepo, setSelectedRepo } = useAppStore();

    /* ─── Local UI state that affects queries ────────────────────────── */
    const [activeGHTab, setActiveGHTab] = useState<GHTab>("code");
    const [issueState, setIssueState] = useState("open");
    const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
    const [selectedPR, setSelectedPR] = useState<PR | null>(null);
    const [codeSearchQ, setCodeSearchQ] = useState("");
    const [issueDays, setIssueDays] = useState(0);
    const [prDays, setPrDays] = useState(0);
    const [commitDays, setCommitDays] = useState(0);
    const [browsePath, setBrowsePath] = useState("");
    const [viewingFile, setViewingFile] = useState("");

    // Dialog state
    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState({ title: "", body: "", labels: "", assignee: "" });
    const [showBranchCreate, setShowBranchCreate] = useState(false);
    const [branchForm, setBranchForm] = useState({ branch: "", from_branch: "" });
    const [reviewForm, setReviewForm] = useState({ event: "COMMENT", body: "" });
    const [showMerge, setShowMerge] = useState(false);
    const [mergeMethod, setMergeMethod] = useState("merge");

    const activeRepo = selectedRepo === "__none__" ? "" : selectedRepo;
    const owner = activeRepo.split("/")[0] ?? "";
    const repoName = activeRepo.split("/")[1] ?? "";

    /* ─── Auto-select first repo ────────────────────────────────────── */
    const { data: repos = [], isLoading: reposLoading } = useQuery<Repo[]>({
        queryKey: ["gh-repos"],
        queryFn: githubApi.listRepos,
        retry: false,
    });

    useEffect(() => {
        if (repos.length > 0 && selectedRepo === "__none__") setSelectedRepo(repos[0].full_name);
    }, [repos, selectedRepo]);

    // Reset browsing state when repo changes
    useEffect(() => {
        setBrowsePath("");
        setViewingFile("");
    }, [activeRepo]);

    /* ─── Queries ───────────────────────────────────────────────────── */
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
        enabled: !!activeRepo,
        retry: false,
    });

    const { data: issueDetail } = useQuery<IssueDetail>({
        queryKey: ["gh-issue-detail", activeRepo, selectedIssue?.number],
        queryFn: () => githubApi.getIssueDetail(owner, repoName, selectedIssue!.number),
        enabled: !!activeRepo && !!selectedIssue,
    });

    const { data: fileContent, isLoading: fileLoading, isError: fileError } = useQuery<FileContent>({
        queryKey: ["gh-file", activeRepo, viewingFile],
        queryFn: () => githubApi.getFileContent(activeRepo, viewingFile),
        enabled: !!activeRepo && viewingFile.length > 0,
        retry: false,
    });

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

    /* ─── Mutations ─────────────────────────────────────────────────── */
    const syncReposMut = useMutation({
        mutationFn: githubApi.syncRepos,
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["gh-repos"] }); toast.success("Repos synced"); },
        onError: () => toast.error("Failed to sync repos"),
    });

    const createMut = useMutation({
        mutationFn: () => githubApi.createIssue({ repo: activeRepo, ...createForm }),
        onSuccess: () => {
            toast.success("Issue created");
            setShowCreate(false);
            setCreateForm({ title: "", body: "", labels: "", assignee: "" });
            qc.invalidateQueries({ queryKey: ["gh-issues", activeRepo] });
        },
        onError: () => toast.error("Failed to create issue"),
    });

    const createBranchMut = useMutation({
        mutationFn: () => githubApi.createBranch({ repo: activeRepo, ...branchForm }),
        onSuccess: (d) => {
            toast.success(`Branch '${d.branch}' created from '${d.from}'`);
            setShowBranchCreate(false);
            setBranchForm({ branch: "", from_branch: "" });
            qc.invalidateQueries({ queryKey: ["gh-branches", activeRepo] });
        },
        onError: () => toast.error("Failed to create branch"),
    });

    const reviewMut = useMutation({
        mutationFn: () => githubApi.submitPRReview({
            repo: activeRepo,
            number: selectedPR!.number,
            event: reviewForm.event,
            body: reviewForm.body,
        }),
        onSuccess: () => {
            toast.success("Review submitted");
            setReviewForm({ event: "COMMENT", body: "" });
            qc.invalidateQueries({ queryKey: ["gh-pr-detail", activeRepo, selectedPR?.number] });
        },
        onError: () => toast.error("Failed to submit review"),
    });

    const mergeMut = useMutation({
        mutationFn: () => githubApi.mergePR({
            repo: activeRepo,
            number: selectedPR!.number,
            merge_method: mergeMethod,
        }),
        onSuccess: (d) => {
            toast.success(d.merged ? "PR merged!" : d.message);
            setShowMerge(false);
            setSelectedPR(null);
            qc.invalidateQueries({ queryKey: ["gh-prs", activeRepo] });
        },
        onError: () => toast.error("Failed to merge PR"),
    });

    /* ─── Derived ───────────────────────────────────────────────────── */
    const currentRepo = repos.find((r) => r.full_name === activeRepo);

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

    return {
        // Repo
        repos, reposLoading, activeRepo, currentRepo, owner, repoName,
        setSelectedRepo, syncReposMut,

        // Tab navigation
        activeGHTab, setActiveGHTab,

        // Issues
        issues, issuesLoading, issuesError, refetchIssues,
        issueState, setIssueState, issueDays, setIssueDays,
        selectedIssue, setSelectedIssue, issueDetail,

        // PRs
        prs, prsLoading, prsError, prDays, setPrDays,
        selectedPR, setSelectedPR, prDetail,
        reviewForm, setReviewForm, reviewMut,
        showMerge, setShowMerge, mergeMethod, setMergeMethod, mergeMut,

        // Commits
        commits, commitsLoading, commitsError, commitDays, setCommitDays,

        // Actions
        runs, runsLoading, runsError,

        // Branches
        branches, branchesLoading, branchesError,

        // Releases
        releases, releasesLoading, releasesError,

        // Contributors
        contributors, contribLoading, contribError,

        // Milestones
        milestones, milestonesLoading, milestonesError,

        // Code browser
        browsePath, viewingFile, breadcrumbs,
        navigateToDir, navigateToFile,
        fileContent, fileLoading, fileError,
        dirEntries, dirLoading, dirError,
        readme,

        // Code search
        codeSearchQ, setCodeSearchQ, codeResults, codeSearchLoading, codeSearchError,

        // Rate limit
        rateLimit,

        // Create dialogs
        showCreate, setShowCreate, createForm, setCreateForm, createMut,
        showBranchCreate, setShowBranchCreate, branchForm, setBranchForm, createBranchMut,
    };
}
