"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FlowConnector } from "@/components/flow-connector";
import { CANVAS_NODE_WIDTH, FLOW_NODE_GAP, layoutFlowNodes } from "@/lib/flow-canvas";
import { flowNodeWidth } from "@/lib/flow-tree";
import type { FlowInput } from "@/lib/flows";
import "./flow-design-preview.css";

/** Fit the editor's actual cards and complete branch trees into a static thumbnail. */
export function FlowDesignPreview({ flow, renderTrigger, renderStep, renderEnd }: {
  flow: FlowInput;
  renderTrigger: () => ReactNode;
  renderStep: (step: FlowInput["steps"][number], index: number) => ReactNode;
  renderEnd: () => ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [measurement, setMeasurement] = useState({ width: 0, heights: {} as Record<string, number> });
  const keys = flow.steps.map((step, index) => step.id || `step-${index}`);
  const layout = layoutFlowNodes(keys, measurement.heights);
  const nodes = [layout.trigger, ...layout.steps, layout.end];
  const width = Math.max(CANVAS_NODE_WIDTH, ...flow.steps.map(step => flowNodeWidth(step)));
  const height = layout.end.y + layout.end.height - layout.trigger.y;
  const zoom = Math.min(.7, Math.max(1, measurement.width - 32) / width, 272 / height);
  const center = layout.trigger.x + CANVAS_NODE_WIDTH / 2;
  const ready = measurement.width > 0 && nodes.every(node => measurement.heights[node.id] > 0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const scene = sceneRef.current;
    if (!viewport || !scene) return;
    const measure = () => {
      const heights: Record<string, number> = {};
      scene.querySelectorAll<HTMLElement>("[data-preview-node]").forEach(node => {
        heights[node.dataset.previewNode!] = node.offsetHeight;
      });
      setMeasurement(current => current.width === viewport.clientWidth && JSON.stringify(current.heights) === JSON.stringify(heights)
        ? current : { width: viewport.clientWidth, heights });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    scene.querySelectorAll("[data-preview-node]").forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [flow.steps, flow.triggerType, flow.triggerConfig]);

  return <div ref={viewportRef} className="flow-design-preview" aria-hidden="true" inert>
    <div ref={sceneRef} className="wf-canvas flow-design-scene" style={{
      "--wf-node-width": `${CANVAS_NODE_WIDTH}px`, "--wf-node-gap": `${FLOW_NODE_GAP}px`,
      visibility: ready ? "visible" : "hidden",
      transform: `translate(${measurement.width / 2 - center * zoom}px, ${152 - (layout.trigger.y + height / 2) * zoom}px) scale(${zoom})`,
    } as CSSProperties}>
      <svg className="flow-design-connections" aria-hidden="true">
        {nodes.slice(1).map((node, index) => <FlowConnector key={node.id}
          from={{ x: nodes[index].x + nodes[index].width / 2, y: nodes[index].y + nodes[index].height }}
          to={{ x: node.x + node.width / 2, y: node.y }} />)}
      </svg>
      <div data-preview-node={layout.trigger.id} className="flow-design-position" style={{ left: layout.trigger.x, top: layout.trigger.y, width: CANVAS_NODE_WIDTH }}>{renderTrigger()}</div>
      {flow.steps.map((step, index) => <div data-preview-node={keys[index]} key={keys[index]} className="flow-design-position" style={{ left: layout.steps[index].x, top: layout.steps[index].y, width: CANVAS_NODE_WIDTH }}>{renderStep(step, index)}</div>)}
      <div data-preview-node={layout.end.id} className="flow-design-position" style={{ left: layout.end.x, top: layout.end.y, width: layout.end.width }}>{renderEnd()}</div>
    </div>
  </div>;
}
