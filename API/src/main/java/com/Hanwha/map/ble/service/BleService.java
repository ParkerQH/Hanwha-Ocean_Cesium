package com.Hanwha.map.ble.service;

import com.Hanwha.map.ble.api.BleDto;
import com.Hanwha.map.ble.repo.BleSensorRepository;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

@Service
public class BleService {

    private final BleSensorRepository repo;

    public BleService(BleSensorRepository repo) {
        this.repo = repo;
    }

    // /api/ble/by_pillars?pillar_ids=4,8..., 기둥 기준 조회
    public List<BleDto> findByPillars(String pillarIdsCsv) {
        List<Integer> ids = Arrays.stream(pillarIdsCsv.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .map(Integer::parseInt)
                .toList();
        return repo.findByPillarIdIn(ids).stream()
                .map(s -> new BleDto(s.getBleId(), s.getPillarId(), s.getLine()))
                .toList();
    }

    // /api/ble/detail?ble_id=101, BLE ID 기준 조회
    public Optional<BleDto> detail(String bleId) {
        return repo.findByBleId(bleId)
                .map(s -> new BleDto(s.getBleId(), s.getPillarId(), s.getLine()));
    }

}
