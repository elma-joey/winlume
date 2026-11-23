"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Folder, Layers } from "lucide-react";
import Modal, { ModalCloseButton } from "@/components/Modal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Project } from "@/lib/agent/types";
import styles from "./cloud-chat.module.css";

function navigateOptions(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  if (event.target instanceof HTMLInputElement && (event.key === "Home" || event.key === "End")) return;
  const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-picker-option]:enabled")];
  if (!options.length) return;
  const current = options.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
    : event.key === "ArrowDown" ? (current + 1) % options.length
      : current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length;
  event.preventDefault();
  options[next].focus();
}

export function CloudMenu({ mobile, label, title, tooltip, className, disabled, side = "bottom", align = "start", trigger, children }: {
  mobile: boolean;
  label: string;
  title: string;
  tooltip?: string;
  className: string;
  disabled?: boolean;
  side?: "top" | "bottom";
  align?: "start" | "end";
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const button = <button type="button" className={className} aria-label={label} title={tooltip} disabled={disabled}
    aria-haspopup="dialog" aria-expanded={open} onClick={mobile ? () => setOpen(true) : undefined}>{trigger}</button>;
  const panel = <div className={styles.pickerContent} onKeyDown={navigateOptions}>
    <header className={styles.sheetHeader}><h2>{title}</h2><ModalCloseButton onClose={close} className={styles.pickerClose} /></header>
    {children(close)}
  </div>;

  return mobile ? <>
    {button}
    <Modal open={open} onClose={close} label={label} size="sheet">
      <div className={`${styles.sheetPanel} ${styles.pickerPanel}`}>{panel}</div>
    </Modal>
  </> : <Popover open={open} onOpenChange={setOpen} modal>
    <PopoverTrigger asChild>{button}</PopoverTrigger>
    <PopoverContent side={side} align={align} collisionPadding={12} aria-label={label}
      className={`${styles.sheetPanel} ${styles.pickerPanel} ${styles.pickerPopover}`}>{panel}</PopoverContent>
  </Popover>;
}

export function CloudProjectPicker({ mobile, projects, value, onChange, unassigned, disabled }: {
  mobile: boolean;
  projects: Project[];
  value: string;
  onChange: (value: string) => void;
  unassigned?: string;
  disabled?: boolean;
}) {
  const filter = unassigned !== undefined;
  const current = projects.find((project) => project.id === value)?.name
    ?? (filter && value !== unassigned ? "全部会话" : "未归类");
  const options = [
    ...(filter ? [{ id: "", name: "全部会话" }] : []),
    ...projects,
    { id: unassigned ?? "", name: "未归类" },
  ];
  return <CloudMenu mobile={mobile} label={filter ? "项目筛选" : "会话项目"}
    title={filter ? "筛选项目" : "移动到项目"} tooltip={filter ? current : `移动到项目 · ${current}`}
    className={filter ? styles.projectFilter : styles.moveProject} disabled={disabled} align={filter ? "start" : "end"}
    trigger={<><Folder size={filter ? 16 : 18} aria-hidden />{filter && <><span>{current}</span><ChevronDown size={14} aria-hidden /></>}</>}>
    {(close) => <div className={styles.pickerList}>
      {options.map(({ id, name }) => <button key={id} type="button" data-picker-option className={styles.pickerOption}
        aria-pressed={id === value} disabled={disabled} onClick={() => { close(); if (id !== value) onChange(id); }}>
        {filter && !id ? <Layers size={17} aria-hidden /> : <Folder size={17} aria-hidden />}
        <span className={styles.optionLabel}>{name}</span>
        <span className={styles.optionCheck}>{id === value && <Check size={16} aria-hidden />}</span>
      </button>)}
    </div>}
  </CloudMenu>;
}
