"use client";

import PortalFooter from "@/components/PortalFooter";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button as HeroButton } from "@heroui/react";
import { BarChart3, Bot, ChevronLeft, ChevronRight, CircleHelp, Code2, Crown, FileImage, LayoutGrid, Search, ArrowUp, Presentation, ShoppingBag, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useModals } from "@/components/providers";
import PortalHeader from "@/components/PortalHeader";
import { toolCategorySummaries } from "@/lib/portal/application-category-copy";
import { formatBalance } from "@/lib/account";
import { displayAllowance } from "@/lib/billing/plans";
import { remainingAllowancePercent } from "@/lib/billing/model";
import { getConsoleOverview } from "@/lib/console/client";
import type { ConsoleOverview } from "@/lib/console/types";
import { homepageApiCategories } from "@/lib/portal/homepage-vendors";
import { WORK_SCENES, type WorkSceneId } from "@/lib/studio/work-scenes";
import { usePortalCanvasScale } from "@/components/usePortalCanvasScale";
import type { PortalContentConfig, PortalImageAdjust } from "@/lib/portal/content-config";
import { portalImageStyle } from "@/lib/portal/image-framing";

declare global {
  interface Window {
    chatwootSDK?: {
      run: (config: { websiteToken: string; baseUrl: string }) => void;
    };
    $chatwoot?: {
      toggle: (state?: "open" | "close") => void;
    };
    chatwootSettings?: {
      hideMessageBubble?: boolean;
    };
    __reizoChatwootStarted?: boolean;
  }
}

const CHATWOOT_BASE_URL = "https://chat.v2api.top";
const CHATWOOT_WEBSITE_TOKEN = "kZgsMkESfeGDBRWCHcKeTNYS";
const PORTAL_ONBOARDING_STORAGE_KEY = "reizo-portal-onboarding-v1";

/** Compact credit/token figure, e.g. 1.24M / 86.42. */
function fmtUsage(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

const onboardingSteps = [
  {
    target: "agent" as const,
    title: "Agent 智能工作台",
    lead: "与 AI 对话，制作你要的素材。",
    body: "支持内容创作、文件处理、数据分析、办公协作、代码开发等多场景任务，创建属于你的工作流。",
  },
  {
    target: "api" as const,
    title: "API 模型中心",
    lead: "接入全球领先 AI 模型能力。",
    body: "按需调用语言、图像、视频、音频、知识库等模型，灵活满足开发与应用接入需求。",
  },
  {
    target: "tools" as const,
    title: "AI应用工具与Skills技能",
    lead: "300+ 应用工具 · 2600+ Skills 技能。",
    body: "覆盖电商、营销、财务、法务、科研、办公、开发等多行业场景的一键式 AI 指令，快速找到适合你的 AI 能力。",
  },
] as const;

type OnboardingPlacementMode = "below" | "above" | "side" | "spotlight";

type OnboardingPlacement = {
  left: number;
  top: number;
  viewportWidth: number;
  viewportHeight: number;
  mode: OnboardingPlacementMode;
  connectorPath: string;
  connectorStart: { x: number; y: number };
  connectorTarget: { x: number; y: number };
  targetRect: { left: number; top: number; width: number; height: number };
};

type AssetIconProps = { src: string; alt?: string; className?: string };

function AssetIcon({ src, alt = "", className }: AssetIconProps) {
  return <Image src={src} alt={alt} width={38} height={38} className={className} unoptimized />;
}

type PortalLinkProps = {
  href: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  tabIndex?: number;
  target?: "_blank" | "_self";
  "aria-hidden"?: boolean;
  "aria-label"?: string;
};

function PortalLink({ href, children, className, onClick, tabIndex, target = "_blank", "aria-hidden": ariaHidden, "aria-label": ariaLabel }: PortalLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      onClick={onClick}
      tabIndex={tabIndex}
      target={target}
      rel={target === "_blank" ? "noopener noreferrer" : undefined}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}

const searchSuggestions = [
  { label: "产品图生成", icon: FileImage, category: "视觉与媒体" },
  { label: "短视频创作", icon: Video, category: "视觉与媒体" },
  { label: "PPT 生成", icon: Presentation, category: "办公与管理" },
  { label: "财务分析", icon: BarChart3, category: "财务与法务" },
  { label: "代码生成", icon: Code2, category: "开发与代码" },
  { label: "电商运营", icon: ShoppingBag, category: "电商与销售" },
] as const;

/** Hardcoded Model Review carousel slides (generated banners in public/). */
type FeaturedSlide = { id: string; src: string; alt: string; href: string; adjust?: PortalImageAdjust };

/**
 * Inline framing for admin-adjusted images now lives in
 * `@/lib/portal/image-framing`, shared with the admin preview dialog so the
 * editor and the homepage can never disagree about how an upload is cropped.
 */

const FEATURED_SLIDES: FeaturedSlide[] = [
  {
    id: "claude-fable-5",
    src: "/figma-home/featured/slide-claude-fable-5.png",
    alt: "Model Review · Claude Fable 5",
    href: "/products?cate=api",
  },
  {
    id: "gpt-5-6-sol",
    src: "/figma-home/featured/slide-gpt-5-6-sol.png",
    alt: "Model Review · GPT-5.6 Sol",
    href: "/products?cate=api",
  },
] as const;

const FEATURED_AUTO_MS = 5000;

const workSceneIcons: Record<WorkSceneId, string> = {
  "content-office": "/figma-home/tool-content.svg",
  "growth-commerce": "/figma-home/tool-commerce.svg",
  "video-creation": "/figma-home/tool-video.svg",
  "developer-api": "/figma-home/tool-api.svg",
  "agent-automation": "/figma-home/tool-agent.svg",
};

const workScenes = WORK_SCENES.map((scene) => ({
  ...scene,
  icon: workSceneIcons[scene.id],
  href: `/studio/skills?scene=${encodeURIComponent(scene.id)}`,
}));

const toolApplications = [
  { label: "内容与营销", detail: toolCategorySummaries["内容与营销"], icon: "/figma-home/tool-content.svg", href: "/products?cate=app&category=%E5%86%85%E5%AE%B9%E4%B8%8E%E8%90%A5%E9%94%80" },
  { label: "视觉与媒体", detail: toolCategorySummaries["视觉与媒体"], icon: "/figma-home/icon-image.svg", href: "/products?cate=app&category=%E8%A7%86%E8%A7%89%E4%B8%8E%E5%AA%92%E4%BD%93" },
  { label: "电商与销售", detail: toolCategorySummaries["电商与销售"], icon: "/figma-home/tool-commerce.svg", href: "/products?cate=app&category=%E7%94%B5%E5%95%86%E4%B8%8E%E9%94%80%E5%94%AE" },
  { label: "财务与法务", detail: toolCategorySummaries["财务与法务"], icon: "/figma-home/icon-db.svg", href: "/products?cate=app&category=%E8%B4%A2%E5%8A%A1%E4%B8%8E%E6%B3%95%E5%8A%A1" },
  { label: "产品与研发", detail: toolCategorySummaries["产品与研发"], icon: "/figma-home/tool-agent.svg", href: "/products?cate=app&category=%E4%BA%A7%E5%93%81%E4%B8%8E%E7%A0%94%E5%8F%91" },
  { label: "办公与管理", detail: toolCategorySummaries["办公与管理"], icon: "/figma-home/icon-video.svg", href: "/products?cate=app&category=%E5%8A%9E%E5%85%AC%E4%B8%8E%E7%AE%A1%E7%90%86" },
  { label: "数据与科研", detail: toolCategorySummaries["数据与科研"], icon: "/figma-home/icon-search.svg", href: "/products?cate=app&category=%E6%95%B0%E6%8D%AE%E4%B8%8E%E7%A7%91%E7%A0%94" },
  { label: "开发与代码", detail: toolCategorySummaries["开发与代码"], icon: "/figma-home/tool-api.svg", href: "/products?cate=app&category=%E5%BC%80%E5%8F%91%E4%B8%8E%E4%BB%A3%E7%A0%81" },
] as const;

type PortalApplicationPreview = "storyboard" | "poster" | "subtitles" | "avatar" | "extract" | "product" | "finance" | "slides" | "code" | "contract";
type PortalCapabilityEvidence = "models" | "skills" | "agent" | "usage";
type ManagedApplicationShowcase = { id: string; title: string; href: string; imageUrl: string; group: "popular" | "latest"; enabled: boolean; imageAdjust?: PortalImageAdjust };
type ManagedCapabilityShowcase = { id: string; title: string; eyebrow: string; href: string; imageUrl: string; tone: "models" | "agent" | "usage"; enabled: boolean; imageAdjust?: PortalImageAdjust };

const portalApplicationShowcase: ReadonlyArray<{ title: string; detail: string; href: string; tone: string; preview: PortalApplicationPreview }> = [
  { title: "AI财务分析助手", detail: "自动生成图表、报告、趋势分析和可视化图表，提升财务决策效率。", href: "/studio/skills?scene=growth-commerce", tone: "green", preview: "finance" },
  { title: "AI文案创作", detail: "高质量文案、营销内容一键生成", href: "/studio/skills?scene=content-office", tone: "rose", preview: "poster" },
  { title: "AI视频生成", detail: "文本/图像一键生成高质量视频", href: "/studio?preset=video-default", tone: "violet", preview: "storyboard" },
  { title: "AI图片设计", detail: "电商图、海报、素材快速设计", href: "/studio?preset=image-default", tone: "cyan", preview: "product" },
  { title: "合同智能审查", detail: "合同风险识别与条款建议", href: "/studio/skills?scene=content-office", tone: "amber", preview: "contract" },
  { title: "AI智能提取", detail: "从文档、网页和图片提取结构化信息", href: "/studio/skills?scene=content-office", tone: "amber", preview: "extract" },
  { title: "财务分析助手", detail: "报表解读、指标分析与结论整理", href: "/studio/skills?scene=growth-commerce", tone: "green", preview: "finance" },
  { title: "PPT 生成", detail: "快速把想法整理成可演示的页面", href: "/studio/skills?scene=content-office", tone: "indigo", preview: "slides" },
  { title: "代码生成", detail: "从需求到代码、调试和接口说明", href: "/studio/skills?scene=developer-api", tone: "slate", preview: "code" },
  { title: "合同审查", detail: "识别风险条款并生成审阅建议", href: "/studio/skills?scene=content-office", tone: "orange", preview: "contract" },
];

const portalCapabilityCards: ReadonlyArray<{ title: string; detail: string; badge: string; href: string; tone: string; evidence: PortalCapabilityEvidence }> = [
  { title: "强大的模型接入与调度", detail: "100+ 主流模型接入，智能路由，稳定高效", badge: "MODEL ROUTING", href: "/products?cate=api", tone: "models", evidence: "models" },
  { title: "Agent 智能体平台", detail: "构建、编排和运行你的专属智能体", badge: "AGENT EXECUTION", href: "/studio", tone: "agent", evidence: "agent" },
  { title: "企业级知识引擎", detail: "RAG 知识库、文档理解、多源数据融合", badge: "KNOWLEDGE ENGINE", href: "/business/capabilities", tone: "usage", evidence: "usage" },
];

const initialManagedApplications: ManagedApplicationShowcase[] = portalApplicationShowcase.map((item, index) => ({ id: `application-${index + 1}`, title: item.title, href: item.href, imageUrl: "", group: index < 5 ? "popular" : "latest", enabled: true }));
const initialManagedCapabilities: ManagedCapabilityShowcase[] = portalCapabilityCards.map((item, index) => ({ id: `capability-${index + 1}`, title: item.title, eyebrow: item.badge, href: item.href, imageUrl: "", tone: index === 1 ? "agent" : index === 2 ? "usage" : "models", enabled: true }));

function ApplicationResultPreview({ kind }: { kind: PortalApplicationPreview }) {
  if (kind === "storyboard") return <span className="portal-result-preview is-storyboard" aria-hidden><i /><i /><i /></span>;
  if (kind === "poster") return <span className="portal-result-preview is-poster" aria-hidden><i /></span>;
  if (kind === "subtitles") return <span className="portal-result-preview is-subtitles" aria-hidden><i /><em><i /><i /><i /><i /><i /></em></span>;
  if (kind === "avatar") return <span className="portal-result-preview is-avatar" aria-hidden><i className="portal-avatar-orbit" /><i className="portal-avatar-head" /><i className="portal-avatar-body" /><em><i /><i /><i /><i /><i /></em></span>;
  if (kind === "extract") return <span className="portal-result-preview is-extract" aria-hidden><i className="portal-extract-document" /></span>;
  if (kind === "product") return <span className="portal-result-preview is-product" aria-hidden><i /><i /><i /></span>;
  if (kind === "finance") return <span className="portal-result-preview is-finance" aria-hidden><i /></span>;
  if (kind === "slides") return <span className="portal-result-preview is-slides" aria-hidden><i /><i /><i /></span>;
  if (kind === "code") return <span className="portal-result-preview is-code" aria-hidden />;
  return <span className="portal-result-preview is-contract" aria-hidden><i /><i /><i /></span>;
}

function CapabilityEvidence({ kind }: { kind: PortalCapabilityEvidence }) {
  if (kind === "models") return <span className="portal-capability-evidence is-models" aria-hidden><i /><i /><i /></span>;
  if (kind === "skills") return <span className="portal-capability-evidence is-skills" aria-hidden><i /><i /><i /></span>;
  if (kind === "agent") return <span className="portal-capability-evidence is-agent" aria-hidden><i /><span /><i /><span /><i /></span>;
  return <span className="portal-capability-evidence is-usage" aria-hidden><i /><i /><i /><i /><i /></span>;
}

function ManagedApplicationVisual({ item, fallback, kind }: { item: ManagedApplicationShowcase; fallback: PortalApplicationPreview; kind: "application-featured" | "application-support" }) {
  return item.imageUrl ? <span className="portal-managed-showcase-image"><Image src={item.imageUrl} alt="" fill sizes={kind === "application-featured" ? "(max-width: 760px) 100vw, 45vw" : "(max-width: 760px) 100vw, 25vw"} priority unoptimized style={portalImageStyle(kind, item.imageAdjust)} /></span> : <ApplicationResultPreview kind={fallback} />;
}

const productPaths = [
  {
    id: "api",
    index: "01",
    title: "一个 API密钥，连接全部模型",
    outcome: "多模态统一接入，OpenAI 兼容，换模型不用改代码。",
    meta: "模型 API",
    href: "/products?cate=api",
    cta: "浏览模型",
    preview: {
      kind: "api" as const,
      eyebrow: "Live request",
      title: "chat.completions",
      lines: [
        { k: "model", v: "kimi-k2" },
        { k: "stream", v: "true" },
        { k: "latency", v: "312ms" },
      ],
      foot: "POST /v1/chat/completions",
    },
  },
  {
    id: "image",
    index: "02",
    title: "一句话生成可用的视觉资产",
    outcome: "海报、产品图与社媒素材，从提示词到多版本导出。",
    meta: "图片创作",
    href: "/studio?preset=image-default",
    cta: "开始创作",
    preview: {
      kind: "image" as const,
      eyebrow: "Studio · Image",
      title: "4 variants ready",
      lines: [
        { k: "prompt", v: "minimal product shot" },
        { k: "size", v: "1024×1024" },
        { k: "style", v: "studio soft" },
      ],
      foot: "preset · image-default",
    },
  },
  {
    id: "video",
    index: "03",
    title: "从脚本到成片，同一工作台",
    outcome: "选题、分镜、画面与导出串成一条流水线。",
    meta: "视频创作",
    href: "/studio?preset=video-default",
    cta: "开始创作",
    preview: {
      kind: "video" as const,
      eyebrow: "Studio · Video",
      title: "Script → shot list",
      lines: [
        { k: "scene", v: "03 / 08" },
        { k: "duration", v: "00:24" },
        { k: "voice", v: "zh-CN natural" },
      ],
      foot: "preset · video-default",
    },
  },
  {
    id: "agent",
    index: "04",
    title: "让 Agent 直接完成复杂任务",
    outcome: "对话、工具、作品和人工确认都在同一个工作台里完成。",
    meta: "Agent 工作台",
    href: "/studio",
    cta: "打开工作台",
    preview: {
      kind: "flow" as const,
      eyebrow: "Agent workspace",
      title: "Research and deliver",
      lines: [
        { k: "context", v: "project · files · skills" },
        { k: "tools", v: "artifacts · canvas · sheets" },
        { k: "status", v: "durable and resumable" },
      ],
      foot: "chat · tools · artifacts",
    },
  },
  {
    id: "team",
    index: "05",
    title: "不再共享一把密钥",
    outcome: "成员、项目 Key、预算与调用记录统一归属。",
    meta: "团队管理",
    href: "/account/team",
    cta: "管理团队",
    preview: {
      kind: "team" as const,
      eyebrow: "Team console",
      title: "Project keys",
      lines: [
        { k: "members", v: "12 active" },
        { k: "budget", v: "68% used" },
        { k: "audit", v: "live trail" },
      ],
      foot: "keys · permissions",
    },
  },
  {
    id: "business",
    index: "06",
    title: "私有化与专属部署，按你的流程接",
    outcome: "知识库、权限审批与专属环境，从方案到上线有人对接。",
    meta: "企业方案",
    href: "/business",
    cta: "查看方案",
    preview: {
      kind: "biz" as const,
      eyebrow: "Enterprise",
      title: "Deploy with control",
      lines: [
        { k: "kb", v: "private corpus" },
        { k: "access", v: "role + approval" },
        { k: "deploy", v: "dedicated / hybrid" },
      ],
      foot: "business · solutions",
    },
  },
] as const;

const startSteps = [
  {
    n: "01",
    title: "按任务选路径",
    copy: "从工作场景或下方能力路径进入，不必先懂全部模型。",
    href: "#portal-paths",
  },
  {
    n: "02",
    title: "在工作台试一次",
    copy: "用真实模型跑通结果，确认质量与成本再往下投。",
    href: "/studio",
  },
  {
    n: "03",
    title: "沉淀成可复用流程",
    copy: "保存 Skill、工作流或 API密钥，让下一次从这里开始。",
    href: "/studio/skills",
  },
] as const;

const planRows = [
  {
    name: "随用随付",
    detail: "按实际 Token 与生成量结算，余额清晰可见。",
    fit: "个人探索、按量开发",
    href: "/pricing",
    cta: "查看价格",
    points: ["无月费门槛", "明细可追溯", "随时充值"],
  },
  {
    name: "会员额度",
    detail: "每日刷新可用额度，适合稳定高频创作。",
    fit: "内容与创作团队",
    href: "/pricing",
    cta: "了解会员",
    featured: true,
    points: ["每日额度刷新", "创作更划算", "优先通道"],
  },
  {
    name: "团队空间",
    detail: "项目 Key、权限与预算同屏管理，调用有归属。",
    fit: "多人协作、API 治理",
    href: "/account/team",
    cta: "创建团队",
    points: ["项目级 Key", "预算上限", "调用审计"],
  },
] as const;

const faqs = [
  {
    q: "如何创建并使用智能体？",
    a: "进入工作台选择 Skill 或从工作场景进入，按提示运行即可。满意后可保存为可复用流程，下次一键启动。",
  },
  {
    q: "Token 如何计算与充值？",
    a: "对话与生成按实际用量扣减余额。可在账户用量查看明细，在计费页充值或开通会员额度。",
  },
  {
    q: "如何获取 API密钥 并管理权限？",
    a: "在账户中创建专用 Key，写入环境变量后通过 /v1/models 验证。团队场景建议按项目拆 Key，并及时轮换与撤销。",
  },
  {
    q: "是否支持私有知识库与企业部署？",
    a: "企业方案支持知识库接入、权限审批与私有化部署。可从企业页预约方案咨询，或先在个人版验证能力。",
  },
] as const;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="portal-label">{children}</p>;
}

function ArrowLink({ href = "/products" , children }: { href?: string; children: React.ReactNode }) {
  return <PortalLink href={href} className="portal-arrow-link">{children}<ChevronRight aria-hidden /></PortalLink>;
}

type ProductPath = (typeof productPaths)[number];

function PathPreviewVisual({ path, interactive }: { path: ProductPath; interactive: boolean }) {
  const { preview } = path;
  return (
    <>
      <div className="portal-ed-preview-chrome">
        <span className="portal-ed-preview-dots" aria-hidden>
          <i /><i /><i />
        </span>
        <span className="portal-ed-preview-eyebrow">{preview.eyebrow}</span>
      </div>
      <div className="portal-ed-preview-body">
        <p className="portal-ed-preview-title">{preview.title}</p>
        <dl className="portal-ed-preview-kv">
          {preview.lines.map((line) => (
            <div key={line.k}>
              <dt>{line.k}</dt>
              <dd>{line.v}</dd>
            </div>
          ))}
        </dl>
        {preview.kind === "api" ? (
          <pre className="portal-ed-preview-code" tabIndex={interactive ? 0 : -1}>
{`curl https://api.winlume.ai/v1/chat/completions \\
  -H "Authorization: Bearer $KEY" \\
  -d '{"model":"kimi-k2","stream":true}'`}
          </pre>
        ) : null}
        {preview.kind === "image" ? (
          <div className="portal-ed-preview-mosaic" aria-hidden>
            <span /><span /><span /><span />
          </div>
        ) : null}
        {preview.kind === "video" ? (
          <div className="portal-ed-preview-timeline" aria-hidden>
            <span className="is-on" /><span /><span className="is-on" /><span /><span />
          </div>
        ) : null}
        {preview.kind === "flow" ? (
          <div className="portal-ed-preview-nodes" aria-hidden>
            <span>In</span><i /><span>Model</span><i /><span>Review</span><i /><span>Out</span>
          </div>
        ) : null}
        {preview.kind === "team" ? (
          <div className="portal-ed-preview-bars" aria-hidden>
            <div><b style={{ width: "68%" }} /><em>预算</em></div>
            <div><b style={{ width: "42%" }} /><em>Key 活跃</em></div>
          </div>
        ) : null}
        {preview.kind === "biz" ? (
          <div className="portal-ed-preview-shield" aria-hidden>
            <strong>Private</strong>
            <span>知识库 · 审批 · 部署</span>
          </div>
        ) : null}
      </div>
      <div className="portal-ed-preview-foot">
        <code>{preview.foot}</code>
        <PortalLink
          href={path.href}
          className="portal-ed-preview-cta"
          tabIndex={interactive ? undefined : -1}
          aria-hidden={!interactive}
        >
          {path.cta}
          <ChevronRight aria-hidden />
        </PortalLink>
      </div>
    </>
  );
}

/**
 * Tinder / 探探 style deck:
 * - stack: front full size, next cards scaled down slightly behind
 * - switch: clone of front flies left/right with rotation, then drops
 */
const STACK_VISIBLE = 3;
const STACK_MIN_SCALE = 0.9;
const STACK_MAX_SCALE = 1;
const STACK_POW_BASE = Math.pow(STACK_MIN_SCALE / STACK_MAX_SCALE, 1 / STACK_VISIBLE);
const STACK_STEP_Y = 10;
/** Exit flight duration — match CSS `.portal-ed-preview-fly` transition. */
const SWIPE_MS = 780;
/** Min gap between accepted path changes so rapid hover doesn't stutter. */
const SWIPE_COOLDOWN_MS = 420;

type FlyAway = {
  key: number;
  pathId: ProductPath["id"];
  dir: "left" | "right";
  phase: "from" | "to";
};

function stackOrderFrom(activeId: ProductPath["id"]): ProductPath[] {
  const start = productPaths.findIndex((p) => p.id === activeId);
  if (start < 0) return [...productPaths];
  return [...productPaths.slice(start), ...productPaths.slice(0, start)];
}

function stackCardStyle(depth: number): CSSProperties {
  if (depth >= STACK_VISIBLE) {
    return {
      opacity: 0,
      transform: `translate3d(0, ${STACK_STEP_Y * STACK_VISIBLE}px, 0) scale(${STACK_MIN_SCALE})`,
      zIndex: 0,
      pointerEvents: "none",
    };
  }
  const scale = STACK_MAX_SCALE * STACK_POW_BASE ** depth;
  const ty = STACK_STEP_Y * depth;
  const opacity = depth === 0 ? 1 : Math.max(0.75, 1 - depth * 0.12);
  return {
    opacity,
    transform: `translate3d(0, ${ty}px, 0) scale(${scale})`,
    zIndex: 20 - depth,
    pointerEvents: depth === 0 ? "auto" : "none",
  };
}

function swipeDirection(fromId: ProductPath["id"], toId: ProductPath["id"]): "left" | "right" {
  const from = productPaths.findIndex((p) => p.id === fromId);
  const to = productPaths.findIndex((p) => p.id === toId);
  if (from < 0 || to < 0 || from === to) return "left";
  const n = productPaths.length;
  const forward = (to - from + n) % n;
  const backward = (from - to + n) % n;
  // Prefer the shorter arc; ties swipe left (探探默认刷走方向)
  return forward <= backward ? "left" : "right";
}

function contentFeaturedSlides(content?: PortalContentConfig): FeaturedSlide[] {
  const slides = content?.carousel
    ?.filter((slide) => slide.enabled !== false && slide.imageUrl && slide.alt)
    .map((slide) => ({ id: slide.id, src: slide.imageUrl, alt: slide.alt, href: slide.href || "/products?cate=api", adjust: slide.imageAdjust }));
  return slides?.length ? slides : FEATURED_SLIDES;
}

export default function ModelMarket({ initialContent }: { initialContent?: PortalContentConfig }) {
  const router = useRouter();
  const { account, balanceConfig } = useModals();
  usePortalCanvasScale();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const featuredSlides = contentFeaturedSlides(initialContent);
  const managedApplications = initialContent?.applicationShowcase?.length ? initialContent.applicationShowcase : initialManagedApplications;
  const managedCapabilities = initialContent?.capabilityShowcase?.length ? initialContent.capabilityShowcase : initialManagedCapabilities;
  const [featuredPaused, setFeaturedPaused] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activePathId, setActivePathId] = useState<ProductPath["id"]>("api");
  const [flyAways, setFlyAways] = useState<FlyAway[]>([]);
  const flyKeyRef = useRef(0);
  const flyTimersRef = useRef<number[]>([]);
  const activePathIdRef = useRef<ProductPath["id"]>("api");
  const lastSwipeAtRef = useRef(0);
  const pendingPathRef = useRef<ProductPath["id"] | null>(null);
  const cooldownTimerRef = useRef<number | null>(null);
  const [notice, setNotice] = useState("");
  const [chatwootReady, setChatwootReady] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  const [onboardingPlacement, setOnboardingPlacement] = useState<OnboardingPlacement | null>(null);
  const onboardingCardRef = useRef<HTMLElement | null>(null);
  const [activeApiId, setActiveApiId] = useState<string | null>(null);
  const apiFlyoutCloseTimerRef = useRef<number | null>(null);
  const [overview, setOverview] = useState<ConsoleOverview | null>(null);
  const balance = formatBalance(account?.quota, balanceConfig);
  const usedCredits = overview?.wallet.usedCredits ?? null;
  const quotaPct = overview?.wallet.membershipAllowance ? remainingAllowancePercent(overview.wallet.membershipAllowance) : null;
  const activePath = productPaths.find((path) => path.id === activePathId) ?? productPaths[0];
  const stackPaths = stackOrderFrom(activePath.id).slice(0, STACK_VISIBLE);
  const popularApplications = managedApplications.filter((item) => item.enabled && item.group === "popular");
  const apiCategories = homepageApiCategories(initialContent?.modelVendors ?? []);
  const visibleCapabilities = managedCapabilities.filter((item) => item.enabled).slice(0, 3);

  useEffect(() => {
    activePathIdRef.current = activePathId;
  }, [activePathId]);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    getConsoleOverview()
      .then((payload) => { if (!cancelled) setOverview(payload); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [account]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(PORTAL_ONBOARDING_STORAGE_KEY)) return;
    } catch {
      // Private browsing can disable storage; the guide still works for this visit.
    }

    const timer = window.setTimeout(() => setOnboardingStep(0), 520);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (onboardingStep == null) {
      setOnboardingPlacement(null);
      return;
    }

    const step = onboardingSteps[onboardingStep];
    const selector = `[data-onboarding-target="${step.target}"]`;
    const updatePlacement = () => {
      const target = document.querySelector(selector);
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const measuredCard = onboardingCardRef.current?.getBoundingClientRect();
      const cardWidth = Math.min(440, window.innerWidth - 32);
      const cardHeight = Math.max(352, measuredCard?.height ?? 352);
      const margin = 28;
      const safeTop = 84;
      const safeBottom = 24;
      const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
      const availableRight = window.innerWidth - rect.right - margin - cardWidth;
      const availableLeft = rect.left - margin - cardWidth;
      let left = 0;
      let top = 0;
      let mode: OnboardingPlacementMode = "spotlight";
      let connectorPath = "";
      let connectorStart = { x: 0, y: 0 };
      let connectorTarget = { x: 0, y: 0 };

      if (step.target === "agent") {
        const belowTop = rect.bottom + margin;
        const aboveTop = rect.top - margin - cardHeight;
        const useBelow = belowTop + cardHeight <= window.innerHeight - safeBottom;
        const useAbove = aboveTop >= safeTop;
        mode = useBelow ? "below" : useAbove ? "above" : "spotlight";
        top = useBelow
          ? belowTop
          : useAbove
            ? aboveTop
            : clamp(rect.top + rect.height * .24, safeTop, window.innerHeight - cardHeight - safeBottom);
        left = clamp(rect.left + Math.min(56, rect.width * .16), 16, window.innerWidth - cardWidth - 16);
        if (mode !== "spotlight") {
          const isBelow = mode === "below";
          connectorStart = { x: clamp(left + cardWidth * .5, 24, window.innerWidth - 24), y: isBelow ? top : top + cardHeight };
          connectorTarget = { x: clamp(rect.left + rect.width * .5, 24, window.innerWidth - 24), y: isBelow ? rect.bottom : rect.top };
          const elbowY = isBelow ? rect.bottom + 13 : rect.top - 13;
          connectorPath = `M ${connectorStart.x} ${connectorStart.y} V ${elbowY} H ${connectorTarget.x} V ${connectorTarget.y}`;
        }
      } else {
        const canPlaceRight = availableRight >= 0;
        const canPlaceLeft = availableLeft >= 0;
        const placeLeft = step.target === "tools" ? canPlaceLeft : !canPlaceRight && canPlaceLeft;
        if (canPlaceRight || canPlaceLeft) {
          mode = "side";
          left = placeLeft
            ? clamp(rect.left - cardWidth - margin, 16, window.innerWidth - cardWidth - 16)
            : clamp(rect.right + margin, 16, window.innerWidth - cardWidth - 16);
          top = clamp(rect.top + Math.min(38, rect.height * .14), safeTop, window.innerHeight - cardHeight - safeBottom);
          const targetX = placeLeft ? rect.left : rect.right;
          const targetY = clamp(rect.top + rect.height * .5, 74, window.innerHeight - 42);
          const startY = clamp(top + cardHeight * .5, top + 66, top + cardHeight - 56);
          const startX = placeLeft ? left + cardWidth : left;
          const elbowX = placeLeft ? startX + 18 : startX - 18;
          connectorStart = { x: startX, y: startY };
          connectorTarget = { x: targetX, y: targetY };
          connectorPath = `M ${startX} ${startY} H ${elbowX} V ${targetY} H ${targetX}`;
        } else {
          const belowTop = rect.bottom + margin;
          const aboveTop = rect.top - margin - cardHeight;
          const useBelow = belowTop + cardHeight <= window.innerHeight - safeBottom;
          const useAbove = aboveTop >= safeTop;
          mode = useBelow ? "below" : useAbove ? "above" : "spotlight";
          top = useBelow
            ? belowTop
            : useAbove
              ? aboveTop
              : clamp(rect.top + rect.height * .18, safeTop, window.innerHeight - cardHeight - safeBottom);
          left = clamp(rect.left + (rect.width - cardWidth) * .5, 16, window.innerWidth - cardWidth - 16);
          if (mode !== "spotlight") {
            const isBelow = mode === "below";
            connectorStart = { x: clamp(left + cardWidth * .5, 24, window.innerWidth - 24), y: isBelow ? top : top + cardHeight };
            connectorTarget = { x: clamp(rect.left + rect.width * .5, 24, window.innerWidth - 24), y: isBelow ? rect.bottom : rect.top };
            const elbowY = isBelow ? rect.bottom + 13 : rect.top - 13;
            connectorPath = `M ${connectorStart.x} ${connectorStart.y} V ${elbowY} H ${connectorTarget.x} V ${connectorTarget.y}`;
          }
        }
      }

      setOnboardingPlacement({
        left,
        top,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        mode,
        connectorPath,
        connectorStart,
        connectorTarget,
        targetRect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      });
    };

    updatePlacement();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePlacement);
    const target = document.querySelector(selector);
    if (target) resizeObserver?.observe(target);
    if (onboardingCardRef.current) resizeObserver?.observe(onboardingCardRef.current);
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [onboardingStep]);

  const stepFeatured = useCallback((delta: number) => {
    setFeaturedIndex((current) => {
      const n = featuredSlides.length;
      return (current + delta + n) % n;
    });
  }, [featuredSlides.length]);

  useEffect(() => {
    if (featuredPaused || featuredSlides.length <= 1) return;
    const timer = window.setInterval(() => stepFeatured(1), FEATURED_AUTO_MS);
    return () => window.clearInterval(timer);
  }, [featuredPaused, featuredSlides.length, stepFeatured]);

  useEffect(() => {
    return () => {
      flyTimersRef.current.forEach((id) => window.clearTimeout(id));
      flyTimersRef.current = [];
      if (cooldownTimerRef.current != null) {
        window.clearTimeout(cooldownTimerRef.current);
      }
      if (apiFlyoutCloseTimerRef.current != null) {
        window.clearTimeout(apiFlyoutCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onReady = () => setChatwootReady(true);
    window.addEventListener("chatwoot:ready", onReady);

    if (window.$chatwoot) {
      onReady();
    }

    if (!window.__reizoChatwootStarted) {
      window.__reizoChatwootStarted = true;
      // Reuse the portal's compact "客服" control as the only launcher.
      window.chatwootSettings = { ...window.chatwootSettings, hideMessageBubble: true };
      const loadWidget = () => window.chatwootSDK?.run({
        websiteToken: CHATWOOT_WEBSITE_TOKEN,
        baseUrl: CHATWOOT_BASE_URL,
      });
      const script = document.getElementById("chatwoot-sdk") as HTMLScriptElement | null;

      if (script) {
        if (window.chatwootSDK) loadWidget();
        else script.addEventListener("load", loadWidget, { once: true });
      } else {
        const widgetScript = document.createElement("script");
        widgetScript.id = "chatwoot-sdk";
        widgetScript.src = `${CHATWOOT_BASE_URL}/packs/js/sdk.js`;
        widgetScript.async = true;
        widgetScript.onload = loadWidget;
        document.head.appendChild(widgetScript);
      }
    }

    return () => window.removeEventListener("chatwoot:ready", onReady);
  }, []);

  function commitPathSwipe(nextId: ProductPath["id"]) {
    const fromId = activePathIdRef.current;
    if (nextId === fromId) return;

    const dir = swipeDirection(fromId, nextId);
    const key = ++flyKeyRef.current;

    lastSwipeAtRef.current = Date.now();
    activePathIdRef.current = nextId;
    setFlyAways((prev) => [...prev, { key, pathId: fromId, dir, phase: "from" }]);
    setActivePathId(nextId);

    // Double rAF: paint at rest, then apply exit transform for a real transition
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFlyAways((prev) =>
          prev.map((item) => (item.key === key ? { ...item, phase: "to" } : item)),
        );
      });
    });

    const timer = window.setTimeout(() => {
      setFlyAways((prev) => prev.filter((item) => item.key !== key));
      flyTimersRef.current = flyTimersRef.current.filter((id) => id !== timer);
    }, SWIPE_MS + 80);
    flyTimersRef.current.push(timer);
  }

  function selectPath(nextId: ProductPath["id"]) {
    if (nextId === activePathIdRef.current && pendingPathRef.current == null) return;
    if (nextId === activePathIdRef.current) {
      pendingPathRef.current = null;
      return;
    }

    const elapsed = Date.now() - lastSwipeAtRef.current;
    if (elapsed < SWIPE_COOLDOWN_MS) {
      // Coalesce rapid hovers onto the latest target; flush after cooldown
      pendingPathRef.current = nextId;
      if (cooldownTimerRef.current == null) {
        cooldownTimerRef.current = window.setTimeout(() => {
          cooldownTimerRef.current = null;
          const pending = pendingPathRef.current;
          pendingPathRef.current = null;
          if (pending && pending !== activePathIdRef.current) {
            commitPathSwipe(pending);
          }
        }, SWIPE_COOLDOWN_MS - elapsed);
      }
      return;
    }

    pendingPathRef.current = null;
    commitPathSwipe(nextId);
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim();
    setSubmittedQuery(normalized);
    if (!normalized) {
      setNotice("请输入任务、模型或应用名称");
      window.setTimeout(() => setNotice(""), 1800);
      return;
    }
    router.push(`/products?cate=app&q=${encodeURIComponent(normalized)}`);
  }

  function openSupportChat() {
    if (window.$chatwoot) {
      window.$chatwoot.toggle("open");
      return;
    }
    setNotice(chatwootReady ? "在线客服暂时不可用，请稍后重试" : "在线客服正在连接，请稍后再试");
  }

  function completeOnboarding() {
    try {
      window.localStorage.setItem(PORTAL_ONBOARDING_STORAGE_KEY, "complete");
    } catch {
      // Keep the dismissed state for the active React session if storage is unavailable.
    }
    setOnboardingStep(null);
  }

  function changeOnboardingStep(next: number) {
    if (next >= onboardingSteps.length) {
      completeOnboarding();
      return;
    }
    setOnboardingStep(Math.max(0, next));
  }

  // The supplier panel is deliberately positioned outside its compact row. A
  // short exit grace period keeps it open while the cursor crosses that visual
  // boundary, preventing the open/close loop that made lower rows (notably RAG)
  // flicker.
  function clearApiFlyoutCloseTimer() {
    if (apiFlyoutCloseTimerRef.current == null) return;
    window.clearTimeout(apiFlyoutCloseTimerRef.current);
    apiFlyoutCloseTimerRef.current = null;
  }

  function openApiFlyout(id: string) {
    clearApiFlyoutCloseTimer();
    setActiveApiId(id);
  }

  function scheduleApiFlyoutClose() {
    clearApiFlyoutCloseTimer();
    apiFlyoutCloseTimerRef.current = window.setTimeout(() => {
      setActiveApiId(null);
      apiFlyoutCloseTimerRef.current = null;
    }, 180);
  }

  return (
    <div className="portal-home portal-home-dashboard portal-density-shell">
      <div className="portal-frame">
        <PortalHeader notifications={initialContent?.notifications} />

        <div className="portal-search-row">
          <section className={`portal-search-card${onboardingStep === 0 ? " is-onboarding-target" : ""}`} data-onboarding-target="agent" aria-labelledby="portal-search-title">
            <Image className="portal-search-waves" src="/figma-home/search-waves.svg" alt="" fill sizes="710px" priority />
            <div className="portal-search-content">
              <div className="portal-search-heading">
                <div>
                  <h1 id="portal-search-title">找到适合你的 <em>AI</em> 能力</h1>
                </div>
              </div>
              <div className="portal-search-form-row">
                <form className="portal-search-form" onSubmit={submitSearch}>
                  <Search aria-hidden />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、应用、模型或 API，例如：产品图、财务分析、PPT" aria-label="搜索 AI 能力" />
                  <HeroButton type="submit" variant="primary" size="md" className="portal-hero-search-button"><Search aria-hidden />搜索</HeroButton>
                </form>
                <PortalLink href="/studio" className="portal-workbench-button"><Bot aria-hidden />进入Agent工作台<ChevronRight aria-hidden /></PortalLink>
              </div>
              <div className="portal-chip-list" aria-label="热门能力">
                {searchSuggestions.map(({ label, icon: Icon, category }) => (
                  <HeroButton
                    key={label}
                    type="button"
                    variant={query === label ? "primary" : "tertiary"}
                    size="sm"
                    className="portal-hero-chip"
                    onClick={() => {
                      setQuery(label);
                      setSubmittedQuery(label);
                      router.push(`/products?cate=app&category=${encodeURIComponent(category)}`);
                    }}
                  >
                    <Icon aria-hidden />{label}
                  </HeroButton>
                ))}
                <HeroButton type="button" variant="tertiary" size="sm" className="portal-hero-chip" onClick={() => router.push("/products?cate=app")}><LayoutGrid aria-hidden />更多</HeroButton>
              </div>
            </div>
          </section>

          <article className="portal-enterprise-card portal-search-aside" aria-labelledby="portal-enterprise-title">
            <h2 id="portal-enterprise-title">企业AI智能化解决方案</h2>
            <p>私有化部署、系统集成与专属服务，助力企业安全高效落地 AI。</p>
            <PortalLink href="/business" className="portal-enterprise-button">进入企业版<ChevronRight aria-hidden /></PortalLink>
            <Image src="/figma-home/building.svg" alt="" width={145} height={116} />
          </article>
        </div>

        {submittedQuery && <p className="portal-search-result" role="status">已为你准备“{submittedQuery}”相关能力，先从下面的工具分类开始。</p>}

        <div className="portal-discovery-grid">
          <aside className={`portal-api-card${onboardingStep === 1 ? " is-onboarding-target" : ""}`} data-onboarding-target="api" aria-labelledby="portal-api-title">
            <div className="portal-api-card-head">
              <div className="portal-api-title-line"><h2 id="portal-api-title">API模型</h2></div>
              <div className="portal-api-card-actions"><span className="portal-api-billing-badge">按量计费</span><ArrowLink href="/products?cate=api">查看全部API模型</ArrowLink></div>
            </div>
            <div className="portal-api-list" role="list">
              {apiCategories.map((item) => (
                <div
                  key={item.id}
                  className="portal-api-row"
                  role="listitem"
                  tabIndex={0}
                  onMouseEnter={() => openApiFlyout(item.id)}
                  onMouseLeave={scheduleApiFlyoutClose}
                  onFocusCapture={() => openApiFlyout(item.id)}
                  onBlurCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      clearApiFlyoutCloseTimer();
                      setActiveApiId(null);
                    }
                  }}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("a, button")) return;
                    setActiveApiId((current) => current === item.id ? null : item.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setActiveApiId((current) => current === item.id ? null : item.id);
                  }}
                >
                  <PortalLink href={item.href} className="portal-api-row-label">
                    <AssetIcon src={item.icon} />
                    <span>{item.label}</span>
                  </PortalLink>
                  <span className="portal-api-row-divider" aria-hidden />
                  <div className="portal-api-brands" aria-label={`${item.label}可用模型：${item.brands.map((brand) => brand.label).join("、")}`}>
                    {item.brands.length === 0 && <span className="portal-api-empty">暂无已发布提供商</span>}
                    {item.brands.slice(0, 3).map((brand) => (
                      <PortalLink key={brand.label} href={brand.href} className="portal-api-brand">
                        <Image src={brand.icon} alt="" width={16} height={16} unoptimized />
                        <span title={brand.label}>{brand.label}</span>
                      </PortalLink>
                    ))}
                  </div>
                  {item.brands.length > 3 ? <button
                    type="button"
                    className="portal-api-row-more portal-api-row-more-button"
                    aria-label={`${item.label}更多提供商`}
                    aria-expanded={activeApiId === item.id}
                    aria-controls={`portal-api-providers-${item.id}`}
                    onClick={() => openApiFlyout(item.id)}
                  >
                    <ChevronRight aria-hidden />
                  </button> : <PortalLink href={item.href} className="portal-api-row-more" aria-label={`${item.label}更多`}>
                    <ChevronRight aria-hidden />
                  </PortalLink>}
                  {activeApiId === item.id && item.brands.length > 0 ? (
                    <div
                      className="portal-api-touch-card"
                      id={`portal-api-providers-${item.id}`}
                      role="dialog"
                      aria-label={`${item.label}热门模型`}
                      onMouseEnter={clearApiFlyoutCloseTimer}
                      onMouseLeave={scheduleApiFlyoutClose}
                    >
                      <div className="portal-api-touch-head">
                        <div><AssetIcon src={item.icon} /><strong>{item.label}</strong><span>{item.brands.length} 个模型提供商</span></div>
                        <PortalLink href={item.href}>查看全部<ChevronRight aria-hidden /></PortalLink>
                      </div>
                      <div className="portal-api-touch-grid">
                        {item.brands.map((brand) => (
                          <PortalLink key={brand.label} href={brand.href}>
                            <span><Image src={brand.icon} alt="" width={28} height={28} unoptimized /></span>
                            <strong>{brand.label}</strong>
                            <small>{brand.description}</small>
                          </PortalLink>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </aside>

          <section className={`portal-tools-card${onboardingStep === 2 ? " is-onboarding-target" : ""}`} data-onboarding-target="tools" aria-labelledby="portal-tools-title">
            <div className="portal-tools-head">
              <h2 id="portal-tools-title">应用工具</h2>
              <div className="portal-tools-head-actions">
                <div className="portal-tools-proof" aria-label="平台能力规模"><span className="portal-api-billing-badge">300+ 应用</span><span className="portal-api-billing-badge">2600+ Skills</span></div>
                <ArrowLink href="/products?cate=app">查看全部工具</ArrowLink>
              </div>
            </div>
            <div className="portal-tools-grid">
              {toolApplications.map((tool) => (
                <PortalLink href={tool.href} className="portal-tool-card" key={tool.label}>
                  <AssetIcon src={tool.icon} />
                  <strong>{tool.label}</strong>
                  <span>{tool.detail}</span>
                </PortalLink>
              ))}
            </div>
          </section>

          <article
            className="portal-featured-card portal-featured-carousel"
            aria-roledescription="carousel"
            aria-label="Model Review 精选轮播"
            onMouseEnter={() => setFeaturedPaused(true)}
            onMouseLeave={() => setFeaturedPaused(false)}
            onFocusCapture={() => setFeaturedPaused(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setFeaturedPaused(false);
              }
            }}
          >
            <div className="portal-featured-track">
              {featuredSlides.map((slide, index) => (
                <PortalLink
                  key={slide.id}
                  href={slide.href}
                  className={`portal-featured-slide${index === featuredIndex ? " is-active" : ""}`}
                  aria-hidden={index !== featuredIndex}
                  tabIndex={index === featuredIndex ? 0 : -1}
                >
                  <Image
                    className="portal-featured-slide-img"
                    src={slide.src}
                    alt={slide.alt}
                    fill
                    sizes="(max-width: 1100px) 100vw, 812px"
                    priority
                    unoptimized
                    style={portalImageStyle("carousel", slide.adjust)}
                  />
                </PortalLink>
              ))}
            </div>

            <button
              type="button"
              className="portal-featured-nav is-prev"
              aria-label="上一张精选"
              onClick={() => stepFeatured(-1)}
            >
              <ChevronLeft aria-hidden />
            </button>
            <button
              type="button"
              className="portal-featured-nav is-next"
              aria-label="下一张精选"
              onClick={() => stepFeatured(1)}
            >
              <ChevronRight aria-hidden />
            </button>

            <div className="portal-featured-dots" role="tablist" aria-label="精选页码">
              {featuredSlides.map((slide, index) => (
                <button
                  key={slide.id}
                  type="button"
                  role="tab"
                  aria-selected={index === featuredIndex}
                  aria-label={`第 ${index + 1} 张：${slide.alt}`}
                  className={index === featuredIndex ? "is-active" : ""}
                  onClick={() => setFeaturedIndex(index)}
                />
              ))}
            </div>
          </article>

          <div className="portal-side-cards">
            <section
              className="portal-side-card portal-usage-card portal-usage-card-link"
              aria-labelledby="portal-usage-title"
              role="link"
              tabIndex={0}
              onClick={() => router.push("/account")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  router.push("/account");
                }
              }}
            >
              <div className="portal-usage-heading">
                <div className="portal-card-heading"><Image src="/figma-home/usage-icon.svg" alt="" width={20} height={20} /><h2 id="portal-usage-title">账户概览</h2></div>
                <Link href="/account" className="portal-arrow-link" onClick={(event) => event.stopPropagation()}>进入个人中心<ChevronRight aria-hidden /></Link>
              </div>
              <div className="portal-usage-stats">
                <div><span>余额</span><strong>{balance === "余额同步中" ? "—" : balance}</strong></div>
                <div><span>累计消耗额度</span><strong>{usedCredits != null ? fmtUsage(displayAllowance(usedCredits)) : "—"}</strong></div>
                <div className="portal-membership-quota"><span><em>{overview?.wallet.subscription.status === "active" ? overview.wallet.subscription.name : "未开通"}</em>套餐剩余额度</span><strong>{quotaPct != null ? `${quotaPct}%` : "—"}</strong></div>
              </div>
            </section>
          </div>
        </div>

        <section className="portal-app-showcase portal-app-showcase-v2 portal-app-showcase-popular" aria-labelledby="portal-popular-apps-title">
          <div className="portal-app-showcase-head">
            <h2 id="portal-popular-apps-title">热门应用</h2>
            <PortalLink href="/products?cate=app" className="portal-arrow-link">查看全部应用</PortalLink>
          </div>
          <div className="portal-featured-app-grid">
            {popularApplications.slice(0, 1).map((app) => (
              <PortalLink href={app.href} aria-label={app.title} className="portal-featured-app-card" key={app.title}>
                <ManagedApplicationVisual item={app} fallback={portalApplicationShowcase[0]?.preview ?? "storyboard"} kind="application-featured" />
              </PortalLink>
            ))}
            <div className="portal-app-support-grid">
              {popularApplications.slice(1, 5).map((app, index) => (
                <PortalLink href={app.href} aria-label={app.title} className="portal-app-support-card" key={app.title}>
                  <ManagedApplicationVisual item={app} fallback={portalApplicationShowcase[index + 1]?.preview ?? "poster"} kind="application-support" />
                </PortalLink>
              ))}
            </div>
          </div>
        </section>

        <section className="portal-bottom-explore portal-system-rail">
          <div className="portal-capability-showcase">{visibleCapabilities.map((card) => <div role="img" aria-label={card.title} className={`portal-capability-hero is-${card.tone}${card.imageUrl ? " has-managed-image" : ""}`} key={card.id}>{card.imageUrl ? <Image className="portal-managed-capability-image" src={card.imageUrl} alt="" fill sizes="(max-width: 760px) 100vw, 34vw" priority unoptimized style={portalImageStyle("capability", card.imageAdjust)} /> : <CapabilityEvidence kind={card.tone === "agent" ? "agent" : card.tone === "usage" ? "usage" : "models"} />}</div>)}</div>
          <PortalFooter />
        </section>

        <section className="portal-industry-section" aria-labelledby="portal-industry-title">
          <div className="portal-section-header"><div><h2 id="portal-industry-title">工作场景</h2><p>按任务开始，快速找到匹配的生产级 Skill</p></div><ArrowLink href="/studio/skills">探索全部工具</ArrowLink></div>
          <div className="portal-industry-grid">{workScenes.map((item) => <PortalLink href={item.href} className="portal-industry-card" key={item.id}><AssetIcon src={item.icon} /><span>{item.label}</span><ChevronRight aria-hidden /></PortalLink>)}</div>
        </section>

        <div className="portal-ed">
          <section className="portal-ed-stage" id="portal-paths" aria-labelledby="portal-paths-title">
            <div className="portal-ed-stage-glow" aria-hidden />
            <div className="portal-ed-stage-head">
              <p className="portal-ed-kicker">Product paths</p>
              <h2 id="portal-paths-title">选一条路径，先看见产品，再决定进入</h2>
            </div>

            <div className="portal-ed-stage-body">
              <ul className="portal-ed-path-list" role="listbox" aria-label="产品路径" aria-activedescendant={`path-${activePath.id}`}>
                {productPaths.map((path) => {
                  const active = path.id === activePath.id;
                  return (
                    <li key={path.id} id={`path-${path.id}`} role="option" aria-selected={active}>
                      <div
                        className={`portal-ed-path-row${active ? " is-active" : ""}`}
                        onPointerEnter={() => selectPath(path.id)}
                        onFocus={() => selectPath(path.id)}
                      >
                        <span className="portal-ed-path-index" aria-hidden>{path.index}</span>
                        <button
                          type="button"
                          className="portal-ed-path-select"
                          onClick={() => selectPath(path.id)}
                          aria-label={`预览 ${path.meta}`}
                        >
                          <span className="portal-ed-path-meta">{path.meta}</span>
                          <strong>{path.title}</strong>
                          <span className="portal-ed-path-outcome">{path.outcome}</span>
                        </button>
                        <PortalLink href={path.href} className="portal-ed-path-go">
                          {path.cta}
                          <ChevronRight aria-hidden />
                        </PortalLink>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <aside className="portal-ed-preview" aria-live="polite" aria-label={`${activePath.meta} 产品预览`}>
                <div className="portal-ed-preview-stack">
                  {stackPaths.map((path, depth) => {
                    const isFront = depth === 0;
                    return (
                      <div
                        key={path.id}
                        className={`portal-ed-preview-card kind-${path.preview.kind}${isFront ? " is-front" : ""}`}
                        data-depth={depth}
                        style={stackCardStyle(depth)}
                        aria-hidden={!isFront}
                      >
                        <PathPreviewVisual path={path} interactive={isFront} />
                      </div>
                    );
                  })}
                  {flyAways.map((fly) => {
                    const path = productPaths.find((entry) => entry.id === fly.pathId);
                    if (!path) return null;
                    return (
                      <div
                        key={fly.key}
                        className={[
                          "portal-ed-preview-card",
                          "portal-ed-preview-fly",
                          `kind-${path.preview.kind}`,
                          fly.phase === "to" ? `is-exit-${fly.dir}` : "is-exit-from",
                        ].join(" ")}
                        aria-hidden
                      >
                        <PathPreviewVisual path={path} interactive={false} />
                      </div>
                    );
                  })}
                </div>
              </aside>
            </div>
          </section>

          <section className="portal-ed-steps" aria-labelledby="portal-steps-title">
            <div className="portal-ed-steps-inner">
              <div className="portal-ed-section-head portal-ed-section-head-light">
                <p className="portal-ed-kicker portal-ed-kicker-light">How it works</p>
                <h2 id="portal-steps-title">三步，把 AI 用进日常工作</h2>
                <p>发现、验证、沉淀。每一步都能直接点进去。</p>
              </div>
              <ol className="portal-ed-step-list">
                {startSteps.map((step) => (
                  <li key={step.n}>
                    <PortalLink href={step.href} className="portal-ed-step">
                      <span className="portal-ed-step-n">{step.n}</span>
                      <strong>{step.title}</strong>
                      <p>{step.copy}</p>
                      <span className="portal-ed-step-link">
                        继续
                        <ChevronRight aria-hidden />
                      </span>
                    </PortalLink>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="portal-ed-plans" aria-labelledby="portal-plans-title">
            <div className="portal-ed-section-head">
              <p className="portal-ed-kicker">Pricing</p>
              <h2 id="portal-plans-title">按使用方式开始，而不是先买席位</h2>
              <p>余额与额度透明；需要协作时再开团队空间。</p>
            </div>
            <div className="portal-ed-plan-grid">
              {planRows.map((plan) => (
                <article
                  className={`portal-ed-plan-card${"featured" in plan && plan.featured ? " is-featured" : ""}`}
                  key={plan.name}
                >
                  {"featured" in plan && plan.featured ? (
                    <span className="portal-ed-plan-badge">常用</span>
                  ) : null}
                  <h3>{plan.name}</h3>
                  <p className="portal-ed-plan-detail">{plan.detail}</p>
                  <p className="portal-ed-plan-fit">{plan.fit}</p>
                  <ul>
                    {plan.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                  <PortalLink href={plan.href} className="portal-ed-plan-cta">
                    {plan.cta}
                    <ChevronRight aria-hidden />
                  </PortalLink>
                </article>
              ))}
            </div>
          </section>

          <section className="portal-ed-support" id="portal-support" aria-labelledby="portal-support-title">
            <div className="portal-ed-support-panel">
              <div className="portal-ed-support-intro">
                <p className="portal-ed-kicker">Support</p>
                <h2 id="portal-support-title">问题先查这里，卡住再找人</h2>
                <p>从创建密钥 到企业部署，把常见决策写清楚。</p>
                <button type="button" className="portal-ed-support-cta" onClick={openSupportChat}>
                  联系技术支持
                  <ChevronRight aria-hidden />
                </button>
              </div>
              <div className="portal-ed-faq">
                {faqs.map((item, index) => {
                  const open = openFaq === index;
                  return (
                    <div className={`portal-ed-faq-item${open ? " is-open" : ""}`} key={item.q}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenFaq(open ? null : index)}
                      >
                        <span>{item.q}</span>
                        <span aria-hidden className="portal-ed-faq-mark">{open ? "−" : "+"}</span>
                      </button>
                      {open ? <p>{item.a}</p> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <PortalFooter />
        </div>
        </div>

        {onboardingStep != null ? (
          <div className="portal-onboarding" role="dialog" aria-modal="true" aria-labelledby="portal-onboarding-title" aria-describedby="portal-onboarding-description">
            <div className={`portal-onboarding-scrim${onboardingPlacement ? " is-spotlight" : ""}`} aria-hidden />
            {onboardingPlacement ? (
              <span
                className="portal-onboarding-highlight"
                aria-hidden
                style={{
                  left: onboardingPlacement.targetRect.left,
                  top: onboardingPlacement.targetRect.top,
                  width: onboardingPlacement.targetRect.width,
                  height: onboardingPlacement.targetRect.height,
                }}
              />
            ) : null}
            {onboardingPlacement?.connectorPath ? (
              <svg
                className="portal-onboarding-connector"
                aria-hidden
                viewBox={`0 0 ${onboardingPlacement.viewportWidth} ${onboardingPlacement.viewportHeight}`}
                preserveAspectRatio="none"
              >
                <defs>
                  <filter id="portal-onboarding-arrow-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  <marker id="portal-onboarding-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                    <path d="M 1 1 L 8 5 L 1 9" fill="none" stroke="#c5e4ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </marker>
                </defs>
                <path
                  className="portal-onboarding-connector-path"
                  d={onboardingPlacement.connectorPath}
                  markerEnd="url(#portal-onboarding-arrow)"
                  filter="url(#portal-onboarding-arrow-glow)"
                />
                <circle className="portal-onboarding-connector-dot" cx={onboardingPlacement.connectorStart.x} cy={onboardingPlacement.connectorStart.y} r="4" />
                <circle className="portal-onboarding-connector-target" cx={onboardingPlacement.connectorTarget.x} cy={onboardingPlacement.connectorTarget.y} r="4" />
              </svg>
            ) : null}
            <section
              ref={onboardingCardRef}
              className={`portal-onboarding-card${onboardingPlacement ? " is-ready" : ""}`}
              style={onboardingPlacement ? { left: onboardingPlacement.left, top: onboardingPlacement.top } : undefined}
            >
              <div className="portal-onboarding-progress">{onboardingStep + 1}/{onboardingSteps.length}</div>
              <div className="portal-onboarding-title-row">
                <span className={`portal-onboarding-icon is-${onboardingSteps[onboardingStep].target}`} aria-hidden>
                  {onboardingStep === 0 ? <Bot /> : onboardingStep === 1 ? <Search /> : <Crown />}
                </span>
                <h2 id="portal-onboarding-title">{onboardingSteps[onboardingStep].title}</h2>
              </div>
              <p className="portal-onboarding-lead">{onboardingSteps[onboardingStep].lead}</p>
              <p id="portal-onboarding-description" className="portal-onboarding-copy">{onboardingSteps[onboardingStep].body}</p>
              <div className="portal-onboarding-dots" aria-label={`第 ${onboardingStep + 1} 步，共 ${onboardingSteps.length} 步`}>
                {onboardingSteps.map((step, index) => <i key={step.target} className={index === onboardingStep ? "is-active" : ""} />)}
              </div>
              <div className="portal-onboarding-actions">
                <button type="button" className="portal-onboarding-skip" onClick={completeOnboarding}>跳过引导</button>
                <div>
                  {onboardingStep > 0 ? <button type="button" className="portal-onboarding-back" onClick={() => changeOnboardingStep(onboardingStep - 1)}>上一步</button> : null}
                  <button type="button" className="portal-onboarding-next" onClick={() => changeOnboardingStep(onboardingStep + 1)}>{onboardingStep === onboardingSteps.length - 1 ? "开始使用" : "下一步"}</button>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        <aside className="portal-floating-tools" aria-label="快捷工具"><button type="button" onClick={openSupportChat}><CircleHelp aria-hidden /><span>客服</span></button><span className="portal-floating-divider" aria-hidden /><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><ArrowUp aria-hidden /><span>顶部</span></button></aside>
      <div className={`portal-notice ${notice ? "is-visible" : ""}`} role="status" aria-live="polite">{notice}</div>
    </div>
  );
}
