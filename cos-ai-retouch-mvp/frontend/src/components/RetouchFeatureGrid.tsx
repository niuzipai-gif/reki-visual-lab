const RETOUCH_FEATURES = [
  {
    number: "01",
    key: "face",
    label: "脸部与妆容",
    description: "淡化痘印、肤色不匀和小瑕疵，保留你的脸和角色妆面。",
    tag: "保留身份",
  },
  {
    number: "02",
    key: "hair",
    label: "假发与发丝",
    description: "清理毛躁、穿帮边缘和断裂发丝，不把发型改成另一个人。",
    tag: "细节修复",
  },
  {
    number: "03",
    key: "clothing",
    label: "服装与配件",
    description: "整理褶皱、线头和材质小瑕疵，保留你做好的服装设计。",
    tag: "保留设计",
  },
  {
    number: "04",
    key: "body",
    label: "身形与姿态",
    description: "只处理局部比例和肢体连接，不改变原来的姿势与构图。",
    tag: "局部调整",
  },
  {
    number: "05",
    key: "background",
    label: "背景与杂物",
    description: "清掉路人、杂物和小穿帮，保持背景的透视与空间关系。",
    tag: "画面清理",
  },
  {
    number: "06",
    key: "lighting",
    label: "光影与质感",
    description: "统一补光、色温和胶片质感，让人物和场景更像同一张照片。",
    tag: "氛围统一",
  },
] as const;

export default function RetouchFeatureGrid() {
  return (
    <section className="retouch-explainer" aria-labelledby="retouch-explainer-title">
      <div className="retouch-explainer-heading">
        <div>
          <p className="eyebrow">AI RETOUCH MENU</p>
          <h3 id="retouch-explainer-title">AI 会帮你检查什么？</h3>
          <p>从 6 个 COS 后期方向找出可以变好的细节，你可以逐项确认。</p>
        </div>
        <span className="retouch-feature-count">6 个修图方向</span>
      </div>

      <div className="retouch-feature-grid">
        {RETOUCH_FEATURES.map((feature) => (
          <article className={`retouch-feature-card retouch-feature-${feature.key}`} key={feature.key}>
            <div className="retouch-feature-topline">
              <span className="retouch-feature-number">{feature.number}</span>
              <span className="retouch-feature-tag">{feature.tag}</span>
            </div>
            <h4>{feature.label}</h4>
            <p>{feature.description}</p>
          </article>
        ))}
      </div>

      <div className="retouch-boundary" role="note">
        <span className="retouch-boundary-mark" aria-hidden="true">✦</span>
        <strong>不是换脸，也不是整张图重画。</strong>
        <span>先给方案，再由你决定要不要生成。</span>
      </div>
    </section>
  );
}
