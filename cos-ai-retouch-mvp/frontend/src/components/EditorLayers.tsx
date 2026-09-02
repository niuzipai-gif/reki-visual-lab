import type { EditorLayer } from "../domain/editor";

interface EditorLayersProps {
  layers: EditorLayer[];
  selectedLayerId: string;
  onSelect: (layerId: string) => void;
  onToggle: (layerId: string) => void;
  onMove: (layerId: string, direction: "up" | "down") => void;
}

export default function EditorLayers({
  layers,
  selectedLayerId,
  onSelect,
  onToggle,
  onMove,
}: EditorLayersProps) {
  return (
    <section className="editor-layers" aria-labelledby="editor-layers-title">
      <div className="editor-section-heading">
        <div>
          <p className="eyebrow">NON-DESTRUCTIVE</p>
          <h2 id="editor-layers-title">图层</h2>
        </div>
        <span className="editor-count">{layers.length}</span>
      </div>
      <div className="editor-layer-list" role="list">
        {[...layers].reverse().map((layer) => (
          <div
            className={`editor-layer-row ${selectedLayerId === layer.id ? "is-selected" : ""}`}
            key={layer.id}
            role="listitem"
          >
            <input
              type="checkbox"
              checked={layer.visible}
              disabled={layer.locked}
              aria-label={`显示图层: ${layer.name}`}
              onChange={() => onToggle(layer.id)}
            />
            <button
              type="button"
              className="editor-layer-select"
              aria-pressed={selectedLayerId === layer.id}
              onClick={() => onSelect(layer.id)}
            >
              <span className={`editor-layer-swatch layer-${layer.kind}`} aria-hidden="true" />
              <span>
                <strong>{layer.name}</strong>
                <small>{layer.locked ? "保护中" : layer.kind === "ai" ? "局部算子" : "可调整"}</small>
              </span>
            </button>
            <div className="editor-layer-actions">
              <button type="button" aria-label={`上移图层: ${layer.name}`} disabled={layer.locked} onClick={() => onMove(layer.id, "up")}>↑</button>
              <button type="button" aria-label={`下移图层: ${layer.name}`} disabled={layer.locked} onClick={() => onMove(layer.id, "down")}>↓</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

