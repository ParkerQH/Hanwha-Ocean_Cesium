/**
 * UI 컨트롤 & DOM 이벤트만 담당
 * 비즈니스 로직은 features의 공개 메서드만 호출
 */
import * as Cesium from "cesium";
import { handleError, normalizeBay } from "../core/error.js";

export function initControls({ viewer, cm, hm, sm, rm, balloon }) {
    // 문제 신고/해결 입력
    const inpSensorId = document.getElementById("inpSensorId");
    const inpSensorBay = document.getElementById("inpSensorBay");

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

    // 센서 신고(= BLE 기준 단일 하이라이트 + HALO)
    document.getElementById("btnSensorReport").addEventListener("click", async () => {
         try {
            const v = (inpSensorId?.value || "").trim();
            if (!v) 
                return;
            const bleId = v;

            const bay = normalizeBay?.(inpSensorBay?.value || "") || "";

            const found = await sm.lookupByBle(bleId);
            if (!found) 
                return handleError(new Error("not found"), { userMessage: "센서와 기둥/공장 매핑을 찾지 못했습니다." });
            const { pillar_id, bldg_id } = found;

            await cm.load({ bldgIds: [bldg_id] });
            await hm.highlightSingle(bldg_id, pillar_id);
            await sm.showForCurrentColumns();

            hm.report({ bldg_id, columnId: pillar_id });
            cm.setShow(bldg_id, pillar_id, false);

            sm.addHalo(bleId, 1.0);
            sm.blinkHalo(bleId, { durationMs: 5000, intervalMs: 400 });

            showBalloonForHighlight(bldg_id, pillar_id);

            // const pair = `${bldg_id}::${bay}`;
            await rm.load({ bldgIds: [bldg_id] });      // 레일 폴리곤
            await rm.getLines(bldg_id, bay);       // 라인 캐시

            // 센서 지상좌표(halo 생성 이후 바로 얻음)
            const now = viewer.clock.currentTime;
            const halo = viewer.entities.getById(`halo:${bleId}`);
            const pos = halo?.position?.getValue ? halo.position.getValue(now) : halo?.position;
            if (pos) {
                const carto = Cesium.Cartographic.fromCartesian(pos); carto.height = 0;
                await rm.placeCraneOn({ bldg_id, bay, sensorCarto: carto });
            }
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
            
            const bay = normalizeBay?.(inpSensorBay?.value || "") || "";

            const found = await sm.lookupByBle(bleId);
            if (!found) 
                return handleError(new Error("not found"), { userMessage: "센서와 기둥/공장 매핑을 찾지 못했습니다." });
            const { pillar_id, bldg_id } = found;

            hm.resolve({ bldg_id, columnId: pillar_id });
            sm.removeHalo(bleId);
            sm.showForCurrentColumns();

            if (bay) rm.removeCrane(bldg_id, bay);

            clearBalloonForHighlight(bldg_id, pillar_id);

            // 해당 공장에 열린 문제가 더 없으면 레일까지 제거
            const opens = hm.getOpenBuildings();
            if (!opens.has(String(bldg_id))) rm.removeByBuilding(bldg_id);
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
