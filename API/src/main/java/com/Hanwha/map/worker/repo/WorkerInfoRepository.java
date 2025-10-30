package com.Hanwha.map.worker.repo;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.Hanwha.map.worker.domain.WorkerInfo;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Repository;

import jakarta.annotation.PostConstruct;
import java.io.InputStream;
import java.util.*;

@Repository
public class WorkerInfoRepository {

    private final Map<String, WorkerInfo> byBldgId = new HashMap<>();
    private final ObjectMapper om = new ObjectMapper();

    @PostConstruct
    public void load() {
        try {
            ClassPathResource res = new ClassPathResource("data/workerinfo.json");
            try (InputStream in = res.getInputStream()) {
                List<WorkerInfo> list = om.readValue(in, new TypeReference<List<WorkerInfo>>() {
                });
                byBldgId.clear();
                for (WorkerInfo worker : list) {
                    if (worker.getBldg_id() != null) {
                        byBldgId.put(worker.getBldg_id(), worker);
                    }
                }
            }
        } catch (Exception e) {
            // 초기 로드 실패 시 비워둠 (로그만)
            System.err.println("[WorkerInfoRepository] load error: " + e.getMessage());
        }
    }

    public Optional<WorkerInfo> findByBldgId(String bldgId) {
        return Optional.ofNullable(byBldgId.get(bldgId));
    }
}
