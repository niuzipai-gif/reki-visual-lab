import { FormEvent, useState } from "react";

interface InviteGateProps {
  onSubmit: (inviteToken: string) => void;
  error?: string | null;
}

export default function InviteGate({ onSubmit, error }: InviteGateProps) {
  const [value, setValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = value.trim();
    if (!token) {
      setValidationError("请输入邀请 token。");
      return;
    }
    setValidationError(null);
    onSubmit(token);
  }

  return (
    <section className="gate-card" aria-labelledby="invite-title">
      <p className="eyebrow">COS AI 角色写真</p>
      <h1 id="invite-title">进入我的写真工作室</h1>
      <p className="muted">输入邀请 token，开启一张照片的温柔修图。</p>
      <form className="invite-form" onSubmit={handleSubmit}>
        <label htmlFor="invite-token">邀请 token</label>
        <input
          id="invite-token"
          name="invite-token"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="输入邀请 token"
        />
        <button type="submit">开始我的修图</button>
      </form>
      {(validationError || error) && (
        <p className="error-text" role="alert">
          {validationError || error}
        </p>
      )}
    </section>
  );
}
