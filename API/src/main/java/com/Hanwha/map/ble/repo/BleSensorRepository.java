package com.Hanwha.map.ble.repo;

import com.Hanwha.map.ble.domain.BleSensor;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface BleSensorRepository extends JpaRepository<BleSensor, String> {
    Optional<BleSensor> findByBleId(String bleId);

    List<BleSensor> findByPillarIdIn(List<Integer> pillarIds);
}