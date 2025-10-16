import * as Cesium from 'cesium';
import * as turf from '@turf/turf';

// 문제(미해결) 상태 저장소
const problemStore = new Map(); // key -> { status: 'open'|'resolved', entities: Cesium.Entity[], meta }
let columnsVisible = true;      // 전체 기둥 & 강조 가시성 토글

function problemKey(bldg_id, bay, columnId) {
  return `${bldg_id}::${bay ?? ''}::${columnId}`;
}

// 문제가 되는 기둥
export function reportProblem(viewer, { bldg_id, columnId, bay }) {
  const key = problemKey(bldg_id, bay, columnId);
  const rec = problemStore.get(key);
  if (!rec) {
    problemStore.set(key, { status: 'open', entities: [], meta: { bldg_id, bay, columnId } });
  } else {
    rec.status = 'open';
  }
}

// 문제가 되는 기둥이 속한 공장
export function getOpenProblemBuildings() {
  const set = new Set();
  for (const rec of problemStore.values()) {
    if (rec.status === 'open' && rec.meta?.bldg_id) {
      set.add(String(rec.meta.bldg_id));
    }
  }
  return set;
}

// 해당 공장에 open 문제가 남아있는지 여부
function hasOpenProblemsInBuilding(bldgId) {
  const bid = String(bldgId);
  for (const rec of problemStore.values()) {
    if (rec.status === 'open' && String(rec.meta?.bldg_id) === bid) return true;
  }
  return false;
}

// 해당 공장의 전체 기둥 삭제
function removeColumnsByBuilding(viewer, bldgId) {
  const bid = String(bldgId);
  const toRemove = [];
  viewer.entities.values.forEach(e => {
    if (e.layerTag === 'columns') {
      const ebid = e.rawData?.bldg_id ?? e.rawData?.BLDG_ID ?? null;
      if (ebid && String(ebid) === bid) toRemove.push(e);
    }
  });
  toRemove.forEach(e => viewer.entities.remove(e));

  if (typeof columnIndex !== "undefined" && columnIndex?.size) {
    for (const [k, ent] of Array.from(columnIndex.entries())) {
      const ebid = ent?.rawData?.bldg_id ?? ent?.rawData?.BLDG_ID ?? null;
      if (ebid && String(ebid) === bid) columnIndex.delete(k);
    }
  }
}

// 문제 기둥 해결(BAY가 없는 경우 공장ID+기둥ID 기준으로 해결)
export function resolveProblem(viewer, { bldg_id, columnId, bay }) {
  const exactKey = problemKey(bldg_id, bay, columnId);
  const exact = problemStore.get(exactKey);

  let targets = [];
  if (exact && exact.status === 'open') {
    targets = [exact];
  } else {
    const bid = String(bldg_id);
    const cid = String(columnId);
    for (const rec of problemStore.values()) {
      const m = rec.meta || {};
      const recBid = String(m.bldg_id ?? m.bldgId ?? m.building ?? '');
      const recCid = String(m.columnId ?? m.column_id ?? m.id ?? m.pillar_id ?? '');
      if (rec.status === 'open' && recBid === bid && recCid === cid) {
        targets.push(rec);
      }
    }
    if (targets.length === 0) return false;
  }

  // 1) 상태 변경 + rec에 연결된 강조 제거
  for (const rec of targets) {
    rec.status = 'resolved';
    if (Array.isArray(rec.entities) && rec.entities.length) {
      for (const ent of rec.entities) {
        try { viewer.entities.remove(ent); } catch (_) {}
      }
      rec.entities = [];
    }
  }

  // 2) 강조 스윕: 레지스트리 누락/키 불일치 대비 (problemHighlight 직접 탐색 제거)
  const bid = String(bldg_id);
  const cid = (columnId != null) ? String(columnId) : null;
  const by  = bay ? String(bay) : null;

  const sweepRemove = [];
  viewer.entities.values.forEach(e => {
    if (e.layerTag === 'problemHighlight') {
      const rd  = e.rawData || {};
      const eb  = String(rd.bldg_id ?? rd.BLDG_ID ?? '');
      const ec  = String(rd.column_id ?? rd.id ?? rd.pre_id ?? rd.next_id ?? '');
      const eby = String(rd.bay ?? rd.pre_bay ?? rd.next_bay ?? rd.BAY ?? '');
      if (eb === bid && (cid === null || ec === cid) && (!by || eby === by)) {
        sweepRemove.push(e);
      }
    }
  });
  for (const e of sweepRemove) {
    try { viewer.entities.remove(e); } catch (_) {}
  }

  // 3) 공장에 open 이슈 없으면: 회색 기둥 + 남은 빨간 강조까지 전체 정리
  if (!hasOpenProblemsInBuilding(bldg_id)) {
    removeColumnsByBuilding(viewer, bldg_id);
    const leftovers = [];
    viewer.entities.values.forEach(e => {
      if (e.layerTag === 'problemHighlight') {
        const eb = String(e.rawData?.bldg_id ?? e.rawData?.BLDG_ID ?? '');
        if (eb === bid) leftovers.push(e);
      }
    });
    leftovers.forEach(e => {
      try { viewer.entities.remove(e); } catch (_) {}
    });
  }

  if (viewer?.scene?.requestRenderMode) viewer.scene.requestRender();
  return true;
}



export function listOpenProblems() {
  return Array.from(problemStore.values())
    .filter(r => r.status === 'open')
    .map(r => r.meta);
}

export function setColumnsVisibility(viewer, visible) {
  columnsVisible = !!visible;
  // columns / problemHighlight 공통 반영
  viewer.entities.values.forEach(e => {
    if (e.layerTag === 'columns' || e.layerTag === 'problemHighlight') {
      e.show = columnsVisible;
    }
  });
}

// 기둥 인덱스 (강조 -> 기둥 역참조)
const columnIndex = new Map(); // key -> entity

function columnKeyFromProps(p = {}) {
  const b = p.bldg_id ?? p.BLDG_ID ?? "";
  const bay = p.pre_bay ?? p.next_bay ?? p.BAY ?? "";
  const id = p.id ?? p.pre_id ?? p.next_id ?? p.column_id ?? p.COLUMN_ID ?? "";
  if (!b || !id) return null;
  return `${b}::${bay}::${id}`;
}

export function indexColumnEntity(entity) {
  const k = columnKeyFromProps(entity.rawData);
  if (k) columnIndex.set(k, entity);
}

export function lookupColumnRaw(meta = {}) {
  const b = meta.bldg_id ?? meta.BLDG_ID ?? "";
  const bay = meta.bay ?? meta.pre_bay ?? meta.next_bay ?? meta.BAY ?? "";
  const id = meta.column_id ?? meta.id ?? meta.pre_id ?? meta.next_id ?? "";
  const k = (b && id) ? `${b}::${bay}::${id}` : null;
  return (k && columnIndex.get(k)?.rawData) ? columnIndex.get(k).rawData : meta;
}

// 유틸 & 렌더 헬퍼
function toPolygonFeatures(f) {
  if (f.geometry.type === "Polygon") return [turf.polygon(f.geometry.coordinates)];
  if (f.geometry.type === "MultiPolygon") return f.geometry.coordinates.map((coords) => turf.polygon(coords));
  return [];
}

// 기둥 생성
function addExtrudedPolygon(viewer, coords, height, opts = {}) {
  const {
    material = Cesium.Color.GRAY,
    outline = true,
    outlineColor = Cesium.Color.BLACK,
    shadows = Cesium.ShadowMode.DISABLED,
    layerTag = 'columns',
    rawData = null, // 클릭시 보여줄 속성
  } = opts;

  const entity = viewer.entities.add({
    polygon: {
      hierarchy: coords.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
      extrudedHeight: height,
      material,
      outline,
      outlineColor,
      shadows,
    },
  });
  entity.layerTag = layerTag;
  entity.show = columnsVisible;
  if (rawData) entity.rawData = rawData;
  if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
  return entity;
}

//빨간 강조(폴리곤/멀티폴리곤 모든 링) -> 엔티티 배열 반환
function addRedExtruded(viewer, feature, height = 11) {
  const g = feature.geometry;
  const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((c) => c[0]);
  const made = [];
  rings.forEach((ring) => {
    const ent = addExtrudedPolygon(viewer, ring, height, {
      material: Cesium.Color.RED.withAlpha(0.3),
      outline: true,
      outlineColor: Cesium.Color.RED,
      layerTag: 'problemHighlight',
      rawData: feature.properties ?? null,
    });
    made.push(ent);
  });
  return made;
}

//unresolved 문제에 대해 강조 생성 + registry 연결
function renderProblemHighlight(viewer, featureOrRing, { height = 11, rawData = null } = {}) {
  const made = Array.isArray(featureOrRing)
    ? addRedExtruded(
        viewer,
        { geometry: { type: "Polygon", coordinates: [featureOrRing] }, properties: rawData || null },
        height
      )
    : addRedExtruded(viewer, featureOrRing, height);

  const list = Array.isArray(made) ? made : [made];
  list.forEach(ent => { if (ent) ent.show = columnsVisible; });
  return list.filter(Boolean);
}

// 회색 기둥 로딩
export async function loadPolygonColumns(viewer, { pairs = [], bldgIds = [], bays = [] } = {}) {
  let wfsUrl =
    "/geoserver/HanWha_map/ows?service=WFS&version=1.0.0&request=GetFeature" +
    "&typeName=HanWha_map:polygon_data&outputFormat=application/json&srsName=EPSG:4326";

  const filters = [];

  if (pairs.length) {
    const orParts = pairs.map(v => {
      const [bid, bay] = String(v).split("::");
      if (!bid || !bay) return null;
      return `((bldg_id='${bid}') AND (pre_bay='${bay}' OR next_bay='${bay}'))`;
    }).filter(Boolean);
    if (orParts.length) filters.push("(" + orParts.join(" OR ") + ")");
  } else {
    if (bldgIds.length) filters.push("(" + bldgIds.map((id) => `bldg_id='${id}'`).join(" OR ") + ")");
    if (bays.length) {
      const bayList = bays.flatMap((b) => [`pre_bay='${b}'`, `next_bay='${b}'`]);
      filters.push("(" + bayList.join(" OR ") + ")");
    }
  }

  if (filters.length) wfsUrl += "&CQL_FILTER=" + encodeURIComponent(filters.join(" AND "));

  const res = await fetch(wfsUrl);
  const data = await res.json();

  // 회색 기둥 다시 렌더 (rawData 태깅 + 인덱싱)
  data.features.forEach((f) => {
    const { type } = f.geometry;
    const props = f.properties;

    // 키가 이미 있으면 새로 만들지 않음
    const maybeReuse = () => {
      const key = columnKeyFromProps(props);
      if (!key) return null;

      const ent = columnIndex.get(key);
      if (ent && viewer.entities.contains(ent)) {
        ent.show = columnsVisible;
        return ent;
      }
      // 인덱스가 죽은 엔티티를 가리키면 정리
      if (ent && !viewer.entities.contains(ent)) {
        columnIndex.delete(key);
      }
      return null;
    };


    const addPoly = (coords) => {
      // 먼저 재사용 시도
      const reused = maybeReuse();
      if (reused) return reused;

      // 없으면 새로 생성
      const ent = addExtrudedPolygon(viewer, coords, 10, {
        material: Cesium.Color.GRAY,
        outline: true,
        outlineColor: Cesium.Color.BLACK,
        layerTag: 'columns',
        rawData: props,
      });
      indexColumnEntity(ent);
      return ent;
    };

    if (type === "Polygon") addPoly(f.geometry.coordinates[0], 0);
    else if (type === "MultiPolygon") f.geometry.coordinates.forEach((p, i) => addPoly(p[0], i));
  });

  // 이번 조회 범위에 포함된 '미해결' 문제 자동 강조 (이미 있으면 show 동기화)
  data.features.forEach((f) => {
    const props = f.properties || {};
    const colId = props.id ?? props.pre_id ?? props.next_id;   // 실제 스키마에 맞게 조정
    const bay   = props.pre_bay ?? props.next_bay ?? null;
    const bldg  = props.bldg_id ?? null;
    if (!bldg || !colId) return;

    const key = problemKey(bldg, bay, colId);
    const rec = problemStore.get(key);
    if (rec && rec.status === 'open') {
      if (rec.entities.length === 0 && columnsVisible) {
        rec.entities = renderProblemHighlight(viewer, f, { height: 11 });
      } else {
        rec.entities.forEach(e => e.show = columnsVisible);
      }
    }
  });

  // 가시성 일괄 반영
  setColumnsVisibility(viewer, columnsVisible);
}

// 단일 기둥 강조
export async function highlightSingleColumnById(viewer, { bldg_id, columnId }) {
  // 1) 현재 건물 기둥 로드
  if (typeof loadPolygonColumns === 'function') {
    await loadPolygonColumns(viewer, { bldgIds: [String(bldg_id)] });
  }

  // 2) 해당 기둥만 조회 — id 숫자만
  const colId = Number(columnId);
  if (!Number.isFinite(colId)) {
    console.warn('[highlightSingleColumnById] columnId가 숫자가 아닙니다:', columnId);
    return;
  }

  const cql =
    `bldg_id='${String(bldg_id)}' AND id=${colId}`;
  const wfsUrl =
    `/geoserver/HanWha_map/ows?service=WFS&version=1.0.0&request=GetFeature` +
    `&typeName=HanWha_map:polygon_data&outputFormat=application/json&srsName=EPSG:4326` +
    `&CQL_FILTER=${encodeURIComponent(cql)}`;

  const res = await fetch(wfsUrl);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) {
    const text = await res.text();
    console.error('[highlightSingleColumnById] non-JSON:', { ct, text: text.slice(0, 400) });
    return;
  }
  const data = await res.json();
  const f = (data.features || [])[0];
  if (!f) {
    console.warn('문제 발생 기둥을 찾지 못했습니다.', { bldg_id, columnId });
    return;
  }

  // 3) 상태 저장
  const props = f.properties || {};
  reportProblem(viewer, { bldg_id, columnId: colId });

  // 4) 단일 기둥
  const buffered = turf.buffer(f, 1, { units: 'meters' });
  const meta = { bldg_id, column_id: colId };
  renderProblemHighlight(viewer, buffered, { height: 11, rawData: meta });

  if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
}



// 문제 강조(신고) 트리거
export async function highlightMappedColumnsAll(viewer, bldg_id, inputColumnId, inputBay) {
  // 1) 회색 기둥 (현재 건물만)
  await loadPolygonColumns(viewer, { bldgIds: [bldg_id] });

  // 2) 대상 폴리곤 조회
  const wfsUrl = 
  `/geoserver/HanWha_map/ows?service=WFS&version=1.0.0&request=GetFeature` +
  `&typeName=HanWha_map:polygon_data&outputFormat=application/json&srsName=EPSG:4326` + 
  `&CQL_FILTER=${encodeURIComponent(`bldg_id='${bldg_id}'`)}`;
  const res = await fetch(wfsUrl);
  const data = await res.json();

  const isMatched = (props, bay, id) =>
    (props.pre_bay === bay && props.id === id) ||
    (props.next_bay === bay && props.id == id) ||
    (props.pre_bay === bay && props.pre_id == id) ||
    (props.next_bay === bay && props.next_id == id);

  const matched = [];
  for (const f of data.features) {
    if (isMatched(f.properties, inputBay, inputColumnId)) matched.push(f);
    if (matched.length >= 2) break;
  }
  if (!matched.length) {
    console.warn("강조 대상 폴리곤 없음");
    return;
  }

  // 3) 모든 면을 풀어 FeatureCollection 구성
  const polys = matched.flatMap(toPolygonFeatures);
  const fc = turf.featureCollection(polys);

  // 4) 두 폴리곤 중심 방위각으로 회전 좌표계에서 bbox(OBB) 산출
  let angle = 0;
  if (polys.length >= 2) {
    const c1 = turf.centroid(polys[0]);
    const c2 = turf.centroid(polys[1]);
    angle = turf.bearing(c1, c2);
  }
  const pivot = turf.center(fc).geometry.coordinates;

  const rotatedFC = turf.transformRotate(fc, -angle, { pivot });
  const obbAxisAligned = turf.bboxPolygon(turf.bbox(rotatedFC));
  const obb = turf.transformRotate(obbAxisAligned, angle, { pivot });

  // 5) buffer
  const buffered = turf.buffer(obb, 0.5, { units: "meters" });

  // 6) 상태를 open으로 기록
  reportProblem(viewer, { bldg_id, columnId: inputColumnId, bay: inputBay });
  const key = problemKey(bldg_id, inputBay, inputColumnId);
  const rec = problemStore.get(key);
  if (!rec) return;

  // 7) columnsVisible일 때만 즉시 강조 생성 (꺼져 있으면 상태만 유지)
  if (columnsVisible && rec.entities.length === 0) {
    // 강조 rawData는 최소 메타로 구성
    const meta = { bldg_id, bay: inputBay, column_id: inputColumnId };
    rec.entities = renderProblemHighlight(viewer, buffered, { height: 11, rawData: meta });
  }
}
