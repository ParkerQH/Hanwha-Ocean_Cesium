package com.Hanwha.map.worker.api;

import com.Hanwha.map.worker.service.WorkerInfoService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/worker")
public class WorkerInfoController {

    private final WorkerInfoService service;

    public WorkerInfoController(WorkerInfoService service) {
        this.service = service;
    }

    // 공장 번호로 조회: /api/worker/150
    @GetMapping("/{bldgId}")
    public ResponseEntity<?> getOne(@PathVariable("bldgId") String bldgId) {
        return service.getOne(bldgId)
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
