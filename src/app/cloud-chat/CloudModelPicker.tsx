"use client";

import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import Modal, { ModalCloseButton } from "@/components/Modal";
import { VendorLogo } from "@/components/VendorLogo";
import { inferVendorFromModel, type PlazaVendor } from "@/lib/catalog/vendors";
import styles from "./cloud-chat.module.css";

export function CloudModelPicker({ models, value, disabled, imageMode, onChange }: {
  models: string[] | null;
  value: string;
  disabled: boolean;
  imageMode: boolean;
  onChange: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = new Map<string, { vendor: PlazaVendor; models: string[] }>();
  for (const model of models ?? []) {
    const vendor = inferVendorFromModel(model);
    const group = groups.get(vendor.key);
    if (group) group.models.push(model);
    else groups.set(vendor.key, { vendor, models: [model] });
  }
  const label = imageMode ? "切换图片模型" : "切换模型";
  const logo = value ? inferVendorFromModel(value) : null;
  return <>
    <button type="button" className={styles.modelSelect} aria-label={label}
      aria-haspopup="dialog" aria-expanded={open} disabled={disabled || !models?.length}
      onClick={() => setOpen(true)}>
      {logo && <VendorLogo key={logo.key} src={logo.logo} name={logo.name} size={18} />}
      <span>{value || (models === null ? "加载模型…" : models.length ? "选择模型" : "暂无可用模型")}</span>
      <ChevronDown size={14} aria-hidden />
    </button>
    <Modal open={open} onClose={() => setOpen(false)} label={label} size="sheet">
      <div className={styles.sheetPanel}>
        <header className={styles.sheetHeader}><h2>{imageMode ? "图片模型" : "对话模型"}</h2><ModalCloseButton onClose={() => setOpen(false)} /></header>
        <div className={styles.modelList}>
          {[...groups.values()].map(({ vendor, models }) => <section key={vendor.key} aria-label={vendor.name}>
            <h3 className={styles.vendorHeading}><span aria-hidden="true"><VendorLogo src={vendor.logo} name={vendor.name} size={20} /></span>{vendor.name}</h3>
            {models.map((model) => <button type="button" key={model} className={styles.modelOption}
              aria-pressed={model === value} disabled={disabled} onClick={() => { setOpen(false); onChange(model); }}>
              <span>{model}</span>{model === value && <Check size={16} aria-hidden />}
            </button>)}
          </section>)}
        </div>
      </div>
    </Modal>
  </>;
}
