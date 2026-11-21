"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Archive,
  ChevronRight,
  CircleAlert,
  Cloud,
  FolderKanban,
  Plus,
  LayoutGrid,
  LoaderCircle,
  Moon,
  PanelLeftClose,
  Search,
  Sparkles,
  Sun,
} from "lucide-react";
import { useModals } from "@/components/providers";
import Image from "next/image";
import { listSessions, patchSession } from "@/lib/studio/api";
import { listProjects } from "@/lib/studio/api";
import type { Project, Session } from "@/lib/agent/types";
import { useWorkspaceTabs } from "@/lib/studio/workspace-tabs";
import FeedbackDialog from "./FeedbackDialog";
import ProjectDialog from "./ProjectDialog";
import {
  getUnreadSessionIds,
  getUnreadSessionIdsServer,
  setViewedStudioSession,
  subscribeUnreadSessions,
} from "@/lib/studio/session-unread";
import StudioSearchDialog from "./StudioSearchDialog";
import StudioAccountControl from "./StudioAccountControl";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Sparkles;
  exact?: boolean;
  soon?: boolean;
};

const primaryNav: NavItem[] = [
  { href: "/studio", label: "新建任务", icon: Sparkles, exact: true },
  { href: "/cloud-chat", label: "云会话", icon: Cloud },
  { href: "/studio/tasks", label: "任务看板", icon: LayoutGrid },
  { href: "/studio/tools", label: "工具与技能", icon: LayoutGrid },
  { href: "/studio/artifacts", label: "我的成果", icon: FolderKanban },
];

function navActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function usePersistedOpen(key: string, fallback = true) {
  const [open, setOpen] = useState(fallback);
  useEffect(() => {
    const stored = window.localStorage.getItem(key);
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate persisted sidebar fold from localStorage after mount */
    if (stored === "0") setOpen(false);
    if (stored === "1") setOpen(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [key]);
  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      window.localStorage.setItem(key, next ? "1" : "0");
      return next;
    });
  }, [key]);
  return [open, toggle] as const;
}

export default function StudioSidebar({
  theme,
  collapsed = false,
  onThemeChange,
  onRequestCollapse,
}: {
  theme: "dark" | "light";
  collapsed?: boolean;
  onThemeChange: (theme: "dark" | "light") => void;
  onRequestCollapse?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { account } = useModals();
  const { openHomeTab, tabs, closeTab } = useWorkspaceTabs();
  const [recent, setRecent] = useState<Session[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [showAllProjects, setShowAllProjects] = useState<Record<string, boolean>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [archiveView, setArchiveView] = useState(false);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [projectsOpen, toggleProjectsOpen] = usePersistedOpen("reizo:studio-sidebar-projects");
  const [recentsOpen, toggleRecentsOpen] = usePersistedOpen("reizo:studio-sidebar-recents");
  const unreadIds = useSyncExternalStore(
    subscribeUnreadSessions,
    getUnreadSessionIds,
    getUnreadSessionIdsServer,
  );
  const viewedSessionId = pathname.startsWith("/studio/c/")
    ? decodeURIComponent(pathname.slice("/studio/c/".length))
    : null;

  useEffect(() => {
    setViewedStudioSession(viewedSessionId);
  }, [viewedSessionId]);

  useEffect(() => {
    document.body.style.removeProperty("pointer-events");
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setArchiveView(false); setSearchOpen(true);
        return;
      }
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing) {
        event.preventDefault();
        setArchiveView(false); setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const refresh = () => setSessionRevision(value => value + 1);
    window.addEventListener("reizo:sessions-changed", refresh);
    return () => window.removeEventListener("reizo:sessions-changed", refresh);
  }, []);

  async function archive(session: Session) {
    setArchiving(session.id);
    setArchiveError(null);
    try {
      await patchSession(session.id, { archived: true });
      setRecent(current => current.filter(item => item.id !== session.id));
      const tab = tabs.find(item => item.kind === "session" && item.sessionId === session.id);
      if (tab) closeTab(tab.id);
      else if (viewedSessionId === session.id) router.push("/studio");
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "归档失败，请重试");
    } finally { setArchiving(null); }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      if (!account) { setRecent([]); setRecentLoading(false); return; }
      setRecentLoading(true);
      listSessions()
        .then((sessions) => {
          if (!cancelled) setRecent(sessions);
        })
        .catch(() => {
          if (!cancelled) setRecent([]);
        })
        .finally(() => {
          if (!cancelled) setRecentLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [account, pathname, sessionRevision]);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setProjectsLoading(true);
      // Projects are an additive capability. A server without the project API
      // should leave the existing recent-chat sidebar usable.
      listProjects()
        .then((items) => {
          if (!cancelled) {
            setProjects(
              [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
            );
          }
        })
        .catch(() => {
          if (!cancelled) setProjects([]);
        })
        .finally(() => {
          if (!cancelled) setProjectsLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [account, pathname]);

  const projectSessions = useMemo(() => {
    const grouped = new Map<string, Session[]>();
    for (const project of projects) grouped.set(project.id, []);
    for (const session of recent) {
      if (session.projectId) grouped.get(session.projectId)?.push(session);
    }
    return grouped;
  }, [recent, projects]);
  const unassigned = recent.filter(session => !session.projectId || !projectSessions.has(session.projectId)).slice(0, 8);

  return (
    <aside
      className="studio-sidebar-panel studio-glass flex h-full w-[248px] flex-col border-r border-white/70 px-3 py-4"
      inert={collapsed || undefined}
      aria-hidden={collapsed || undefined}
    >
      <div className="mb-5 flex items-center gap-1">
        <Link href="/" className="studio-sidebar-brand flex min-w-0 flex-1 items-center gap-2 px-2" title="Reizo" aria-label="Reizo 首页">
          <span className="studio-logo-mark flex h-8 w-8 shrink-0 items-center justify-center">
            <Image src="/reizo/assets/reizo-mark.png" alt="Reizo" width={26} height={29} priority unoptimized />
          </span>
          <span className="studio-brand-wordmark truncate">REIZO</span>
        </Link>
        <button
          type="button"
          onClick={() => { setArchiveView(false); setSearchOpen(true); }}
          title="快速搜索"
          aria-label="快速搜索"
          className="studio-search-toggle inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-[background-color,color,transform] duration-150 active:scale-[0.97]"
        >
          <Search className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
          title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          className="studio-theme-toggle inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-[background-color,color,transform] duration-150 active:scale-[0.97]"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        {onRequestCollapse ? (
          <button
            type="button"
            onClick={onRequestCollapse}
            title="收起侧栏"
            aria-label="收起侧栏"
            aria-expanded={!collapsed}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#615A73] transition-[background-color,color,transform] duration-150 hover:bg-white/75 hover:text-[#241E36] active:scale-[0.97]"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <nav className="flex flex-col gap-0.5" aria-label="Studio 导航">
        {primaryNav.map((item) => {
          const Icon = item.icon;
          const active = navActive(pathname, item.href, item.exact);
          const className = `studio-nav-item flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-[14px] outline-none transition-colors focus-visible:outline-none ${
            active ? "studio-nav-active" : "text-[#615A73]"
          }`;
          // "开始创作" always opens a brand-new blank tab (like a browser's
          // new-tab button) rather than reusing whatever tab is open.
          if (item.href === "/studio") {
            return (
              <button
                key={item.label}
                type="button"
                onClick={openHomeTab}
                className={className}
              >
                <Icon className="size-[18px] shrink-0" strokeWidth={1.8} />
                {item.label}
              </button>
            );
          }
          return (
            <Link key={item.label} href={item.href} className={className}>
              <Icon className="size-[18px] shrink-0" strokeWidth={1.8} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleProjectsOpen}
              className="studio-nav-item flex min-w-0 flex-1 items-center gap-1 rounded-[12px] px-3 py-2 text-left text-[13px] text-[#8A8298] outline-none transition-colors hover:text-[#241E36] focus-visible:outline-none"
              aria-expanded={projectsOpen}
            >
              <ChevronRight className={`size-3.5 shrink-0 transition-transform ${projectsOpen ? "rotate-90" : ""}`} />
              项目
            </button>
            {account ? (
              <button
                type="button"
                onClick={() => setProjectDialogOpen(true)}
                title="新建项目"
                aria-label="新建项目"
                className="mr-1 inline-flex size-7 items-center justify-center rounded-[8px] text-[#615A73] outline-none transition-colors hover:bg-white/70 hover:text-[#241E36] focus-visible:outline-none"
              >
                <Plus className="size-3.5" strokeWidth={2} />
              </button>
            ) : null}
          </div>
          {projectsOpen ? (
            <div className="min-h-0 overflow-y-auto px-1 pb-2">
              {!account ? (
                <p className="px-3 py-1.5 text-xs leading-5 text-[#8A8298]">登录后管理项目</p>
              ) : projectsLoading ? (
                <p className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#8A8298]">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  加载中…
                </p>
              ) : projects.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setProjectDialogOpen(true)}
                  className="w-full rounded-[12px] px-3 py-2 text-left text-xs leading-5 text-[#8A8298] transition-colors hover:bg-white/60 hover:text-[#615A73]"
                >
                  创建一个项目
                </button>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {projects.map((project) => {
                    const sessions = projectSessions.get(project.id) ?? [];
                    const expanded = expandedProjects[project.id] ?? sessions.some(session => session.id === viewedSessionId);
                    return <li key={project.id} className="review-project-tree">
                      <div className="review-project-folder">
                        <button type="button" aria-expanded={expanded} onClick={() => setExpandedProjects(current => ({...current, [project.id]: !expanded}))} title={project.name}>
                          <ChevronRight size={13} className={expanded ? "rotate-90" : ""}/><FolderKanban size={14}/><span>{project.name}</span><small>{sessions.length}</small>
                        </button>
                        <button type="button" aria-label={`在「${project.name}」新建对话`} title="新建对话" onClick={() => router.push(`/studio?projectId=${encodeURIComponent(project.id)}&new=${crypto.randomUUID()}`)}><Plus size={14}/></button>
                      </div>
                      {expanded && <div className="review-project-children">
                        {(showAllProjects[project.id] ? sessions : sessions.slice(0,4)).map(session => <Link key={session.id} href={`/studio/c/${encodeURIComponent(session.id)}`} title={session.title} className={session.id === viewedSessionId ? "studio-nav-active" : ""}><span>{session.title || "未命名对话"}</span>{unreadIds.has(session.id) && <i aria-label="未读回复"/>}</Link>)}
                        {!sessions.length && <small>暂无对话</small>}
                        {sessions.length > 4 && <button type="button" onClick={() => setShowAllProjects(current => ({...current,[project.id]: !current[project.id]}))}>{showAllProjects[project.id] ? '收起对话' : `更多对话（${sessions.length-4}）`}</button>}
                        <Link className="review-project-manage" href={`/studio/p/${encodeURIComponent(project.id)}`}>管理项目 ↗</Link>
                      </div>}
                    </li>;
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <button
            type="button"
            onClick={toggleRecentsOpen}
            className="studio-nav-item flex w-full items-center gap-1 rounded-[12px] px-3 py-2 text-left text-[13px] text-[#8A8298] outline-none transition-colors hover:text-[#241E36] focus-visible:outline-none"
            aria-expanded={recentsOpen}
          >
            <ChevronRight className={`size-3.5 shrink-0 transition-transform ${recentsOpen ? "rotate-90" : ""}`} />
            对话
          </button>
          {archiveError ? <p role="alert" className="px-3 py-2 text-xs text-red-500">{archiveError}</p> : null}
          {recentsOpen ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
              {!account ? (
                <p className="px-3 py-1.5 text-xs leading-5 text-[#8A8298]">登录后显示历史会话</p>
              ) : recentLoading ? (
                <p className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#8A8298]">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  加载中…
                </p>
              ) : unassigned.length === 0 ? (
                <p className="px-3 py-1.5 text-xs leading-5 text-[#8A8298]">暂无会话</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {unassigned.map((s) => {
                    const active = pathname === `/studio/c/${s.id}`;
                    return (
                      <li key={s.id} className="flex min-w-0 items-center">
                        <Link
                          href={`/studio/c/${s.id}`}
                          className={`studio-nav-item flex min-w-0 flex-1 items-center gap-2 rounded-[12px] px-3 py-2 text-[13px] outline-none transition-colors focus-visible:outline-none ${
                            active ? "studio-nav-active" : "text-[#615A73]"
                          }`}
                          title={s.title}
                        >
                          <span className="min-w-0 flex-1 truncate">{s.title || "未命名对话"}</span>
                          {unreadIds.has(s.id) ? (
                            <span
                              className="size-1.5 shrink-0 rounded-full bg-[#3B82F6]"
                              aria-label="未读回复"
                            />
                          ) : null}
                        </Link>
                        <button type="button" className="studio-nav-item shrink-0 rounded-md p-2 text-[#8A8298]" aria-label={`归档「${s.title || "未命名对话"}」`} title="归档对话" disabled={archiving !== null} onClick={() => void archive(s)}>
                          {archiving === s.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-auto flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <StudioAccountControl
            onOpenArchived={() => {
              setArchiveView(true);
              setSearchOpen(true);
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setFeedbackOpen(true)}
          title="反馈"
          aria-label="反馈"
          className="studio-feedback-button inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#615A73] transition-[background-color,color,transform] duration-150 hover:bg-white/75 hover:text-[#241E36] active:scale-[0.97]"
        >
          <CircleAlert className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>

      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      <ProjectDialog
        open={projectDialogOpen}
        onClose={() => setProjectDialogOpen(false)}
        onCreated={(project) => {
          setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
          setExpandedProjects(current => ({...current, [project.id]: true}));
          if (!projectsOpen) toggleProjectsOpen();
        }}
      />
      <StudioSearchDialog initialArchived={archiveView} open={searchOpen} onClose={() => setSearchOpen(false)} />
    </aside>
  );
}
