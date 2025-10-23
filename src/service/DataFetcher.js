// 외부 데이터 접근(WFS/REST) 전용 레이어
import { WFS, API } from "../core/constants.js";
import { handleError } from "../core/error.js";

export class DataFetcher {
    constructor({ wfsBase=WFS.BASE, typeName=WFS.TYPENAME, srs=WFS.SRS } = {}) {
        this.wfsBase = wfsBase;
        this.typeName = typeName;
        this.srs = srs;
        this._cache = new Map(); // URL -> JSON
    }

    // 공통 JSON fetch(+메모리 캐시)
    async _fetchJson(url) {
        try {
            if (this._cache.has(url)) 
                return this._cache.get(url);
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) 
                throw new Error(`Fetch failed: ${res.status}`);
            const json = await res.json();
            this._cache.set(url, json);
            return json;
        } catch (err) {
            handleError(err, { where: "DataFetcher._fetchJson" });
            throw err;
        }
    }

    // WFS GetFeature
    async wfsGet({ cql="" } = {}) {
        const url =
        `${this.wfsBase}?service=WFS&version=1.0.0&request=GetFeature` +
        `&typeName=${encodeURIComponent(this.typeName)}` +
        `&outputFormat=application/json&srsName=${encodeURIComponent(this.srs)}` +
        (cql ? `&CQL_FILTER=${encodeURIComponent(cql)}` : "");
        return this._fetchJson(url);
  }

    // 회색 기둥 조회(페어/공장/BAY 조건)
    async fetchColumns({ pairs=[], bldgIds=[], bays=[] } = {}) {
        const filters = [];
        if (pairs.length) {
        const orParts = pairs.map(v => {
            const [bid, bay] = String(v).split("::");
            return (bid && bay)
            ? `((bldg_id='${bid}') AND (pre_bay='${bay}' OR next_bay='${bay}'))`
            : null;
        }).filter(Boolean);
        if (orParts.length) filters.push("(" + orParts.join(" OR ") + ")");
        } else {
        if (bldgIds.length) filters.push("(" + bldgIds.map(id => `bldg_id='${id}'`).join(" OR ") + ")");
        if (bays.length) {
            const bayList = bays.flatMap(b => [`pre_bay='${b}'`,`next_bay='${b}'`]);
            filters.push("(" + bayList.join(" OR ") + ")");
        }
        }
        const cql = filters.join(" AND ");
        const json = await this.wfsGet({ cql });
        return json?.features ?? [];
    }

    // (bldg, id) 단일 기둥 조회
    async getColumnById(bldg_id, columnId) {
        const json = await this.wfsGet({ cql: `bldg_id='${bldg_id}' AND id=${Number(columnId)}` });
        return (json.features || [])[0] || null;
    }

    // pillar id -> bldg 역조회
    async getBldgIdByPillar(pillarId) {
        const json = await this.wfsGet({ cql: `id=${Number(pillarId)}` });
        return json?.features?.[0]?.properties?.bldg_id ?? null;
    }

    // API: 여러 기둥의 센서들
    async sensorsByPillars(csv) {
        try { return await this._fetchJson(API.SENSORS_BY_PILLARS(csv)); }
        catch { return []; }
    }

    // API: 단일 센서 상세
    async sensorDetail(bleId) {
        try { return await this._fetchJson(API.SENSOR_DETAIL(bleId)); }
        catch { return null; }
    }
}
