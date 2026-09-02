export type WorkflowStep = "upload" | "analysis" | "result";

interface WorkflowRailProps {
  currentStep: WorkflowStep;
}

export default function WorkflowRail({ currentStep }: WorkflowRailProps) {
  return (
    <nav className="workflow-rail" aria-label="修图步骤" data-current-step={currentStep}>
      <p className="eyebrow">STUDIO FLOW</p>
      <ol className="step-list">
        <li className={currentStep === "upload" ? "active" : "complete"}>
          <span>01</span>
          上传照片
        </li>
        <li className={currentStep === "analysis" ? "active" : currentStep === "result" ? "complete" : "pending"}>
          <span>02</span>
          选择修图
        </li>
        <li className={currentStep === "result" ? "active" : "pending"}>
          <span>03</span>
          生成预览
        </li>
      </ol>
      <p className="aside-copy">照片会是主角，工具只在需要时出现。</p>
    </nav>
  );
}
