export function App() {
  return (
    <main className="entry-shell">
      <section className="entry-panel" aria-labelledby="reki-title">
        <p className="entry-kicker">视觉标注实验室</p>
        <h1 id="reki-title">REKI</h1>
        <p className="entry-copy">从一张照片开始你的静态视觉实验。</p>
        <button className="upload-button" type="button">
          选择照片
        </button>
        <p className="privacy-note">照片仅在本机处理</p>
      </section>
    </main>
  );
}
