/**
 * SensorManager
 * 센서 배치/토글, HALO 생성/점멸
 * 센서와 기둥 연결은 pillar_id 기준
 */
import * as Cesium from "cesium";
import { BaseManager } from "../core/BaseManager.js";
import { LAYERS, DEFAULTS } from "../core/constants.js";
import { cartToLonLat, signedAreaLL, edgeMidpointLL, removeEntity } from "../core/entityutils.js";
import { handleError } from "../core/error.js";

export class SensorManager extends BaseManager {
    constructor(deps, columnManager, highlightManager) {
        super(deps);
        this.columnManager = columnManager;
        this.highlightManager = highlightManager;

        this.visible = false;
        this.sensorIds = new Set();     // 센서 엔티티 id(ble:pillar:ble)
        this.haloIds = new Set();       // halo 엔티티 id(halo:ble)
        this._blinkTimers = new Map();  // 점멸 타이머
    }

    // 현재 로드된 회색 기둥들 메타 수집(id -> 링/높이/엔티티)
    _collectColumns() {
        const out = new Map();
        this.viewer.entities.values.forEach(ent => {
            if (ent.layerTag !== LAYERS.COLUMN) return;
            const prop = ent.rawData || {};
            const id = prop.column_id ?? null;
            if (id == null) return;

            const now = this.viewer.clock.currentTime;
            let h = ent?.polygon?.hierarchy; if (typeof h?.getValue === "function") h = h.getValue(now);
            const pos = h?.positions || h || []; if (!pos.length) return;

            const ringLL = pos.map(cartToLonLat);

            let extr = ent?.polygon?.extrudedHeight, height = DEFAULTS.EXTRUDED_HEIGHT;
            if (typeof extr?.getValue === "function") height = Number(extr.getValue(now)) || DEFAULTS.EXTRUDED_HEIGHT;
            else if (typeof extr === "number") height = extr;

            out.set(String(id), { ringLL, height, entity: ent });
        });
        return out;
    }

    // 한 기둥에 센서들 배치
    _placeSensorsFor(columnId, sensors, meta) {
        const { ringLL, height } = meta;
        const zHeight = height / DEFAULTS.SENSOR_N;
        const area = signedAreaLL(ringLL); // 외곽 방향 판정

        for (const sensor of sensors) {
            const mid = edgeMidpointLL(ringLL, sensor.line);
            const midPos = Cesium.Cartesian3.fromDegrees(mid.lon, mid.lat, zHeight);

            // 지역 좌표계(ENU)
            const enu = Cesium.Transforms.eastNorthUpToFixedFrame(midPos);
            const east = Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian3());
            const north = Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian3());
            const up = Cesium.Matrix4.getColumn(enu, 2, new Cesium.Cartesian3());

            // 변 방향 -> 외곽 방향
            const vertexCount = ringLL.length;
            const startIdx = ((sensor.line % vertexCount) + vertexCount) % vertexCount, endIdx = (startIdx + 1) % vertexCount;
            const point1 = Cesium.Cartesian3.fromDegrees(ringLL[startIdx].lon, ringLL[startIdx].lat, zHeight);
            const point2 = Cesium.Cartesian3.fromDegrees(ringLL[endIdx].lon, ringLL[endIdx].lat, zHeight);
            const edge = Cesium.Cartesian3.normalize(
                Cesium.Cartesian3.subtract(point2, point1, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
            let outward = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(edge, up, new Cesium.Cartesian3()), new Cesium.Cartesian3());
            if (area < 0) Cesium.Cartesian3.multiplyByScalar(outward, -1, outward);
            
            const finalPos = Cesium.Cartesian3.add(
                midPos,
                Cesium.Cartesian3.multiplyByScalar(outward, DEFAULTS.SENSOR_OFFSET, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );

            // 센서의 정면(외곽을 보게)
            const eV = Cesium.Cartesian3.dot(outward, east), nV = Cesium.Cartesian3.dot(outward, north);
            const heading = Math.atan2(eV, nV);
            const orientation = Cesium.Transforms.headingPitchRollQuaternion(finalPos, new Cesium.HeadingPitchRoll(heading, 0, 0));

            const id = `ble:${columnId}:${sensor.ble_id}`;
            if (!this.viewer.entities.getById(id)) {
                this.viewer.entities.add({
                    id, position: finalPos, orientation,
                    ellipsoid: { radii: new Cesium.Cartesian3(DEFAULTS.SENSOR_RADIUS, DEFAULTS.SENSOR_RADIUS, DEFAULTS.SENSOR_RADIUS), material: Cesium.Color.WHITE },
                    layerTag: LAYERS.SENSOR,
                    rawData: { ble_id: sensor.ble_id, pillar_id: columnId, line: sensor.line },
                });
                this.sensorIds.add(id);
            }
        }
    }

    // 현재 로드된 회색 기둥 기준으로 센서 모두 표시
    async showForCurrentColumns() {
        try{
            const metaMap = this._collectColumns();
            const pillarIds = [...metaMap.keys()];

            // 재배치 전 기존 센서 즉시 제거
            this.removeSensorsOnly(true);

            const list = await this.fetcher.sensorsByPillars(pillarIds.join(","));
            const grouped = new Map(); // pillarId -> sensors[]
            for (const sensor of list) {
                const k = String(sensor.pillar_id);
                const arr = grouped.get(k) || [];
                arr.push(sensor);
                grouped.set(k, arr);
            }

            if (grouped.size > 0 && pillarIds.length > 0) {
                for (const [pid, sensors] of grouped) {
                    const meta = metaMap.get(pid);
                    if (meta) 
                        this._placeSensorsFor(pid, sensors, meta);
                }
                this.visible = this.sensorIds.size > 0;
                this.requestRender();
                return this.sensorIds.size;
            } else {
                this.visible = false;
                this.requestRender();
                return 0;
            }
        } catch (err) {
            handleError(err, { where: "SensorManager.showForCurrentColumns", userMessage: "센서 조회 중 오류가 발생했습니다." });
            return 0;
        }
    }
    
    // 모든 센서/점멸 제거
    removeSensorsOnly(now=false) { 
        for (const id of [...this.sensorIds]) {
            const ent = this.viewer.entities.getById(id);
            removeEntity(this.viewer, ent)
            this.sensorIds.delete(id);  
        }
    }

    // BLE -> (pillar_id, bldg_id) 추적
    async lookupByBle(bleId) {
        try {
            const bleInfo = await this.fetcher.sensorDetail(bleId);
            if (!bleInfo) return null;
            const pillar_id = bleInfo.pillar_id;
            const bldg_id = await this.fetcher.getBldgIdByPillar(pillar_id);
            return bldg_id ? { pillar_id, bldg_id } : null;
        } catch (err) {
            handleError(err, { where: "SensorManager.lookupByBle", userMessage: "센서 정보 조회 실패" });
            return null;
        }
    }

    // HALO(센서 강조 링) 생성
    addHalo(bleId, r=0.5) {
        const haloId = `halo:${bleId}`;
        this._stopBlink(haloId);
        const old = this.viewer.entities.getById(haloId);
        if (old) this.viewer.entities.remove(old);

        // 해당 BLE 센서 엔티티 찾기
        let sensorEnt = null;
        for (const id of this.sensorIds) if (id.endsWith(`:${bleId}`)) { sensorEnt = this.viewer.entities.getById(id); break; }
        if (!sensorEnt) return null;

        const ent = this.viewer.entities.add({
            id: haloId,
            position: sensorEnt.position,
            orientation: sensorEnt.orientation,
            ellipsoid: { radii: new Cesium.Cartesian3(r,r,r), material: Cesium.Color.fromBytes(255,102,102) },
            show: true,
            layerTag: LAYERS.HALO,
            rawData: { ble_id: bleId },
        });
        this.haloIds.add(haloId);
        this.requestRender();
        return ent;
    }

    // HALO 제거(개별)
    removeHalo(bleId) {
        const haloId = `halo:${bleId}`;
        this._stopBlink(haloId);
        const ent = this.viewer.entities.getById(haloId);
        if (ent) this.viewer.entities.remove(ent);
        this.haloIds.delete(haloId);
        this.requestRender();
    }

    // HALO 깜빡임
    blinkHalo(bleId, { durationMs=5000, intervalMs=400 } = {}) {
        const haloId = `halo:${bleId}`;
        let halo = this.viewer.entities.getById(haloId);
        if (!halo) halo = this.addHalo(bleId, 1.0);
        if (!halo) return;

        this._stopBlink(haloId);
        let visible = true;
        const interval = setInterval(() => { visible = !visible; halo.show = visible; this.requestRender(); }, intervalMs);
        const timeout = setTimeout(() => { clearInterval(interval); this._blinkTimers.delete(haloId); halo.show = true; this.requestRender(); }, durationMs);
        this._blinkTimers.set(haloId, { interval, timeout });
    }

    // 내부: 점멸 타이머 정리
    _stopBlink(haloId) { 
        const timer = this._blinkTimers.get(haloId); 
        if (timer){ 
            clearInterval(timer.interval); 
            clearTimeout(timer.timeout); 
            this._blinkTimers.delete(haloId);
        } 
    }
}
