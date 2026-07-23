import React from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Trash2,
  Unlock,
} from "lucide-react";

function LayerButton({ label, onClick, disabled, children }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function LayersPanel({ layers, selectedLayerId, onSelect, onAction }) {
  return (
    <div className="layers-panel-content">
      <header><div><small>OBJECT STACK</small><h2>图层</h2></div><span>{layers.length}</span></header>
      {layers.length ? (
        <ol className="layer-list">
          {layers.map((layer, index) => (
            <li key={layer.id} className={selectedLayerId === layer.id ? "selected" : ""}>
              <button type="button" className="layer-select" aria-label={`选择图层 ${layer.name}`} aria-pressed={selectedLayerId === layer.id} onClick={() => onSelect(layer.id)}>
                <span className="layer-type">{layer.type.slice(0, 2).toUpperCase()}</span>
                <span><b>{layer.name}</b><small>{layer.type}</small></span>
              </button>
              <div className="layer-actions">
                <LayerButton label={`${layer.visible ? "隐藏" : "显示"} ${layer.name}`} onClick={() => onAction("toggle", layer, index)}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</LayerButton>
                <LayerButton label={`${layer.locked ? "解锁" : "锁定"} ${layer.name}`} onClick={() => onAction("lock", layer, index)}>{layer.locked ? <Lock size={14} /> : <Unlock size={14} />}</LayerButton>
                <LayerButton label={`复制 ${layer.name}`} onClick={() => onAction("duplicate", layer, index)}><Copy size={14} /></LayerButton>
                <LayerButton label={`置顶 ${layer.name}`} onClick={() => onAction("top", layer, index)} disabled={index === layers.length - 1}><ChevronsUp size={14} /></LayerButton>
                <LayerButton label={`上移 ${layer.name}`} onClick={() => onAction("up", layer, index)} disabled={index === layers.length - 1}><ChevronUp size={14} /></LayerButton>
                <LayerButton label={`下移 ${layer.name}`} onClick={() => onAction("down", layer, index)} disabled={index === 0}><ChevronDown size={14} /></LayerButton>
                <LayerButton label={`置底 ${layer.name}`} onClick={() => onAction("bottom", layer, index)} disabled={index === 0}><ChevronsDown size={14} /></LayerButton>
                <LayerButton label={`删除 ${layer.name}`} onClick={() => onAction("remove", layer, index)}><Trash2 size={14} /></LayerButton>
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="empty-copy">暂无标注图层</p>}
    </div>
  );
}
