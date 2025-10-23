// 문제 상태 저장소("bldg::id")
import { removeEntity } from "../core/entityutils.js";
import { normalizeBay } from "../core/error.js";

export class ProblemStore {
    constructor() { this.map = new Map(); }
    _key(bldg_id, columnId) { return `${bldg_id}::${columnId}`; }

    // 문제 오픈 기둥만 반환
    openRecords() {
        return [...this.map.values()].filter(r => r.status === "open");
    }

    // 문제 오픈(없으면 생성, 있으면 status만 open으로)
    open(bldg_id, columnId) {
        const k = this._key(bldg_id, columnId);
        const r = this.map.get(k);
        if (!r) this.map.set(k, { status: "open", entities: [], meta: { bldg_id, columnId } });
        else r.status = "open";
    }

    // 문제 해결
    resolve({ viewer, bldg_id, columnId, bay=null, onEmpty }) {
        const k = this._key(bldg_id, columnId);
        const r = this.map.get(k);
        if (!r || r.status !== "open") return false;

        const targetBay = normalizeBay(bay);
        const remain = [];
        const removedMeta = []; // 제거되는 강조

        for (const e of r.entities || []) {
            const eb = e?.rawData?.bay ?? e?.rawData?.BAY ?? null;
            if (targetBay && eb !== targetBay) { 
                remain.push(e); 
                continue; 
            }
            if (e?.rawData) 
                removedMeta.push(e.rawData);
            removeEntity(viewer, e);
        }
        r.entities = remain;

        if (!r.entities.length) {
            r.status = "resolved";
            if (typeof onEmpty === "function") onEmpty({ removedMeta });
        }
        return true;
    }

    // 강조 엔티티를 문제 레코드에 추가
    addEntities(bldg_id, columnId, ents=[]) {
        const r = this.map.get(this._key(bldg_id, columnId));
        if (r) r.entities = (r.entities || []).concat(ents);
    }

    // 열려있는 문제 목록/건물 집합
    listOpen() { return [...this.map.values()].filter(r => r.status === "open").map(r => r.meta); }
    openBuildings() {
        const s = new Set();
        for (const r of this.map.values()) if (r.status === "open" && r.meta?.bldg_id) s.add(String(r.meta.bldg_id));
        return s;
    }
}
