import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { AiScanPanel } from "./AiScanPanel.jsx";

const EMPTY_RESULT = {
  ok: true,
  face: [],
  hands: [],
  pose: [],
};

function successfulResult() {
  return {
    ok: true,
    face: [
      {
        landmarks: [
          { x: 0.2, y: 0.3, index: 33, source: "face", confidence: 1 },
        ],
      },
    ],
    hands: [],
    pose: [],
  };
}

describe("AI scan panel", () => {
  test("exposes real scan controls and disables scanning until a drawable is available", () => {
    render(<AiScanPanel imageSource={null} />);

    expect(screen.getByRole("checkbox", { name: "人脸" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "手部" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "姿态" })).toBeChecked();
    for (const region of [
      "眼睛",
      "面部轮廓",
      "手指",
      "上半身",
      "全身姿态",
    ]) {
      expect(screen.getByRole("checkbox", { name: region })).toBeEnabled();
    }
    expect(screen.getByRole("slider", { name: "关键点密度" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "连接方式" })).toHaveValue(
      "anatomical",
    );
    expect(screen.getByRole("button", { name: "扫描关键点" })).toBeDisabled();
    expect(screen.getByText(/图片加载完成后/)).toBeInTheDocument();
    expect(screen.getByText(/照片不会上传/)).toBeInTheDocument();
  });

  test("scans selected modes with chosen options and prevents a duplicate success", async () => {
    const user = userEvent.setup();
    const scan = vi.fn().mockResolvedValue(successfulResult());
    const toLayers = vi.fn().mockReturnValue([
      { id: "ai-face-0-nodes", type: "nodeCloud", source: "ai" },
    ]);
    const onAddLayers = vi.fn();

    render(
      <AiScanPanel
        imageSource={{ width: 10 }}
        scan={scan}
        toLayers={toLayers}
        onAddLayers={onAddLayers}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "手部" }));
    await user.click(screen.getByRole("checkbox", { name: "姿态" }));
    await user.click(screen.getByRole("checkbox", { name: "眼睛" }));
    fireEvent.change(screen.getByRole("slider", { name: "关键点密度" }), {
      target: { value: "50" },
    });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "连接方式" }),
      "nearest-neighbor",
    );
    await user.click(screen.getByRole("checkbox", { name: "显示标签" }));
    await user.click(screen.getByRole("button", { name: "扫描关键点" }));

    expect(scan).toHaveBeenCalledWith(
      { width: 10 },
      ["face"],
      { signal: expect.any(AbortSignal) },
    );
    expect(toLayers).toHaveBeenCalledWith(successfulResult(), {
      regions: ["eyes"],
      density: 50,
      connectionMode: "nearest-neighbor",
      labels: true,
    });
    expect(onAddLayers).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/已生成 1 个 AI 图层/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "扫描关键点" })).toBeDisabled();
  });

  test("shows loading, empty, failure, retry, and clear-result states", async () => {
    const user = userEvent.setup();
    let resolveScan;
    const scan = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveScan = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ok: false,
        code: "MODEL_LOAD_FAILED",
        message: "模型网络不可用",
      })
      .mockResolvedValueOnce(successfulResult());
    const toLayers = vi
      .fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { id: "ai-face-0-nodes", type: "nodeCloud", source: "ai" },
      ]);
    const onClearResults = vi.fn();

    function Harness() {
      const [hasResults, setHasResults] = useState(false);
      return (
        <AiScanPanel
          imageSource={{ width: 10 }}
          scan={scan}
          toLayers={toLayers}
          hasResults={hasResults}
          onAddLayers={() => setHasResults(true)}
          onClearResults={() => {
            onClearResults();
            setHasResults(false);
          }}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "扫描关键点" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在本机加载");
    expect(screen.getByRole("button", { name: "扫描关键点" })).toBeDisabled();

    resolveScan(EMPTY_RESULT);
    expect(await screen.findByText(/没有识别到关键点/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "扫描关键点" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "模型网络不可用",
    );
    expect(screen.getByText(/手动标注工具仍可使用/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新扫描" }));
    expect(await screen.findByText(/已生成 1 个 AI 图层/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清除 AI 结果" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "清除 AI 结果" }));
    expect(onClearResults).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "清除 AI 结果" })).toBeDisabled();
  });

  test("aborts on unmount and ignores a late successful result", async () => {
    const user = userEvent.setup();
    let resolveScan;
    let scanSignal;
    const scan = vi.fn((_source, _modes, { signal }) => {
      scanSignal = signal;
      return new Promise((resolve) => {
        resolveScan = resolve;
      });
    });
    const onAddLayers = vi.fn();
    const view = render(
      <AiScanPanel
        imageSource={{ width: 10 }}
        scan={scan}
        toLayers={() => [{ id: "late-layer" }]}
        onAddLayers={onAddLayers}
      />,
    );

    await user.click(screen.getByRole("button", { name: "扫描关键点" }));
    view.unmount();
    expect(scanSignal.aborted).toBe(true);

    resolveScan(successfulResult());
    await Promise.resolve();
    expect(onAddLayers).not.toHaveBeenCalled();
  });

  test("lets the user cancel a loading scan and retry successfully", async () => {
    const user = userEvent.setup();
    let firstSignal;
    const scan = vi
      .fn()
      .mockImplementationOnce((_source, _modes, { signal }) => {
        firstSignal = signal;
        return new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                ok: false,
                code: "CANCELLED",
                message: "扫描已取消",
              }),
            { once: true },
          );
        });
      })
      .mockResolvedValueOnce(successfulResult());
    const onAddLayers = vi.fn();

    render(
      <AiScanPanel
        imageSource={{ width: 10 }}
        scan={scan}
        toLayers={() => [{ id: "ai-face-0-nodes", source: "ai" }]}
        onAddLayers={onAddLayers}
      />,
    );

    await user.click(screen.getByRole("button", { name: "扫描关键点" }));
    const cancel = screen.getByRole("button", { name: "取消扫描" });
    expect(cancel).toBeEnabled();
    await user.click(cancel);

    expect(firstSignal.aborted).toBe(true);
    expect(screen.queryByText(/正在本机加载/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "扫描关键点" })).toBeEnabled();
    expect(onAddLayers).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "扫描关键点" }));
    expect(await screen.findByText(/已生成 1 个 AI 图层/)).toBeInTheDocument();
    expect(scan).toHaveBeenCalledTimes(2);
    expect(onAddLayers).toHaveBeenCalledTimes(1);
  });

  test("classifies thrown scan failures and clears the request for retry", async () => {
    const user = userEvent.setup();
    const scan = vi
      .fn()
      .mockRejectedValueOnce(new Error("worker crashed"))
      .mockResolvedValueOnce(successfulResult());

    render(
      <AiScanPanel
        imageSource={{ width: 10 }}
        scan={scan}
        toLayers={() => [{ id: "ai-face-0-nodes", source: "ai" }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "扫描关键点" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("worker crashed");

    await user.click(screen.getByRole("button", { name: "重新扫描" }));
    expect(await screen.findByText(/已生成 1 个 AI 图层/)).toBeInTheDocument();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  test("contains layer-conversion failures without adding partial results", async () => {
    const user = userEvent.setup();
    const onAddLayers = vi.fn();

    render(
      <AiScanPanel
        imageSource={{ width: 10 }}
        scan={vi.fn().mockResolvedValue(successfulResult())}
        toLayers={() => {
          throw new Error("invalid landmark payload");
        }}
        onAddLayers={onAddLayers}
      />,
    );

    await user.click(screen.getByRole("button", { name: "扫描关键点" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "invalid landmark payload",
    );
    expect(onAddLayers).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "重新扫描" })).toBeEnabled();
  });

  test("warns honestly when the fallback runtime cannot interrupt inference", () => {
    render(<AiScanPanel imageSource={{ width: 10 }} interruptible={false} />);

    expect(screen.getByText(/无法中断正在执行的识别/)).toBeInTheDocument();
  });
});
