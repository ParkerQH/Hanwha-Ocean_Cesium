/**
 * 클릭된 기둥 위에 말풍선 UI를 띄우는 경량 훅
 * viewer.postRender에서 위치 갱신
 */
import * as Cesium from "cesium";
import { API } from "../core/constants.js";

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
            width:250px;
            background:rgba(20, 20, 20, 0.42);
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

    // 날짜 시간 정보 포맷터
    function formatDate(date, choose) {
        const formatdate = new Date(date);
        if (isNaN(formatdate))
            return "";
            
        const parts = new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            year: "numeric", 
            month: "2-digit", 
            day: "2-digit",
            hour: "2-digit", 
            minute: "2-digit", 
            second: "2-digit", 
            hour12: false
        }).formatToParts(formatdate).reduce((acc, p)=>(acc[p.type]=p.value,acc),{});

        if (choose == "db")
            return `${parts.year}.${parts.month}.${parts.day}.${parts.hour}.${parts.minute}.${parts.second}`;
        else if (choose == "ui")
            return `${parts.year}-${parts.month}-${parts.day}일 ${parts.hour}시${parts.minute}분`;
    }

    // 말풍선 위치 업데이트
    function updateBalloonPosition(id) {
        const rec = balloons.get(id); 
        if (!rec) return;
        const { el, midPoint } = rec;
        let world = null;
        if (midPoint) {
            // Cartographic -> Cartesian3
            if (midPoint.longitude !== undefined) {
                world = Cesium.Cartesian3.fromRadians(
                midPoint.longitude, midPoint.latitude, midPoint.height || 0
                );
            } else if (midPoint instanceof Cesium.Cartesian3) {
                world = midPoint;
            }
        }
        if (!world) { el.style.display = 'none'; return; }

        const win = viewer.scene.cartesianToCanvasCoordinates(world, scratch);
        if (!win || !Number.isFinite(win.x) || !Number.isFinite(win.y)) { el.style.display = 'none'; return; }

        el.style.display = 'block';
        el.style.left = `${win.x}px`;
        el.style.top  = `${win.y}px`;
    }

    function showForHighlight(midPoint, { highlightedAt, bldg_id, bay, bleId }) {
        const id = `${bleId}`;
        // 기존 풍선 제거
        const old = balloons.get(id); 
        if (old) { 
            old.el.remove(); balloons.delete(id); 
        }
        const when = formatDate(highlightedAt, "ui");

        const el = document.createElement("div");
        el.className = "balloon";
        el.style.pointerEvents = "auto";
        el.innerHTML = `
        <div class="rounded-lg shadow-lg bg-white/95 border px-3 py-2 text-sm">
            <div><b>발생 시각</b> : <span data-role="when"></span></div>
            <div><b>공장</b> : <span data-role="bldg"></span> (<span data-role="bay"></span>)</div>
            <div><b>센서</b> : <span data-role="ble"></span></div>
            <div><b>탑승자</b> : <span data-role="driver"></span> <span data-role="driverPhone" class="text-gray-500"></span></div>
            <div><b>관리자</b> : <span data-role="manager"></span> <span data-role="managerPhone" class="text-gray-500"></span></div>
            <div class="mt-2 flex items-center gap-2">
                <input data-role="inpCause" type="text" placeholder="해제 사유 기입" style="width:150px">
                <button data-role="btnCauseReport">제출</button>
                <button data-role="btnBalloonResolve">해제</button>
            </div>
        </div>`;
        layer.appendChild(el);
        balloons.set(id, { el, midPoint });

        el.querySelector('[data-role="when"]').textContent = when || "";
        el.querySelector('[data-role="bldg"]').textContent = bldg_id ?? "";
        el.querySelector('[data-role="bay"]').textContent  = bay ?? "";
        el.querySelector('[data-role="ble"]').textContent  = bleId ?? "";
        
        // 워커 정보 비동기 로드
        let _worker = null; // 제출 시 
        (async () => {
            try {
                const res = await fetch(API.WORKER_INFO(bldg_id));
                if (!res.ok) 
                    throw new Error(`worker ${res.status}`);
                const worker = await res.json(); _worker = worker;

                el.querySelector('[data-role="bldg"]').textContent = `${worker.name ?? ""}`;
                el.querySelector('[data-role="driver"]').textContent = `${worker.driver ?? ""}${worker.driverId ? ` (${worker.driverId})` : ""}`;
                el.querySelector('[data-role="driverPhone"]').textContent = worker.driverPhone ? ` ${worker.driverPhone}` : "";
                el.querySelector('[data-role="manager"]').textContent = `${worker.manager ?? ""}${worker.managerId ? ` (${worker.managerId})` : ""}`;
                el.querySelector('[data-role="managerPhone"]').textContent= worker.managerPhone ? ` ${worker.managerPhone}` : "";
            } catch (e) {
                console.warn("[Balloon] worker info fetch failed:", e);
            }
        })();


        // ------------------------------------------------------------------------------------------------------------------//
        // 제출 버튼 핸들러(DB 연결부)
        const btn = el.querySelector('[data-role="btnCauseReport"]');
        const inp = el.querySelector('[data-role="inpCause"]');
        btn.disabled = true;
        inp.disabled = true;
        btn?.addEventListener('click', async () => {
            const cause = (inp?.value || "").trim();
            if (!cause) { 
                alert("해제 사유를 입력하세요."); 
                return; 
            }

            // KST 규격 문자열 만들기
            const dateStr = formatDate(highlightedAt, "db"); // 문제 발생 시각
            const nowStr = formatDate(Date.now(), "db");    // 제출 시각
 
            // 워커 정보가 없을 수도 있으니 널가드
            const managerId = _worker?.managerId ?? "";
            const workerId  = _worker?.driverId ?? "";

            try {
                const res = await fetch(API.CHECK_LOG_CREATE, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                    date: dateStr,
                    manager_id: managerId,
                    worker_id: workerId,
                    bldg_id: bldg_id ?? "",
                    ble_id: bleId ?? "",
                    check_content: cause,
                    check_time: nowStr
                    })
                });
                if (!res.ok && res.status !== 204) throw new Error(`save ${res.status}`);
                // UX: 성공 처리
                btn.disabled = true; 
                if (inp) 
                    inp.disabled = true;
                btn.textContent = "제출 완료";

            } catch (err) {
                console.error("[Balloon] check_log save failed:", err);
                alert("제출 중 오류가 발생했습니다.");
            }
        });
        // ------------------------------------------------------------------------------------------------------------------//
        
        updateBalloonPosition(id);
    }

    // 강조 기둥 말풍선 제거
    function clearForEntity(bleId) {
        const id = `${bleId}`; 
        if (!id) return;
        const rec = balloons.get(id);
        if (rec) { 
            rec.el.remove();
            balloons.delete(id); 
        }
    }

    if (!viewer.__balloonPostRenderAttached) {
        viewer.__balloonPostRenderAttached = true;
        viewer.scene.postRender.addEventListener(() => {
            for (const id of balloons.keys()) updateBalloonPosition(id);
        });
    }
    return { showForHighlight, clearForEntity };
}