/**
 * RailManager (rail_polygon 전용)
 * - bldg_id(+bay) 기준으로 GeoServer rail_polygon을 조회해서
 *   높이 11.0m ~ 11.2m(두께 0.2m)의 검은 레일을 올린다.
 * - 인덱스 재사용, 전역 가시성, 공장/전체 정리만 제공.
 */
import * as Cesium from "cesium";
import { BaseManager } from "../core/BaseManager.js";
import { removeEntities, closestPointOnLineLL, headingBetweenCarto, modelMatrixFromCartoHeadingScale, planarDistanceMeters } from "../core/entityutils.js";
import { LAYERS, DEFAULTS, WFS_TYPES, MODELS } from "../core/constants.js";
import { DataFetcher } from "../service/DataFetcher.js";


export class RailManager extends BaseManager {
  constructor(deps, opts = {}) {
    super(deps);

    // rail_line 전용 fetcher
    this.lfetcher = new DataFetcher({
      wfsBase: deps?.fetcher?.wfsBase,
      srs: deps?.fetcher?.srs,
      typeName: WFS_TYPES.RAIL_LINE || "HanWha_map:rail_line",
    });

    this.visible = true;
    this.index = new Map(); // "bldg::bay::line" -> Entity
    this._lines = new Map(); // "bldg::bay" -> [line1LL, line2LL] (크레인 배치용)
    this._crane = new Map(); // "bldg::bay" -> Model

    this.baseH = Number(DEFAULTS.RAIL_BASE_HEIGHT ?? 11.0); // 높이
    this.thick = Number(DEFAULTS.RAIL_THICKNESS ?? 0.2);    // 두께
    this.widthM = Number(DEFAULTS.RAIL_WIDTH_M ?? 1.0);     // 폭
  }

  // 인덱스 키(중복 방지)
  _key(p = {}) {
    const b = p.bldg_id ?? "";
    const bay = p.bay ?? "";
    const line = (p.line ?? "") + "";
    return (b && bay !== "" && line !== "") ? `${b}::${bay}::${line}` : null;
  }

  // LineString 좌표배열 -> Corridor로 생성/재사용
  _addOrReuseCorridor(lineLL, props) {
    if (!Array.isArray(lineLL) || lineLL.length < 2) return null;

    // props.line이 없는 경우 중복 방지를 위해 임시 라인키 보강
    const p = { ...props };
    if (p.line == null) p.line = `${lineLL[0]?.[0] ?? 0},${lineLL[0]?.[1] ?? 0}::${lineLL.length}`;

    const key = this._key(p);
    if (key) {
      const exist = this.index.get(key);
      if (exist && this.viewer.entities.contains(exist)) {
        exist.show = exist.show && this.visible;
        return exist;
      }
      if (exist && !this.viewer.entities.contains(exist)) this.index.delete(key);
    }

    const positions = lineLL.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
    const ent = this.viewer.entities.add({
      corridor: {
        positions,
        width: this.widthM,
        height: this.baseH,
        extrudedHeight: this.baseH + this.thick,
        material: Cesium.Color.MEDIUMBLUE,
        cornerType: Cesium.CornerType.MITERED,
        shadows: Cesium.ShadowMode.DISABLED,
      },
      show: this.visible,
      layerTag: LAYERS.RAIL,
      rawData: { bldg_id: p.bldg_id },
    });

    if (key) this.index.set(key, ent);
    this.requestRender();
    return ent;
  }

  // 로드: pairs("bldg::bay") 또는 bldgIds
  async load({ pairs = [], bldgIds = [] } = {}) {
    let cql = null;
    if (pairs.length) {
      const items = pairs
        .map(v => {
          const [b, bay] = String(v).split("::");
          return b && bay ? `(bldg_id='${b}' AND bay='${bay}')` : null;
        })
        .filter(Boolean);
      if (!items.length) return 0;
      cql = `(${items.join(" OR ")})`;
    } else if (bldgIds.length) {
      const ids = [...new Set(bldgIds.map(String))];
      cql = `(${ids.map(b => `bldg_id='${b}'`).join(" OR ")})`;
    } else {
      return 0;
    }

    const json = await this.lfetcher.wfsGet({ cql });
    const feats = json?.features ?? [];
    for (const f of feats) {
      const p = f.properties || {};
      const g = f.geometry;
      if (!g) continue;

      const add = (coords) => this._addOrReuseCorridor(coords, p);
      if (g.type === "LineString") add(g.coordinates);
      else if (g.type === "MultiLineString") (g.coordinates || []).forEach(add);
    }
    this.applyVisibility(this.visible);
    return feats.length;
  }

  // rail_line 2개 캐시
  async getLines(bldg_id, bay) {
    const K = `${bldg_id}::${bay}`;
    if (this._lines.has(K)) return this._lines.get(K);
    const cql = `(bldg_id='${bldg_id}' AND bay='${bay}')`;
    const json = await this.lfetcher.wfsGet({ cql });
    const feats = json?.features ?? [];
    const lines = [];
    for (const f of feats) {
      const g = f.geometry;
      if (g?.type === "LineString") lines.push(g.coordinates);
      else if (g?.type === "MultiLineString") lines.push(g.coordinates[0] || []);
    }
    const valid = lines.filter(a => a?.length >= 2);
    if (valid.length >= 2) {
      const pair = [valid[0], valid[1]];
      this._lines.set(K, pair);
      return pair;
    }
    return [];
  }

  // 센서 -> 라인 투영 기반 GLB 배치(모델 1개만)
  async placeCraneOn({ bldg_id, bay, sensorCarto }) {
    const K = `${bldg_id}::${bay}`;
    const lines = this._lines.get(K);
    if (!lines || lines.length < 2 || !sensorCarto) return null;

    // 1) 센서점 -> 각 라인의 수직 투영점
    const pA = closestPointOnLineLL(sensorCarto, lines[0]);
    const pB = closestPointOnLineLL(sensorCarto, lines[1]);

    // 2) 오리진 = 중점(z=상수), 방향=a->b
    const origin = new Cesium.Cartographic(pA.longitude, pA.latitude, DEFAULTS.CRANE_HEIGHT);

    // 3) 방향/스케일
    const heading = Cesium.Math.toRadians(90) - headingBetweenCarto(pA, pB);

    // 4) X축 스케일 = (a-b 거리) / 모델 원본 X 길이
    const dist = Math.max(0, planarDistanceMeters(pA, pB)); // m
    const base = Number(DEFAULTS.CRANE_BASE_SCALE ?? 1);
    const native = Number(DEFAULTS.CRANE_NATIVE_SPAN_M ?? 1);
    const sx = base;
    const sy = base * (native > 0 ? (dist / native) : 1);
    const sz = base;

    const modelMatrix = modelMatrixFromCartoHeadingScale(origin, heading, sx, sy, sz);

    let m = this._crane.get(K);
    if (!m || m.isDestroyed?.()) {
      const created = Cesium.Model.fromGltfAsync
        ? await Cesium.Model.fromGltfAsync({ url: MODELS.OVERHEAD_CRANE_URI, modelMatrix, show: true })
        : Cesium.Model.fromGltf({ url: MODELS.OVERHEAD_CRANE_URI, modelMatrix, show: true });
      this.viewer.scene.primitives.add(created);
      m = created;
      this._crane.set(K, m);
    } else {
      m.modelMatrix = modelMatrix;
      m.show = true;
    }
    this.requestRender();
    return m;
  }

  removeCrane(bldg_id, bay) {
    const K = `${bldg_id}::${bay}`;
    const m = this._crane.get(K);
    if (m && !m.isDestroyed?.()) {
      try { this.viewer.scene.primitives.remove(m); } catch {}
    }
    this._crane.delete(K);
    this.requestRender();
  }

  // 가시성
  applyVisibility(on) {
    this.visible = !!on;
    this.viewer.entities.values.forEach(e => {
      if (e.layerTag === LAYERS.RAIL) e.show = e.show && this.visible;
    });
    this.requestRender();
  }

  // 공장 단위 제거
  removeByBuilding(bldg_id) {
    const toRemove = [];
    this.viewer.entities.values.forEach(e => {
      if (e.layerTag !== LAYERS.RAIL) return;
      if (String(e?.rawData?.bldg_id) === String(bldg_id)) toRemove.push(e);
    });
    removeEntities(this.viewer, toRemove);

    for (const [k, ent] of Array.from(this.index.entries())) {
      if (String(ent?.rawData?.bldg_id) === String(bldg_id)) this.index.delete(k);
    }
    // 라인/모델 캐시도 정리
    for (const key of Array.from(this._lines.keys()))
      if (key.startsWith(`${bldg_id}::`)) this._lines.delete(key);
    for (const key of Array.from(this._crane.keys())) {
      if (key.startsWith(`${bldg_id}::`)) this.removeCrane(bldg_id, key.split("::")[1]);
    }
  }

  // 전체 제거
  removeAll() {
    const rm = [];
    this.viewer.entities.values.forEach(e => { if (e.layerTag === LAYERS.RAIL) rm.push(e); });
    removeEntities(this.viewer, rm);
    this.index.clear();
    this._lines.clear();
    for (const [key, m] of this._crane) try { this.viewer.scene.primitives.remove(m); } catch {}
    this._crane.clear();
  }

  // pair 키로 기존 디버그 포인트 제거
  _removeDebugPointsByKey(K) {
    const arr = this._dbgPts.get(K);
    if (!arr) return;
    for (const e of arr) {
      try { this.viewer.entities.remove(e); } catch {}
    }
    this._dbgPts.delete(K);
  }
}

