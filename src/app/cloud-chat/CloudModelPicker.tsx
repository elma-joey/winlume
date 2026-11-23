"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useState } from "react";
import { VendorLogo } from "@/components/VendorLogo";
import { inferVendorFromModel, type PlazaVendor } from "@/lib/catalog/vendors";
import { CloudMenu } from "./CloudMenu";
import styles from "./cloud-chat.module.css";

export function CloudModelPicker({ models, value, disabled, imageMode, mobile, onChange }: {
  models: string[] | null;
  value: string;
  disabled: boolean;
  imageMode: boolean;
  mobile: boolean;
  onChange: (model: string) => void;
}) {
  const label = imageMode ? "切换图片模型" : "切换模型";
  const logo = value ? inferVendorFromModel(value) : null;
  return <CloudMenu mobile={mobile} label={label} title={imageMode ? "图片模型" : "对话模型"}
    className={styles.modelSelect} disabled={disabled || !models?.length} side="top" align="end"
    trigger={<>
      {logo && <VendorLogo key={logo.key} src={logo.logo} name={logo.name} size={17} />}
      <span>{value || (models === null ? "加载模型…" : models.length ? "选择模型" : "暂无可用模型")}</span>
      <ChevronDown size={14} aria-hidden />
    </>}>
    {(close) => <ModelOptions models={models ?? []} value={value} disabled={disabled} onChange={(model) => { close(); onChange(model); }} />}
  </CloudMenu>;
}

function ModelOptions({ models, value, disabled, onChange }: {
  models: string[];
  value: string;
  disabled: boolean;
  onChange: (model: string) => void;
}) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const groups = new Map<string, { vendor: PlazaVendor; models: string[] }>();
  for (const model of models) {
    const vendor = inferVendorFromModel(model);
    if (term && ![model, vendor.name].some((label) => label.toLowerCase().includes(term))) continue;
    const group = groups.get(vendor.key);
    if (group) group.models.push(model);
    else groups.set(vendor.key, { vendor, models: [model] });
  }
  return <>
    <div className={styles.modelSearch}>
      <Search size={17} aria-hidden />
      <input type="text" aria-label="搜索模型或厂商" placeholder="搜索模型或厂商" value={query}
        autoComplete="off" onChange={(event) => setQuery(event.currentTarget.value)} />
      {query && <button type="button" aria-label="清空搜索" onClick={() => setQuery("")}><X size={16} aria-hidden /></button>}
    </div>
    <div className={styles.pickerList}>
      {!groups.size && <p className={styles.noOptions} role="status">没有匹配的模型</p>}
      {[...groups.values()].map(({ vendor, models }) => <section className={styles.vendorGroup} key={vendor.key} aria-label={vendor.name}>
        <h3 className={styles.vendorHeading}><span className={styles.vendorIcon} aria-hidden="true"><VendorLogo src={vendor.logo} name={vendor.name} size={18} /></span>{vendor.name}</h3>
        {models.map((model) => <button type="button" key={model} data-picker-option className={`${styles.pickerOption} ${styles.modelOption}`}
          aria-pressed={model === value} disabled={disabled} onClick={() => onChange(model)}>
          <span className={styles.optionLabel}>{model}</span><span className={styles.optionCheck}>{model === value && <Check size={16} aria-hidden />}</span>
        </button>)}
      </section>)}
    </div>
  </>;
}
