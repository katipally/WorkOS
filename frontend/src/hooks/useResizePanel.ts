/**
 * useResizePanel — encapsulates the drag-resize logic for the AI panel width.
 */
import { useCallback } from "react";
import { useAppStore } from "@/store/useAppStore";

const MIN_WIDTH = 320;
const MAX_WIDTH = 800;

export function useResizePanel() {
    const { aiPanelWidth, setAIPanelWidth } = useAppStore();

    const handleResizeStart = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = aiPanelWidth;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";

            const onMouseMove = (ev: MouseEvent) => {
                const delta = startX - ev.clientX;
                setAIPanelWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta)));
            };
            const onMouseUp = () => {
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
            };
            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        },
        [aiPanelWidth, setAIPanelWidth],
    );

    return { aiPanelWidth, handleResizeStart };
}
