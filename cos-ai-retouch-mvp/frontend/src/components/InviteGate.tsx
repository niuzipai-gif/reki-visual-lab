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
      <p className="eyebrow">COS AI RETOUCH MVP</p>
      <h1 id="invite-title">进入修图工作台</h1>
      <p className="muted">这是一个邀请制的单张原图处理流程。请使用有效邀请 token 开始。</p>
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
        <button type="submit">进入工作台</button>
      </form>
      {(validationError || error) && (
        <p className="error-text" role="alert">
          {validationError || error}
        </p>
      )}
    </section>
  );
}
