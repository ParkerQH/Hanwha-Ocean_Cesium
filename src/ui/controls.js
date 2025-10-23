/**
 * UI 컨트롤 & DOM 이벤트만 담당
 * 비즈니스 로직은 features의 공개 메서드만 호출
 */
import * as Cesium from "cesium";
import { removeEntities } from "../core/entityutils.js";
import { LAYERS } from "../core/constants.js";
import { handleError, normalizeBay } from "../core/error.js";

export function initControls({ viewer, cm, hm, sm, buildings, balloon }) {
    // 드롭다운: 건물/베이
    const buildingSelect = document.getElementById("buildingSelect");
    const baySelect = document.getElementById("baySelect");
    const searchBtn = document.getElementById("searchBtn");
    const resetBtn = document.getElementById("resetBtn");

    // 건물 목록 채우기
    buildings.forEach(b => {
        const opt = document.createElement("option");
        opt.value = b.bldg_id; opt.textContent = b.name;
        buildingSelect.appendChild(opt);
    });

    // 건물 선택 -> 베이 옵션 생성
    buildingSelect.addEventListener("change", () => {
        const selectedBldgIds = Array.from(buildingSelect.options).filter(o => o.selected && o.value).map(o => o.value);
        baySelect.innerHTML = '<option value="" disabled>BAY 선택</option>';
        if (!selectedBldgIds.length) { 
            baySelect.disabled = true; 
            return; 
        }

        const options = [];
        selectedBldgIds.forEach(bid => {
            const b = buildings.find(x => x.bldg_id === bid);
            if (!b?.bays?.length) 
                return;
            b.bays.forEach(bay => {
                options.push({ value: `${bid}::${bay}`, label: `${b.name}_${bay}`, sortKey: `${b.name}_${bay}` });
            }); 
        });
        options.sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ko", { numeric: true }));
        options.forEach(({ value, label }) => {
            const opt = document.createElement("option"); 
            opt.value = value; opt.textContent = label; 
            baySelect.appendChild(opt);
        });
        baySelect.disabled = options.length === 0;
    });

    // 검색 버튼 -> 회색 기둥 로딩
    searchBtn.addEventListener("click", async () => {
        try {
            const pairs = Array.from(baySelect.options).filter(o => o.selected && o.value).map(o => o.value);
            const bldgIds = Array.from(buildingSelect.options).filter(o => o.selected && o.value).map(o => o.value);
            if (pairs.length) 
                await cm.load({ pairs });
            else 
                await cm.load({ bldgIds });
        } catch (err) {
            handleError(err, { where: "controls.search", userMessage: "기둥 로딩 중 오류가 발생했습니다." });
        }
    });

    // 초기화 -> 열린 문제 공장 제외하고 회색/센서 정리
    resetBtn.addEventListener("click", () => {
        try {
            const protect = hm.getOpenBuildings();
            const snapshot = viewer.entities.values.slice();
            const toRemove = [];
            snapshot.forEach(e => {
                if (e.layerTag === LAYERS.COLUMN) {
                    const bid = e.rawData?.bldg_id ?? null;
                    if (!bid || !protect.has(String(bid))) 
                        toRemove.push(e);
                }
            });
            removeEntities(viewer, toRemove);
            sm.removeAll();
            balloon?.clearAll?.();
            const btn = document.getElementById("btnToggleSensors");
            if (btn) 
                btn.textContent = "센서 보기";
        } catch (err) {
            handleError(err, { where: "controls.reset" });
        }
    });

    // 문제 신고/해결 입력
    const inpBldg = document.getElementById("inpBldg");
    const inpColId = document.getElementById("inpColId");
    const inpBay = document.getElementById("inpBay");
    const inpSensorId = document.getElementById("inpSensorId");

    // 강조 엔티티 조회
    function findHighlightEntity(bldg_id, columnId) {
        return viewer.entities.values.find(e =>
            e?.layerTag === "problemHighlight" &&
            String(e.rawData?.bldg_id) === String(bldg_id) &&
            String(e.rawData?.column_id) === String(columnId)
        ) || null;
    }

    // 강조 기둥 말풍선 생성
    function showBalloonForHighlight(bldg_id, columnId) {
        const ent = findHighlightEntity(bldg_id, columnId);
        if (!ent) return;
        const ts = new Date().toISOString();
        // 말풍선: 강조 시각 / 공장 / 기둥
        balloon?.showForHighlight?.(ent, { highlightedAt: ts, bldg_id, columnId });
    }

    // 강조 기둥 말풍선 제거
    function clearBalloonForHighlight(bldg_id, columnId) {
        const ent = findHighlightEntity(bldg_id, columnId);
        if (!ent) return;
        balloon.clearForEntity(ent);
    }

    // 신고(양면 동시 하이라이트)
    document.getElementById("btnReport").addEventListener("click", async () => {
        try {
            const bldg_id = inpBldg.value;
            const columnId = +inpColId.value;
            const bay = normalizeBay(inpBay.value);
            await cm.load({ bldgIds: [bldg_id] });
            await hm.highlightMappedBoth(bldg_id, columnId, bay);
            showBalloonForHighlight(bldg_id, columnId);
        } catch (err) {
            handleError(err, { where: "controls.report", userMessage: "신고 처리 중 오류가 발생했습니다." });
        }
    });

    // 해결(부분/전체)
    document.getElementById("btnResolve").addEventListener("click", () => {
        try {
            const bldg_id = inpBldg.value;
            const columnId = +inpColId.value;
            const bay = normalizeBay(inpBay.value);
            hm.resolve({ bldg_id, columnId, bay });
            clearBalloonForHighlight(bldg_id, columnId);
        } catch (err) {
            handleError(err, { where: "controls.resolve" });
        }
    });

    // 센서 토글
    document.getElementById("btnToggleSensors").addEventListener("click", async (e) => {
        try {
            if (sm.visible) { 
                sm.removeAll(); 
                e.target.textContent = "센서 보기"; 
            }
            else { 
                await sm.showForCurrentColumns(); 
                e.target.textContent = "센서 숨김"; 
            }
        } catch (err) {
            handleError(err, { where: "controls.toggleSensors" });
        }
    });

    // 센서 신고(= BLE 기준 단일 하이라이트 + HALO)
    document.getElementById("btnSensorReport").addEventListener("click", async () => {
         try {
            const v = (inpSensorId?.value || "").trim();
            if (!v) 
                return;
            const bleId = v;

            const found = await sm.lookupByBle(bleId);
            if (!found) 
                return handleError(new Error("not found"), { userMessage: "센서와 기둥/공장 매핑을 찾지 못했습니다." });
            const { pillar_id, bldg_id } = found;

            await cm.load({ bldgIds: [bldg_id] });
            await hm.highlightSingle(bldg_id, pillar_id);
            await sm.showForCurrentColumns();
            document.getElementById("btnToggleSensors").textContent = "센서 숨김";

            hm.report({ bldg_id, columnId: pillar_id });
            cm.setShow(bldg_id, pillar_id, false);

            sm.addHalo(bleId, 1.5);
            sm.blinkHalo(bleId, { durationMs: 5000, intervalMs: 400 });

            showBalloonForHighlight(bldg_id, pillar_id);
        } catch (err) {
            handleError(err, { where: "controls.sensorReport" });
        }
    });

    // 센서 해결(= HALO 제거 + 문제 해제)
    document.getElementById("btnSensorResolve").addEventListener("click", async () => {
        try {
            const v = (inpSensorId?.value || "").trim();
            if (!v) 
                return;
            const bleId = v;
            
            const found = await sm.lookupByBle(bleId);
            if (!found) 
                return handleError(new Error("not found"), { userMessage: "센서와 기둥/공장 매핑을 찾지 못했습니다." });
            const { pillar_id, bldg_id } = found;

            hm.resolve({ bldg_id, columnId: pillar_id });
            sm.removeHalo(bleId);
            if (sm.visible) {
                await sm.showForCurrentColumns();
                document.getElementById("btnToggleSensors").textContent = "센서 숨김";
            }
            clearBalloonForHighlight(bldg_id, pillar_id);
        } catch (err) {
            handleError(err, { where: "controls.sensorResolve" });
        }
    });

    // 클릭: 정보 출력
    const infoBody = document.getElementById("infoBody");
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction(function (movement) {
        // 다중 픽킹(깊이) -> 하이라이트/회색 우선
        try {
            const hits = viewer.scene.drillPick(movement.position, 16);
            const hit = hits.find(h => h.id?.layerTag)?.id ?? (viewer.scene.pick(movement.position)?.id ?? null);
            if (hit) {
                const now = Cesium.JulianDate.now();
                const propsFromCesium = hit._properties?.getValue?.(now);
                const data = hit.rawData ?? hit.properties ?? propsFromCesium ?? {};
                infoBody.textContent = JSON.stringify(data, null, 2);
        }
        } catch (err) {
            handleError(err, { where: "controls.pick" });
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}
