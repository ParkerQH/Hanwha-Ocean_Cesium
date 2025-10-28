/**
 * 엔트리 포인트
 * Cesium 뷰어 생성
 * 서비스/상태/피처 매니저 구성
 * UI 컨트롤 초기화
 */
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import buildings from "./service/buildings.json";
import { DataFetcher } from "./service/DataFetcher.js";
import { ColumnManager } from "./features/polygon.js";
import { HighlightManager } from "./features/highlight.js";
import { SensorManager } from "./features/sensor.js";
import { ProblemStore } from "./state/problemStore.js";
import { initControls } from "./ui/controls.js";
import { createBalloonLayer } from "./hooks/useBalloon.js";
import { RailManager } from "./features/rail.js"

// Cesium token
function getCesiumToken() {
    try {
        if (typeof import.meta !== "undefined" && import.meta?.env?.VITE_CESIUM_TOKEN) {
            return import.meta.env.VITE_CESIUM_TOKEN;
        }
    } catch (_) {}
    return window.CESIUM_TOKEN || "";
}
Cesium.Ion.defaultAccessToken = getCesiumToken();

// Cesium Viewer
const viewer = new Cesium.Viewer("cesiumContainer", {
    geocoder: false,              // 검색창
    homeButton: false,            // 집 모양 버튼
    sceneModePicker: false,       // 2D/3D 모든 변환
    baseLayerPicker: false,       // 베이스 맴 선택
    navigationHelpButton: false,  // 도움말 버튼
    timeline: false,              // 하단 타임라인 버튼
    animation: false,             // 애니메이션 컨롤러
    fullscreenButton: false,      // 전체 화면
    infoBox: false,               // 픽셀 정보 박스 제거
    selectionIndicator: false,    // 클릭 테두리 제거
});
viewer.scene.globe.depthTestAgainstTerrain = false; // 지형 깊이 테스트 비활성
viewer.scene.pickTranslucentDepth = true;           // 반투명 픽킹 안정화
viewer.scene.requestRenderMode = true;              // 수동 렌더(성능)

// 초기 카메라
viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(128.6999, 34.8645, 250.0), // 위치(3공장 기준)
    orientation: {
        heading: Cesium.Math.toRadians(38),     // 시계방향, 0 = 북
        pitch: Cesium.Math.toRadians(-35.0),    // 위/아래 각도, 0 = 수평, -90
        roll: 0,
    },
});

// 필요하면 베이스맵 지우고 WMS 추가
const baseWms = new Cesium.WebMapServiceImageryProvider({
    url: "/geoserver/HanWha_map/wms",
    layers: "HanWha_map:ortho_v1",
    parameters: { service:"WMS", version:"1.1.1", request:"GetMap", format:"image/png", transparent:true },
});
viewer.imageryLayers.addImageryProvider(baseWms);


// 서비스/상태/매니저들 생성(의존성 주입)
const fetcher = new DataFetcher();
const store = new ProblemStore();
const cm = new ColumnManager({ viewer, fetcher });
const hm = new HighlightManager({ viewer, fetcher }, cm, store);
const sm = new SensorManager({ viewer, fetcher }, cm, hm);
const rm = new RailManager({ viewer, fetcher });

// 말풍선 레이어 + UI 이벤트 바인딩
const balloon = createBalloonLayer(viewer);
initControls({ viewer, cm, hm, sm, rm, buildings, balloon });

// 콘솔 테스트용 헬퍼
window.highlightMappedColumnsAll = (b, id, bay) => hm.highlightMappedBoth(b, id, bay);
window.highlightSingleColumnById = (b, id) => hm.highlightSingle(b, id);
window.resolveProblem = (b, id, bay) => hm.resolve({ bldg_id:b, columnId:id, bay });
window.listOpenProblems = () => hm.listOpen();
window.getOpenBuildings = () => hm.getOpenBuildings();
