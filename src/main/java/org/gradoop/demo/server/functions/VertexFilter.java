package org.gradoop.demo.server.functions;

import org.apache.commons.lang.ArrayUtils;
import org.apache.flink.api.common.functions.FilterFunction;
import org.gradoop.common.model.api.entities.Element;
import org.gradoop.common.model.impl.id.GradoopId;

public class VertexFilter<E extends Element> implements FilterFunction<E> {

    private String[] vertices;

    public VertexFilter(String[] vertices){
        this.vertices = vertices;
    }

    @Override
    public boolean filter(E e) throws Exception {
        return vertices.length == 0 || ArrayUtils.contains(vertices, e.getId().toString());

    }
}