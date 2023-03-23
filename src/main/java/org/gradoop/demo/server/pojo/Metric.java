package org.gradoop.demo.server.pojo;

import org.gradoop.common.model.impl.id.GradoopId;

/**
 * An Object, that represents a metric evolution.
 */
public class Metric {

    private GradoopId id;

    private Long from;

    private Long to;

    private Integer value;

    public Metric(GradoopId id, Long from, Long to, Integer value) {
        this.id = id;
        this.from = from;
        this.to = to;
        this.value = value;

    }

    public GradoopId getId() {
        return id;
    }

    public Long getFrom() {
        return from;
    }

    public Long getTo() {
        return to;
    }

    public Integer getValue() {
        return value;
    }
}
