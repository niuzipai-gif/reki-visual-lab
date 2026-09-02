import type { WorkflowStep } from "./WorkflowRail";

const STEP_LABELS: Record<WorkflowStep, string> = {
  upload: "上传照片",
  analysis: "选择修图",
  result: "生成预览",
};

interface StudioHeaderProps {
  currentStep: WorkflowStep;
}

export default function StudioHeader({ currentStep }: StudioHeaderProps) {
  return (
    <header className="app-header studio-header">
      <div className="studio-brand-block">
        <p className="studio-category">COS AI 角色写真</p>
        <p className="studio-wordmark">AURA STUDIO</p>
        <p className="studio-subtitle">
          <span>角色写真后期工作室</span>
          <span aria-hidden="true"> · 局部精修，不换脸</span>
        </p>
        <h1>把喜欢的角色，好好留在照片里</h1>
        <p className="studio-hero-copy">
          AI 先找出脸部、假发、服装、身形、背景和光影里的小问题，再交给你决定怎么改。
        </p>
      </div>
      <div className="studio-header-meta">
        <span className="studio-current-step">现在 · {STEP_LABELS[currentStep]}</span>
        <span className="privacy-note">你的照片只用于本次修图</span>
      </div>
    </header>
  );
}
