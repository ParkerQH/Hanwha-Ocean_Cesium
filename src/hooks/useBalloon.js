/**
 * 클릭된 기둥 위에 말풍선 UI를 띄우는 경량 훅
 * viewer.postRender에서 위치 갱신
 */
import * as Cesium from "cesium";
import { centroidOfPolygonEntity } from "../core/entityutils.js";

export function createBalloonLayer(viewer) {
    const containerId = 'column-balloon-layer';
    const styleId = 'column-balloon-style';
    const balloons = new Map();
    const scratch = new Cesium.Cartesian2();

    // 스타일 1회 주입
    if (!document.getElementById(styleId)) {
        const css = `
        #${containerId} {
            position:absolute;
            left:0;
            top:0;
            pointer-events:none;
            width:100%;
            height:100%;
            overflow:visible;
        }
        .balloon { 
            position:absolute;
            min-width:180px;
            max-width:320px;
            background:rgba(20,20,20,0.85);
            color:#fff;
            border:1px solid rgba(255,255,255,0.2);
            border-radius:10px;
            padding:8px 10px;
            box-shadow:0 6px 18px rgba(0,0,0,0.25);
            transform:translate(-50%,-110%);
            font:12px/1.4 ui-sans-serif,system-ui;
            pointer-events:auto;
        }
        .balloon h4 {
            margin:0 0 6px;
            font-size:13px;
            font-weight:700;
        }
        .balloon pre {
            margin:0;
            white-space:pre-wrap;
            word-break:break-all;
        }
        `;
        const style = document.createElement('style'); 
        style.id = styleId; 
        style.textContent = css; 
        document.head.appendChild(style);
    }

    // 레이어 1회 생성
    let layer = document.getElementById(containerId);
    if (!layer) { layer = document.createElement('div'); layer.id = containerId; document.body.appendChild(layer); }

    // 한국 시간 변환
    function formatKST(isoLike) {
        if (!isoLike) return "";
        const d = new Date(isoLike);
        if (isNaN(d)) return ""; // 형식 이상 시 빈 문자열

        const parts = new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        })
        .formatToParts(d)
        .reduce((acc, p) => (acc[p.type] = p.value, acc), {});

        return `${parts.year}-${parts.month}-${parts.day}일 ${parts.hour}시${parts.minute}분`;
    }

    // 말풍선 위치 업데이트
    function updateBalloonPosition(id) {
        const rec = balloons.get(id); if (!rec) return;
        const { el, entity } = rec;
        if (!viewer.entities.contains(entity)) { el.remove(); balloons.delete(id); return; }

        const world = centroidOfPolygonEntity(entity, viewer);
        if (!world) { el.style.display = 'none'; return; }

        const win = viewer.scene.cartesianToCanvasCoordinates(world, scratch);
        if (!win || !Number.isFinite(win.x) || !Number.isFinite(win.y)) { el.style.display = 'none'; return; }

        el.style.display = 'block';
        el.style.left = `${win.x}px`;
        el.style.top  = `${win.y}px`;
    }

    function showForHighlight(entity, { highlightedAt, bldg_id, columnId }) {
        const id = entity.id ?? `ent:${Math.random().toString(36).slice(2)}`;
        // 기존 풍선 제거
        const old = balloons.get(id); 
        if (old) { 
            old.el.remove(); balloons.delete(id); 
        }
        const when = formatKST(highlightedAt);

        const el = document.createElement("div");
        el.className = "balloon";
        el.style.pointerEvents = "auto";
        el.innerHTML = `
            <div class="rounded-lg shadow-lg bg-white/95 border px-3 py-2 text-sm">
            <div><b>발생 시각</b> : ${when}</div>
            <div><b>공장</b> : ${bldg_id}</div>
            <div><b>기둥</b> : ${columnId}</div>
            </div>
        `;
        layer.appendChild(el);
        balloons.set(id, { el, entity });
        updateBalloonPosition(id);
    }

    // 강조 기둥 말풍선 제거
    function clearForEntity(entity) {
        const id = entity?.id; if (!id) return;
        const rec = balloons.get(id);
        if (rec) { 
            rec.el.remove(); 
            balloons.delete(id); 
        }
    }

    // 전체 클리어
    // function clearAll() {
    //     for (const { el } of balloons.values()) { 
    //         try { el.remove(); 

    //         } catch {} 
    //     }
    //     balloons.clear();
    // }

    if (!viewer.__balloonPostRenderAttached) {
        viewer.__balloonPostRenderAttached = true;
        viewer.scene.postRender.addEventListener(() => {
            for (const id of balloons.keys()) updateBalloonPosition(id);
        });
    }
    return { showForHighlight, clearForEntity };
}