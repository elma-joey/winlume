"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import Modal, { ModalCloseButton } from "@/components/Modal";
import type { Artifact } from "@/lib/agent/types";
import styles from "./cloud-chat.module.css";

export function CloudImage({ artifact, url }: { artifact: Artifact; url: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={styles.imageButton} aria-label={`查看图片：${artifact.name}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- private same-origin artifact */}
      <img className={styles.artifactImage} src={url} alt={artifact.name} loading="lazy" />
    </button>
    <Modal open={open} onClose={() => setOpen(false)} label="图片预览" size="overlay">
      <div className={`${styles.sheetPanel} ${styles.imagePreview}`}>
        <header className={styles.sheetHeader}>
          <h2>{artifact.name}</h2>
          <div className={styles.imageActions}>
            <a className={styles.primary} href={`${url}?download=1`} download><Download size={16} aria-hidden />保存图片</a>
            <ModalCloseButton onClose={() => setOpen(false)} />
          </div>
        </header>
        <div className={styles.imageStage}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the preview uses original private bytes */}
          <img src={url} alt={artifact.name} />
        </div>
      </div>
    </Modal>
  </>;
}
