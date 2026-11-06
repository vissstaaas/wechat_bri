import { EventEmitter } from "events";

/**
 * OmniBridge 实时链路追踪总线 (TraceBus)
 * - 捕获每条消息从多模态入口 -> 核心路由中枢 -> 多端执行宿主的全链路事件
 * - 通过 SSE (/api/stream) 实时广播至前端拓扑图与链路日志
 */
class TraceBusImpl extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.seq = 0;
    this.recent = [];
    this.stats = {
      totalRequests: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 42,
      lastActiveAt: Date.now()
    };
  }

  publish(ev) {
    this.recent.push(ev);
    if (this.recent.length > 200) this.recent.shift();
    this.emit("event", ev);
  }

  start(source = "web", text = "") {
    const traceId = ++this.seq;
    const t0 = Date.now();
    const preview = String(text || "").replace(/\s+/g, " ").slice(0, 80);

    this.stats.totalRequests++;
    this.stats.lastActiveAt = t0;

    const startEv = {
      type: "start",
      traceId,
      source,
      label: preview || "收到新消息",
      at: 0,
      ts: t0
    };
    this.publish(startEv);

    return {
      id: traceId,
      step: (node, label = "", extra = {}) => {
        const at = Date.now() - t0;
        const stepEv = {
          type: "step",
          traceId,
          source,
          node,
          label,
          at,
          ts: Date.now(),
          ...extra
        };
        this.publish(stepEv);
      },
      done: (label = "处理完成", extra = {}) => {
        const at = Date.now() - t0;
        this.stats.totalLatencyMs += at;
        this.stats.avgLatencyMs = Math.round(this.stats.totalLatencyMs / (this.stats.totalRequests || 1));
        const doneEv = {
          type: "done",
          traceId,
          source,
          node: "done",
          label,
          at,
          ts: Date.now(),
          ...extra
        };
        this.publish(doneEv);
      }
    };
  }
}

export const TraceBus = new TraceBusImpl();
