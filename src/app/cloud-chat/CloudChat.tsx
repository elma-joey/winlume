"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowLeft, ArrowUp, Cloud, FileText, FolderPlus, Image as ImageIcon, LoaderCircle, LogOut, Paperclip, Plus, Wallet, X } from "lucide-react";
import Modal, { ModalCloseButton } from "@/components/Modal";
import { useModals } from "@/components/providers";
import { useStudioChat } from "@/components/studio/useStudioChat";
import { formatBalance } from "@/lib/account";
import type { Artifact, Project, Session } from "@/lib/agent/types";
import {
  createProject, createSession, getSessionBundle,
  listArtifacts, listProjects, listSessions, listStudioComposerModels, patchSession, StudioApiError,
} from "@/lib/studio/api";
import { composeOutboundMessage, createPastedBlock, readFileAsText } from "@/lib/studio/composer-attachments";
import { isImageGenerationModel } from "@/lib/studio/image-model";
import { getDefaultModel } from "@/lib/studio/prefs";
import { CloudModelPicker } from "./CloudModelPicker";
import { CLOUD_ATTACHMENT_ACCEPT, MAX_CLOUD_ATTACHMENTS, toCloudAttachment, uploadCloudAttachment, type CloudAttachment } from "./cloud-attachments";
import styles from "./cloud-chat.module.css";

type SessionBundle = Awaited<ReturnType<typeof getSessionBundle>>;
const UNCATEGORIZED = "uncategorized";

function subscribeToSelection(notify: () => void) {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
}

function currentSelection() {
  return window.location.hash.slice(1);
}

function selectSession(id: string) {
  window.location.hash = id;
}

function useRefreshWhileVisible(refresh: () => void, interval: number) {
  useEffect(() => {
    const tick = () => { if (!document.hidden) refresh(); };
    tick();
    const timer = window.setInterval(tick, interval);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh, interval]);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof StudioApiError ? error.message : fallback;
}

export default function CloudChat() {
  const { account, accountLoading, openLogin } = useModals();

  if (account) return <CloudWorkspace key={account.id} />;

  return (
    <main className={styles.welcome}>
      <Cloud size={36} strokeWidth={1.5} />
      <h1>云会话</h1>
      {accountLoading
        ? <Loading />
        : <button className={styles.primary} type="button" onClick={() => openLogin("login")}>登录 Reizo</button>}
    </main>
  );
}

function Loading() {
  return <LoaderCircle size={18} className={styles.loading} role="status" aria-label="加载中" />;
}

function RemainingQuota() {
  const { account, balanceConfig } = useModals();
  const balance = formatBalance(account?.quota, balanceConfig);
  const text = balance === "余额同步中" ? "额度待同步" : `剩余 ${balance}`;
  return <span className={styles.quota} title={text} aria-label={text}><Wallet size={14} aria-hidden /><span>{text}</span></span>;
}

function CloudWorkspace() {
  const { account, openLogin, refreshAccount, signOut } = useModals();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectError, setProjectError] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const selectedId = useSyncExternalStore(subscribeToSelection, currentSelection, () => "");
  const selected = sessions?.find((session) => session.id === selectedId);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const listRequest = useRef(0);
  const creatingRef = useRef(false);
  useEffect(() => () => { ++listRequest.current; }, []);

  const onUnauthorized = useCallback(() => {
    void refreshAccount();
    openLogin("login");
  }, [openLogin, refreshAccount]);

  const refresh = useCallback(async () => {
    const request = ++listRequest.current;
    const [sessionResult, projectResult] = await Promise.allSettled([listSessions(), listProjects()]);
    if (request !== listRequest.current) return;
    if (sessionResult.status === "fulfilled") setSessions(sessionResult.value);
    if (projectResult.status === "fulfilled") setProjects(projectResult.value);
    const failure = sessionResult.status === "rejected" ? sessionResult.reason : projectResult.status === "rejected" ? projectResult.reason : null;
    if (failure instanceof StudioApiError && failure.status === 401) onUnauthorized();
    setError(failure ? errorMessage(failure, "无法加载会话或项目，请重试。") : "");
  }, [onUnauthorized]);
  useRefreshWhileVisible(refresh, 10000);
  useRefreshWhileVisible(refreshAccount, 60000);

  const scope = projectFilter === UNCATEGORIZED || projects.some((project) => project.id === projectFilter) ? projectFilter : "";
  const groups = [
    ...projects.map((project) => ({ id: project.id, name: project.name, sessions: sessions?.filter((item) => item.projectId === project.id) ?? [] })),
    { id: UNCATEGORIZED, name: "未归类", sessions: sessions?.filter((item) => !projects.some((project) => project.id === item.projectId)) ?? [] },
  ].filter((group) => (!scope || group.id === scope) && group.sessions.length);

  function closeProject() {
    if (creatingProject) return;
    setProjectOpen(false);
    setProjectName("");
    setProjectError("");
  }

  async function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name || creatingProject) return;
    setCreatingProject(true);
    setProjectError("");
    try {
      const project = await createProject({ name });
      ++listRequest.current;
      setProjects((previous) => [project, ...previous.filter(({ id }) => id !== project.id)]);
      setProjectFilter(project.id);
      selectSession("");
      setProjectOpen(false);
      setProjectName("");
      void refresh();
    } catch (error) {
      if (error instanceof StudioApiError && error.status === 401) onUnauthorized();
      setProjectError(errorMessage(error, "无法创建项目，请重试。"));
    } finally {
      setCreatingProject(false);
    }
  }

  async function addSession() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError("");
    try {
      const preferred = getDefaultModel();
      const options = await listStudioComposerModels();
      const model = options.chatModels.includes(preferred) ? preferred : options.chatModels[0] ?? options.imageModels[0];
      if (!model) throw new StudioApiError(options.chatError, 503);
      const session = await createSession({ model, projectId: scope && scope !== UNCATEGORIZED ? scope : undefined });
      ++listRequest.current;
      setSessions((previous) => [session, ...(previous ?? []).filter((item) => item.id !== session.id)]);
      selectSession(session.id);
    } catch (error) {
      if (error instanceof StudioApiError && error.status === 401) onUnauthorized();
      setError(errorMessage(error, "无法新建会话，请重试。"));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  return (
    <main className={styles.workspace} data-conversation-open={Boolean(selected)}>
      <aside className={styles.sidebar} aria-label="云会话列表">
        <header className={styles.sidebarHeader}>
          <div className={styles.brand}><Cloud size={19} /> <h1>云会话</h1></div>
          <RemainingQuota />
          <button type="button" className={styles.primary} onClick={addSession} disabled={creating}>
            {creating ? <Loading /> : <Plus size={17} />} 新建
          </button>
        </header>
        <div className={styles.projectBar}>
          <select className={styles.projectSelect} aria-label="项目筛选" value={scope} onChange={(event) => setProjectFilter(event.currentTarget.value)}>
            <option value="">全部会话</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            <option value={UNCATEGORIZED}>未归类</option>
          </select>
          <button type="button" className={styles.iconButton} aria-label="新建项目" title="新建项目" onClick={() => setProjectOpen(true)}><FolderPlus size={19} /></button>
        </div>
        <div className={styles.sessionList}>
          {error && <p className={styles.error} role="alert">{error} <button type="button" onClick={refresh}>重试</button></p>}
          {!sessions && !error && <Loading />}
          {sessions && !groups.length && <p className={styles.empty}>还没有会话</p>}
          {groups.map((group) => <section key={group.id} aria-label={group.name}>
            {!scope && projects.length > 0 && <h2 className={styles.projectHeading}>{group.name}</h2>}
            {group.sessions.map((session) => <button key={session.id} type="button" className={styles.session}
              aria-current={selected?.id === session.id ? "true" : undefined} onClick={() => selectSession(session.id)}>{session.title}</button>)}
          </section>)}
        </div>
        <footer className={styles.account}>
          <span>{account?.display_name || account?.username}</span>
          <button type="button" className={styles.iconButton} title="退出登录" aria-label="退出登录" onClick={() => void signOut()}><LogOut size={17} /></button>
        </footer>
      </aside>
      {selected
        ? <CloudConversation key={selected.id} session={selected} projects={projects} onBack={() => selectSession("")} onUnauthorized={onUnauthorized}
          onChange={refresh} onFinish={() => { void refresh(); void refreshAccount(); }} onBalanceChange={refreshAccount} />
        : <section className={styles.blank}><Cloud size={32} strokeWidth={1.5} /><h2>选择会话</h2></section>}
      <Modal open={projectOpen} onClose={closeProject} label="新建项目">
        <form className={styles.sheetPanel} onSubmit={addProject}>
          <header className={styles.sheetHeader}><h2>新建项目</h2><ModalCloseButton onClose={closeProject} /></header>
          <div className={styles.projectForm}>
            <input aria-label="项目名称" placeholder="项目名称" value={projectName} maxLength={80} required onChange={(event) => setProjectName(event.currentTarget.value)} />
            {projectError && <p className={styles.error} role="alert">{projectError}</p>}
            <button type="submit" className={styles.primary} disabled={!projectName.trim() || creatingProject}>{creatingProject ? <Loading /> : "创建"}</button>
          </div>
        </form>
      </Modal>
    </main>
  );
}

function CloudConversation({ session, projects, onBack, onUnauthorized, onChange, onFinish, onBalanceChange }: {
  session: Session;
  projects: Project[];
  onBack: () => void;
  onUnauthorized: () => void;
  onChange: () => void;
  onFinish: () => void;
  onBalanceChange: () => void;
}) {
  const [bundle, setBundle] = useState<SessionBundle>();
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<Awaited<ReturnType<typeof listStudioComposerModels>> | null>(null);
  const [pendingSettings, setPendingSettings] = useState<Parameters<typeof patchSession>[1] | null>(null);
  const [imageMode, setImageMode] = useState(() => isImageGenerationModel(session.model));
  const [imageModel, setImageModel] = useState("");
  const [attachments, setAttachments] = useState<CloudAttachment[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const request = useRef(0);
  const modelRequest = useRef(0);
  const artifactRequest = useRef(0);
  const pendingImages = useRef(new Set<string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const snapshot = useRef("");
  const history = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  useEffect(() => () => { ++request.current; ++modelRequest.current; ++artifactRequest.current; }, []);

  const refresh = useCallback(async () => {
    const id = ++request.current;
    try {
      const next = await getSessionBundle(session.id);
      if (id !== request.current) return;
      const serialized = JSON.stringify(next);
      if (serialized !== snapshot.current) {
        snapshot.current = serialized;
        setBundle(next);
      }
      setLoadError("");
    } catch (error) {
      if (id !== request.current) return;
      if (error instanceof StudioApiError && error.status === 401) onUnauthorized();
      setLoadError(errorMessage(error, "无法加载消息，请重试。"));
    }
  }, [session.id, onUnauthorized]);
  useRefreshWhileVisible(refresh, 5000);

  const refreshModels = useCallback(async () => {
    const id = ++modelRequest.current;
    try {
      const available = await listStudioComposerModels();
      if (id === modelRequest.current) setModels(available);
    } catch (error) {
      if (id !== modelRequest.current) return;
      if (error instanceof StudioApiError && error.status === 401) onUnauthorized();
      setModels({ chatModels: [], imageModels: [], chatError: "无法加载模型，请重试。" });
    }
  }, [onUnauthorized]);
  useRefreshWhileVisible(refreshModels, 30000);

  const refreshArtifacts = useCallback(async () => {
    const id = ++artifactRequest.current;
    try {
      const next = await listArtifacts(session.id);
      if (id !== artifactRequest.current) return;
      const completed = next.some((artifact) => pendingImages.current.has(artifact.id) && artifact.status !== "pending");
      pendingImages.current = new Set(next.filter(({ kind, status }) => kind === "image" && status === "pending").map(({ id }) => id));
      setArtifacts(next);
      if (completed) onBalanceChange();
    } catch (error) {
      if (id === artifactRequest.current && error instanceof StudioApiError && error.status === 401) onUnauthorized();
    }
  }, [session.id, onBalanceChange, onUnauthorized]);
  useRefreshWhileVisible(refreshArtifacts, 5000);

  const savedModel = bundle?.session.model ?? session.model;
  const chat = useStudioChat({
    sessionId: session.id, model: savedModel, initialMessages: bundle?.messages,
    activeRun: bundle?.activeRun, onUnauthorized,
    onArtifact: refreshArtifacts,
    onFinish: () => { void refresh(); void refreshArtifacts(); onFinish(); },
  });

  useEffect(() => {
    const pane = history.current;
    if (pane && followLatest.current) pane.scrollTop = pane.scrollHeight;
  }, [chat.messages, chat.streaming]);

  const busy = sending || chat.streaming || Boolean(bundle?.activeRun);
  const options = imageMode ? models?.imageModels : models?.chatModels;
  const preferredImage = imageModel || savedModel;
  const displayedModel = imageMode
    ? (options?.includes(preferredImage) ? preferredImage : options?.[0] ?? "")
    : pendingSettings?.model ?? (options?.includes(savedModel) ? savedModel : options?.[0] ?? "");
  const savedProject = (bundle ? bundle.session.projectId : session.projectId) ?? "";
  const displayedProject = pendingSettings?.projectId !== undefined ? pendingSettings.projectId ?? "" : savedProject;
  const canSend = Boolean(draft.trim() || (!imageMode && attachments.length));

  async function changeSettings(patch: Parameters<typeof patchSession>[1]) {
    if (!bundle || busy || pendingSettings) return;
    setPendingSettings(patch);
    setSendError("");
    chat.clearError();
    try {
      const saved = await patchSession(session.id, patch);
      ++request.current;
      snapshot.current = "";
      setBundle((current) => current && { ...current, session: saved });
      if (patch.projectId !== undefined) onChange();
    } catch (error) {
      if (error instanceof StudioApiError && error.status === 401) onUnauthorized();
      setSendError(errorMessage(error, patch.model ? "无法切换模型，请重试。" : "无法移动会话，请重试。"));
    } finally {
      setPendingSettings(null);
      void refresh();
    }
  }

  function changeModel(model: string) {
    if (!options?.includes(model)) return;
    if (imageMode) setImageModel(model);
    else if (model !== savedModel) void changeSettings({ model });
  }

  function addFiles(files: FileList | null) {
    const added: CloudAttachment[] = [];
    let issue = "";
    for (const file of Array.from(files ?? [])) {
      if (attachments.length + added.length >= MAX_CLOUD_ATTACHMENTS) {
        issue = `每条消息最多 ${MAX_CLOUD_ATTACHMENTS} 个附件。`;
        break;
      }
      try {
        const item = toCloudAttachment(file);
        if (imageMode && item.kind !== "image") throw new Error("生图仅支持图片参考。");
        added.push(item);
      } catch (error) {
        issue = error instanceof Error ? error.message : "无法读取附件。";
      }
    }
    setAttachments((previous) => [...previous, ...added]);
    setSendError(issue);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend || !bundle || busy || pendingSettings) return;
    if (imageMode && attachments.some(({ kind }) => kind !== "image")) {
      setSendError("生图仅支持图片参考，请移除其他附件。");
      return;
    }
    const original = draft;
    setSending(true);
    setSendError("");
    followLatest.current = true;
    chat.clearError();
    try {
      const live = await listStudioComposerModels();
      const model = live.chatModels.includes(savedModel) ? savedModel : live.chatModels[0];
      const generationModel = imageMode ? (live.imageModels.includes(preferredImage) ? preferredImage : live.imageModels[0]) : undefined;
      if (imageMode && !generationModel) throw new StudioApiError("暂无可用图片模型。", 503);
      if (!imageMode && !model) throw new StudioApiError(live.chatError, 503);
      const referencedArtifactIds: string[] = [];
      const pasted = [];
      for (const item of attachments) {
        if (item.kind === "text") {
          pasted.push(createPastedBlock(await readFileAsText(item.file), { source: "file", name: item.file.name }));
          continue;
        }
        const artifact = await uploadCloudAttachment(session.id, item);
        if (artifact) {
          referencedArtifactIds.push(artifact.id);
          setAttachments((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, artifact } : entry));
        }
      }
      const text = composeOutboundMessage({ draft: original, pasted, images: [], files: [], videos: [] }) || "请查看已上传的附件。";
      setDraft((current) => current === original ? "" : current);
      const result = await chat.send(text, {
        model: generationModel ? savedModel : model,
        referencedArtifactIds,
        ...(generationModel ? { composerOptions: { mode: "image", directImage: true, imageModel: generationModel } } : {}),
      });
      if (result === "rejected") throw new Error("无法发送消息，请重试。");
      setAttachments([]);
    } catch (error) {
      if (error instanceof StudioApiError && error.status === 401) onUnauthorized();
      setSendError(error instanceof Error ? error.message : "无法发送消息，请重试。");
      setDraft((current) => current || original);
    } finally {
      setSending(false);
      snapshot.current = "";
      void refresh();
      void refreshArtifacts();
    }
  }

  const replyError = chat.error?.includes("额度不足")
    ? "模型额度不足，请检查工作区额度。"
    : "此次回复未完成。";
  return (
    <section className={styles.conversation} aria-label="会话">
      <header className={styles.conversationHeader}>
        <button type="button" onClick={onBack} className={styles.iconButton} aria-label="返回会话列表" title="返回会话列表"><ArrowLeft size={20} /></button>
        <h2>{bundle?.session.title ?? session.title}</h2>
        <RemainingQuota />
        <CloudModelPicker models={options ?? null} imageMode={imageMode} value={displayedModel}
          disabled={!bundle || busy || pendingSettings !== null} onChange={changeModel} />
      </header>
      <div ref={history} className={styles.history} onScroll={(event) => {
        const pane = event.currentTarget;
        followLatest.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
      }}>
        <div className={styles.transcript}>
          {!bundle && !loadError && <Loading />}
          {chat.messages.map((message) => {
            const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
            const attachedIds = bundle?.messages.find(({ id }) => message.id === id)?.attachmentIds ?? [];
            const items = artifacts.filter((artifact) => artifact.messageId === message.id || attachedIds.includes(artifact.id));
            if ((!text && !items.length) || message.role === "system") return null;
            const showText = text !== "正在提交图片生成任务。" || !items.some(({ kind }) => kind === "image");
            return <div key={message.id} className={styles.message} data-role={message.role} aria-label={message.role === "user" ? "你" : "Reizo"}>
              {showText && text}{items.map((artifact) => <CloudArtifact key={artifact.id} artifact={artifact} />)}
            </div>;
          })}
          {busy && <Loading />}
        </div>
      </div>
      <div className={styles.composerArea}>
        {(loadError || sendError || chat.error) && <p className={styles.error} role="alert">
          {loadError || sendError || replyError} <button type="button" onClick={() => { setSendError(""); chat.clearError(); void refresh(); void refreshModels(); void refreshArtifacts(); }}>刷新会话</button>
        </p>}
        {attachments.length > 0 && <ul className={styles.attachments} aria-label="待发送附件">
          {attachments.map(({ id, file }) => <li className={styles.attachmentChip} key={id}><FileText size={15} aria-hidden />
            <span title={file.name}>{file.name}</span><button type="button" aria-label={`移除 ${file.name}`} disabled={busy}
              onClick={() => setAttachments((previous) => previous.filter((item) => item.id !== id))}><X size={15} /></button>
          </li>)}
        </ul>}
        <div className={styles.composerTools}>
          <input type="file" hidden ref={fileInput} aria-label="选择附件" multiple
            accept={imageMode ? "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" : CLOUD_ATTACHMENT_ACCEPT}
            onChange={(event) => { addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
          <button type="button" className={styles.iconButton} aria-label="添加附件" title="添加附件"
            disabled={!bundle || busy || attachments.length >= MAX_CLOUD_ATTACHMENTS} onClick={() => fileInput.current?.click()}><Paperclip size={18} /></button>
          <button type="button" className={styles.modeButton} aria-pressed={imageMode}
            title={!imageMode && !models?.imageModels.length ? "暂无可用图片模型" : undefined}
            disabled={busy || (!imageMode && !models?.imageModels.length)} onClick={() => { setImageMode((previous) => !previous); setSendError(""); }}><ImageIcon size={17} aria-hidden /> 生图</button>
          {projects.length > 0 && <select className={styles.projectSelect} aria-label="会话项目" value={displayedProject}
            disabled={!bundle || busy || pendingSettings !== null} onChange={(event) => void changeSettings({ projectId: event.currentTarget.value || null })}>
            <option value="">未归类</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>}
        </div>
        <form className={styles.composer} onSubmit={submit}>
          <textarea aria-label="消息" placeholder={imageMode ? "描述要生成的图片" : "发消息"} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button className={styles.send} type="submit" title="发送" aria-label="发送" disabled={!bundle || busy || pendingSettings !== null || !canSend}>
            <ArrowUp size={20} />
          </button>
        </form>
      </div>
    </section>
  );
}

function CloudArtifact({ artifact }: { artifact: Artifact }) {
  const url = `/api/artifacts/${encodeURIComponent(artifact.id)}/${artifact.kind === "sheet" ? "xlsx" : "raw"}`;
  if (artifact.status === "pending") return <span className={styles.artifactState}><Loading />{artifact.name}</span>;
  if (artifact.status === "failed") return <span className={styles.error} role="alert">{artifact.error || `${artifact.name}失败`}</span>;
  if (artifact.kind === "image") {
    // The authenticated artifact endpoint serves private, already-sized bytes.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={styles.artifactImage} src={url} alt={artifact.name} loading="lazy" />;
  }
  return <a className={styles.artifactState} href={url} download={artifact.name}><FileText size={15} aria-hidden />{artifact.name}</a>;
}
