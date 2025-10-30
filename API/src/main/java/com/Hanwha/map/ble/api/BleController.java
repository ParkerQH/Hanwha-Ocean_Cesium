package com.Hanwha.map.ble.api;

import com.Hanwha.map.ble.service.BleService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/ble")
public class BleController {

    private final BleService service;

    public BleController(BleService service) {
        this.service = service;
    }

    // /api/ble/by_pillars?pillar_ids=4,8...
    @GetMapping("/by_pillars")
    public List<BleDto> byPillars(@RequestParam("pillar_ids") String pillarIdsCsv) {
        return service.findByPillars(pillarIdsCsv);
    }

    // /api/ble/detail?ble_id=1
    @GetMapping("/detail")
    public ResponseEntity<BleDto> detail(@RequestParam("ble_id") String bleId) {
        return service.detail(bleId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
