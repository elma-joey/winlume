"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowLeft, ArrowUp, Cloud, LoaderCircle, LogOut, Plus } from "lucide-react";
import { useModals } from "@/components/providers";
import { useStudioChat } from "@/components/studio/useStudioChat";
import type { Session } from "@/lib/agent/types";
import { createSession, getAvailableStudioChatModel, getSessionBundle, listSessions, StudioApiError } from "@/lib/studio/api";
import { getDefaultModel } from "@/lib/studio/prefs";
import styles from "./cloud-chat.module.css";

type SessionBundle = Awaited<ReturnType<typeof getSessionBundle>>;

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

function CloudWorkspace() {
  const { account, openLogin, refreshAccount, signOut } = useModals();
  const [sessions, setSessions] = useState<Session[] | null>(null);
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
    try {
      const next = await listSessions();
      if (request !== listRequest.current) return;
      setSessions(next);
      setError("");
    } catch (error) {
      if (request !== listRequest.current) return;
      if (error instanceof StudioApiError && error.status === 401) onUnauthorized();
      setError(errorMessage(error, "无法加载会话，请重试。"));
    }
  }, [onUnauthorized]);
  useRefreshWhileVisible(refresh, 10000);

  async function addSession() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError("");
    try {
      const model = await getAvailableStudioChatModel(getDefaultModel());
      const session = await createSession({ model });
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
          <button type="button" className={styles.primary} onClick={addSession} disabled={creating}>
            {creating ? <Loading /> : <Plus size={17} />} 新建
          </button>
        </header>
        <div className={styles.sessionList}>
          {error && <p className={styles.error} role="alert">{error} <button type="button" onClick={refresh}>重试</button></p>}
          {!sessions && !error && <Loading />}
          {sessions?.length === 0 && <p className={styles.empty}>还没有会话</p>}
          {sessions?.map((session) => (
            <button key={session.id} type="button" className={styles.session}
              aria-current={selected?.id === session.id ? "true" : undefined} onClick={() => selectSession(session.id)}>
              {session.title}
            </button>
          ))}
        </div>
        <footer className={styles.account}>
          <span>{account?.display_name || account?.username}</span>
          <button type="button" className={styles.iconButton} title="退出登录" aria-label="退出登录" onClick={() => void signOut()}><LogOut size={17} /></button>
        </footer>
      </aside>
      {selected
        ? <CloudConversation key={selected.id} session={selected} onBack={() => selectSession("")} onUnauthorized={onUnauthorized} onFinish={refresh} />
        : <section className={styles.blank}><Cloud size={32} strokeWidth={1.5} /><h2>选择会话</h2></section>}
    </main>
  );
}

function CloudConversation({ session, onBack, onUnauthorized, onFinish }: {
  session: Session;
  onBack: () => void;
  onUnauthorized: () => void;
  onFinish: () => void;
}) {
  const [bundle, setBundle] = useState<SessionBundle>();
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const request = useRef(0);
  const snapshot = useRef("");
  const history = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  useEffect(() => () => { ++request.current; }, []);

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

  const chat = useStudioChat({
    sessionId: session.id, model: bundle?.session.model ?? session.model, initialMessages: bundle?.messages,
    activeRun: bundle?.activeRun, onUnauthorized,
    onFinish: () => { void refresh(); onFinish(); },
  });

  useEffect(() => {
    const pane = history.current;
    if (pane && followLatest.current) pane.scrollTop = pane.scrollHeight;
  }, [chat.messages, chat.streaming]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !bundle || bundle.activeRun || chat.streaming || sending) return;
    setSending(true);
    setSendError("");
    followLatest.current = true;
    chat.clearError();
    try {
      const model = await getAvailableStudioChatModel(bundle.session.model);
      setDraft((current) => current.trim() === text ? "" : current);
      await chat.send(text, { model });
    } catch (error) {
      if (error instanceof StudioApiError && error.status === 401) onUnauthorized();
      setSendError(errorMessage(error, "无法发送消息，请重试。"));
      setDraft((current) => current || text);
    } finally {
      setSending(false);
      snapshot.current = "";
      void refresh();
    }
  }

  const busy = sending || chat.streaming || Boolean(bundle?.activeRun);
  const replyError = chat.error?.includes("额度不足")
    ? "模型额度不足，请检查工作区额度。"
    : "此次回复未完成。";
  return (
    <section className={styles.conversation} aria-label="会话">
      <header className={styles.conversationHeader}>
        <button type="button" onClick={onBack} className={styles.iconButton} aria-label="返回会话列表" title="返回会话列表"><ArrowLeft size={20} /></button>
        <h2>{bundle?.session.title ?? session.title}</h2>
      </header>
      <div ref={history} className={styles.history} onScroll={(event) => {
        const pane = event.currentTarget;
        followLatest.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
      }}>
        <div className={styles.transcript}>
          {!bundle && !loadError && <Loading />}
          {chat.messages.map((message) => {
            const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
            if (!text || message.role === "system") return null;
            return <div key={message.id} className={styles.message} data-role={message.role} aria-label={message.role === "user" ? "你" : "Reizo"}>{text}</div>;
          })}
          {busy && <Loading />}
        </div>
      </div>
      <div className={styles.composerArea}>
        {(loadError || sendError || chat.error) && <p className={styles.error} role="alert">
          {loadError || sendError || replyError} <button type="button" onClick={() => { setSendError(""); chat.clearError(); void refresh(); }}>刷新会话</button>
        </p>}
        <form className={styles.composer} onSubmit={submit}>
          <textarea aria-label="消息" placeholder="发消息" rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button className={styles.send} type="submit" title="发送" aria-label="发送" disabled={!bundle || busy || !draft.trim()}>
            <ArrowUp size={20} />
          </button>
        </form>
      </div>
    </section>
  );
}
