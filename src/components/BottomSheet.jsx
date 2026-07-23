import React from "react";
import { X } from "lucide-react";
import { GlassPanel } from "./GlassPanel.jsx";

export function BottomSheet({
  tab,
  onTabChange,
  onClose,
  inspector,
  layers,
  specialTitle,
  specialContent,
}) {
  if (!tab) return null;
  const selectedTab = tab === "layers" ? "layers" : "style";

  return (
    <GlassPanel className="bottom-sheet" role="dialog" aria-label="移动端编辑面板" aria-modal="false">
      <div className="sheet-handle" aria-hidden="true" />
      <div className="sheet-header">
        {specialTitle ? (
          <h2>{specialTitle}</h2>
        ) : (
          <div role="tablist" aria-label="移动端面板标签">
            <button type="button" role="tab" aria-selected={selectedTab === "style"} onClick={() => onTabChange("style")}>样式</button>
            <button type="button" role="tab" aria-selected={selectedTab === "layers"} onClick={() => onTabChange("layers")}>图层</button>
          </div>
        )}
        <button type="button" className="icon-button" aria-label="关闭面板" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="sheet-body">
        {specialTitle
          ? specialContent
          : selectedTab === "layers"
            ? layers
            : inspector}
      </div>
    </GlassPanel>
  );
}
